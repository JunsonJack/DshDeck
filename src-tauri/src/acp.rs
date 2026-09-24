//! ACP JSON-RPC bridge over `dsh --profile acp` stdio.
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::Path;
use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, Command};
use tokio::sync::{oneshot, Mutex};

pub struct BridgeEvent {
    pub kind: &'static str,
    pub payload: Value,
}

type EmitFn = Arc<dyn Fn(BridgeEvent) + Send + Sync>;

struct Pending {
    map: Mutex<HashMap<i64, oneshot::Sender<Result<Value, String>>>>,
}

impl Pending {
    fn new() -> Self {
        Self {
            map: Mutex::new(HashMap::new()),
        }
    }
}

/// Live connection handle. Commands clone it out of `AcpState` and drop the
/// state lock before awaiting: cancel and permission responses must stay
/// writable while a prompt is in flight.
pub struct Conn {
    stdin: Mutex<ChildStdin>,
    pending: Arc<Pending>,
    next_id: AtomicI64,
    session_id: std::sync::Mutex<Option<String>>,
}

impl Conn {
    async fn write_line(&self, payload: &Value) -> Result<(), String> {
        let mut w = self.stdin.lock().await;
        let mut s = payload.to_string();
        s.push('\n');
        w.write_all(s.as_bytes()).await.map_err(|e| e.to_string())?;
        w.flush().await.map_err(|e| e.to_string())
    }

    pub async fn call(&self, method: &str, params: Value) -> Result<Value, String> {
        let id = self.next_id.fetch_add(1, Ordering::SeqCst);
        let (tx, rx) = oneshot::channel();
        self.pending.map.lock().await.insert(id, tx);
        let payload = json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params });
        self.write_line(&payload).await?;
        match tokio::time::timeout(std::time::Duration::from_secs(120), rx).await {
            Ok(Ok(res)) => res,
            Ok(Err(_)) => Err("channel closed".into()),
            Err(_) => {
                self.pending.map.lock().await.remove(&id);
                Err(format!("timeout: {method}"))
            }
        }
    }

    /// reply to a server→client request (permission, fs, …)
    pub async fn respond(&self, id: i64, result: Value) -> Result<(), String> {
        self.write_line(&json!({ "jsonrpc": "2.0", "id": id, "result": result }))
            .await
    }

    /// server-bound notification (no id — e.g. session/cancel)
    pub async fn notify(&self, method: &str, params: Value) -> Result<(), String> {
        self.write_line(&json!({ "jsonrpc": "2.0", "method": method, "params": params }))
            .await
    }

    pub fn session_id(&self) -> Option<String> {
        self.session_id.lock().ok().and_then(|g| g.clone())
    }

    pub fn set_session_id(&self, v: Option<String>) {
        if let Ok(mut g) = self.session_id.lock() {
            *g = v;
        }
    }

    pub async fn session_list(&self) -> Result<Value, String> {
        self.call("session/list", json!({})).await
    }

    pub async fn session_prompt(&self, text: &str) -> Result<Value, String> {
        let sid = self.session_id().ok_or("no session")?;
        self.call(
            "session/prompt",
            json!({ "sessionId": sid, "prompt": [{ "type": "text", "text": text }] }),
        )
        .await
    }

    /// session/cancel is a NOTIFICATION in ACP — the in-flight prompt settles
    /// on its own with stopReason "cancelled".
    pub async fn session_cancel(&self) -> Result<Value, String> {
        let sid = self.session_id().ok_or("no session")?;
        self.notify("session/cancel", json!({ "sessionId": sid })).await?;
        Ok(json!({}))
    }

    /// per-session config set; dsh deviates from the spec: param is `configId`
    pub async fn session_set_config(&self, config_id: &str, value: &str) -> Result<Value, String> {
        let sid = self.session_id().ok_or("no session")?;
        self.call(
            "session/set_config_option",
            json!({ "sessionId": sid, "configId": config_id, "value": value }),
        )
        .await
    }

    pub async fn session_close(&self) -> Result<Value, String> {
        match self.session_id() {
            Some(sid) => self.call("session/close", json!({ "sessionId": sid })).await,
            None => Ok(json!({})),
        }
    }
}

/// DataRootLock — one live connection per profile, via a deterministic localhost port.
/// Binding succeeds → lock held (listener kept alive). Self-cleans on process death.
/// Hash must match the Node host implementation (server.mjs profileLockPort).
pub fn profile_lock_port(profile: &str) -> u16 {
    let mut h: u32 = 0;
    for c in profile.chars() {
        h = h.wrapping_mul(31).wrapping_add(c as u32);
    }
    47700 + (h % 256) as u16
}

pub struct AcpState {
    pub cwd: String,
    child: Option<Child>,
    conn: Option<Arc<Conn>>,
    emit: Option<EmitFn>,
    booted: bool,
    /// unclean-exit timestamps for the crash budget (reboot gate)
    exits: Vec<std::time::Instant>,
    /// held profile lock; dropped on replace/stop
    _lock: Option<std::net::TcpListener>,
}

impl AcpState {
    pub fn new() -> Self {
        Self {
            cwd: std::env::current_dir()
                .map(|p| p.display().to_string())
                .unwrap_or_else(|_| ".".into()),
            child: None,
            conn: None,
            emit: None,
            booted: false,
            exits: Vec::new(),
            _lock: None,
        }
    }

    pub fn conn(&self) -> Option<Arc<Conn>> {
        self.conn.clone()
    }

    pub async fn boot(
        &mut self,
        cwd: Option<String>,
        profile: Option<String>,
        on_event: impl Fn(BridgeEvent) + Send + Sync + 'static,
    ) -> Result<Value, String> {
        // previous connection still alive → keep it
        if let Some(child) = self.child.as_mut() {
            match child.try_wait() {
                Ok(None) => return Ok(json!({ "already": true })),
                Ok(Some(_)) | Err(_) => {
                    // dsh died since last boot — count it and allow a fresh spawn
                    self.exits.push(std::time::Instant::now());
                    self.conn = None;
                    self.child = None;
                    self.booted = false;
                }
            }
        } else {
            self.booted = false;
            self.conn = None;
        }
        // CrashBudget — no infinite restart loops
        let now = std::time::Instant::now();
        self.exits
            .retain(|t| now.duration_since(*t) < std::time::Duration::from_secs(120));
        if self.exits.len() >= 3 {
            return Err("dsh 连续崩溃多次（120 秒窗口内 ≥3 次），已停止重启。请检查 profile 或 dsh 安装后重试".into());
        }
        if let Some(c) = cwd {
            if !c.is_empty() {
                self.cwd = c;
            }
        }
        let profile = profile.unwrap_or_else(|| "acp".into());
        let lock = match std::net::TcpListener::bind(("127.0.0.1", profile_lock_port(&profile))) {
            Ok(l) => l,
            Err(_) => {
                return Err(format!(
                    "profile「{profile}」已有活动连接（另一个 DshDeck 窗口在运行？），同 profile 不双开"
                ))
            }
        };
        self._lock = Some(lock);
        let emit: EmitFn = Arc::new(on_event);
        self.emit = Some(emit.clone());

        let mut cmd = Command::new("dsh");
        cmd.arg("--profile")
            .arg(&profile)
            .current_dir(&self.cwd)
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .kill_on_drop(true);
        // Windows: hide console window for dsh.cmd shim
        #[cfg(windows)]
        {
            cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
        }

        let mut child = cmd.spawn().map_err(|e| format!("spawn dsh: {e}"))?;
        let stdin = child.stdin.take().ok_or("no stdin")?;
        let stdout = child.stdout.take().ok_or("no stdout")?;
        let stderr = child.stderr.take().ok_or("no stderr")?;

        self.child = Some(child);

        let pending = Arc::new(Pending::new());
        let conn = Arc::new(Conn {
            stdin: Mutex::new(stdin),
            pending: pending.clone(),
            next_id: AtomicI64::new(1),
            session_id: std::sync::Mutex::new(None),
        });

        // stdout reader
        {
            let pending = pending.clone();
            let emit = emit.clone();
            tauri::async_runtime::spawn(async move {
                let mut lines = BufReader::new(stdout).lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    if line.trim().is_empty() {
                        continue;
                    }
                    let Ok(msg) = serde_json::from_str::<Value>(&line) else {
                        emit(BridgeEvent {
                            kind: "notify",
                            payload: json!({ "raw": line }),
                        });
                        continue;
                    };
                    if msg.get("id").is_some() && (msg.get("result").is_some() || msg.get("error").is_some())
                    {
                        if let Some(id) = msg.get("id").and_then(|v| v.as_i64()) {
                            let mut map = pending.map.lock().await;
                            if let Some(tx) = map.remove(&id) {
                                if msg.get("error").is_some() {
                                    let _ = tx.send(Err(msg["error"].to_string()));
                                } else {
                                    let _ = tx.send(Ok(msg["result"].clone()));
                                }
                            }
                        }
                        continue;
                    }
                    if msg.get("id").is_some() && msg.get("method").is_some() {
                        let method = msg["method"].as_str().unwrap_or("").to_string();
                        let kind = if method.to_lowercase().contains("permission") {
                            "permission"
                        } else {
                            "request"
                        };
                        emit(BridgeEvent {
                            kind,
                            payload: msg,
                        });
                        continue;
                    }
                    if msg.get("method") == Some(&json!("session/update")) {
                        emit(BridgeEvent {
                            kind: "session_update",
                            payload: msg.get("params").cloned().unwrap_or(msg),
                        });
                    } else {
                        emit(BridgeEvent {
                            kind: "notify",
                            payload: msg,
                        });
                    }
                }
                emit(BridgeEvent {
                    kind: "exit",
                    payload: json!({ "code": 0 }),
                });
            });
        }

        // stderr
        {
            let emit = emit.clone();
            tauri::async_runtime::spawn(async move {
                let mut lines = BufReader::new(stderr).lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    emit(BridgeEvent {
                        kind: "stderr",
                        payload: json!({ "text": line }),
                    });
                }
            });
        }

        let agent = conn
            .call(
                "initialize",
                json!({
                    "protocolVersion": 1,
                    "clientCapabilities": { "fs": { "readTextFile": true, "writeTextFile": true } },
                    "clientInfo": { "name": "dshdeck", "version": "0.1.0" }
                }),
            )
            .await?;
        conn.write_line(&json!({ "jsonrpc": "2.0", "method": "initialized", "params": {} }))
            .await?;
        self.conn = Some(conn);
        self.booted = true;
        Ok(agent)
    }

    pub async fn session_new(&mut self, cwd: Option<String>) -> Result<Value, String> {
        if let Some(c) = cwd {
            if !c.is_empty() {
                self.cwd = c;
            }
        }
        let conn = self.conn.clone().ok_or("not booted")?;
        let result = conn
            .call("session/new", json!({ "cwd": self.cwd, "mcpServers": {} }))
            .await?;
        conn.set_session_id(
            result
                .get("sessionId")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string()),
        );
        Ok(result)
    }

    pub async fn session_resume(&mut self, session_id: &str, cwd: &str) -> Result<Value, String> {
        if !cwd.is_empty() {
            self.cwd = cwd.to_string();
        }
        let conn = self.conn.clone().ok_or("not booted")?;
        let result = conn
            .call("session/resume", json!({ "sessionId": session_id, "cwd": cwd }))
            .await?;
        conn.set_session_id(Some(session_id.to_string()));
        Ok(result)
    }
}

pub fn git_status(cwd: &str) -> Result<Value, String> {
    if !Path::new(cwd).join(".git").exists() && !in_git_repo(cwd) {
        return Ok(json!({ "ok": false, "git": false, "error": "工作区不是 git 仓库" }));
    }
    let out = std::process::Command::new("git")
        .args(["status", "--porcelain"])
        .current_dir(cwd)
        .output()
        .map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Ok(json!({ "ok": false, "git": false, "error": String::from_utf8_lossy(&out.stderr) }));
    }
    let text = String::from_utf8_lossy(&out.stdout);
    let files: Vec<Value> = text
        .lines()
        .filter(|l| !l.trim().is_empty())
        .map(|line| {
            let x = line.chars().next().unwrap_or(' ');
            let y = line.chars().nth(1).unwrap_or(' ');
            let path = line.get(3..).unwrap_or("").trim().to_string();
            let kind = if x == '?' || y == '?' {
                "untracked"
            } else if x == 'A' || y == 'A' {
                "added"
            } else if x == 'D' || y == 'D' {
                "deleted"
            } else if x == 'R' || y == 'R' {
                "renamed"
            } else {
                "modified"
            };
            json!({ "path": path, "kind": kind, "x": x.to_string(), "y": y.to_string() })
        })
        .collect();
    Ok(json!({ "ok": true, "git": true, "files": files }))
}

fn in_git_repo(cwd: &str) -> bool {
    std::process::Command::new("git")
        .args(["rev-parse", "--is-inside-work-tree"])
        .current_dir(cwd)
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

pub fn git_diff(cwd: &str) -> Result<Value, String> {
    let st = git_status(cwd)?;
    if st.get("ok").and_then(|v| v.as_bool()) != Some(true) {
        return Ok(st);
    }
    let mut out_files = Vec::new();
    if let Some(files) = st.get("files").and_then(|v| v.as_array()) {
        for f in files {
            let path = f.get("path").and_then(|v| v.as_str()).unwrap_or("");
            let kind = f.get("kind").and_then(|v| v.as_str()).unwrap_or("");
            let patch = if kind == "untracked" {
                std::process::Command::new("git")
                    .args(["diff", "--no-index", "--", "NUL", path])
                    .current_dir(cwd)
                    .output()
                    .map(|o| String::from_utf8_lossy(&o.stdout).to_string())
                    .unwrap_or_default()
            } else {
                std::process::Command::new("git")
                    .args(["diff", "--", path])
                    .current_dir(cwd)
                    .output()
                    .map(|o| String::from_utf8_lossy(&o.stdout).to_string())
                    .unwrap_or_default()
            };
            out_files.push(json!({ "path": path, "kind": kind, "patch": patch }));
        }
    }
    Ok(json!({ "ok": true, "git": true, "files": out_files }))
}

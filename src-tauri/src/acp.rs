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

pub struct AcpState {
    pub cwd: String,
    child: Option<Child>,
    stdin: Option<ChildStdin>,
    next_id: AtomicI64,
    pending: Arc<Pending>,
    session_id: Option<String>,
    emit: Option<EmitFn>,
    booted: bool,
}

impl AcpState {
    pub fn new() -> Self {
        Self {
            cwd: std::env::current_dir()
                .map(|p| p.display().to_string())
                .unwrap_or_else(|_| ".".into()),
            child: None,
            stdin: None,
            next_id: AtomicI64::new(1),
            pending: Arc::new(Pending::new()),
            session_id: None,
            emit: None,
            booted: false,
        }
    }

    pub async fn boot(
        &mut self,
        cwd: Option<String>,
        profile: Option<String>,
        on_event: impl Fn(BridgeEvent) + Send + Sync + 'static,
    ) -> Result<Value, String> {
        if self.booted {
            return Ok(json!({ "already": true }));
        }
        if let Some(c) = cwd {
            if !c.is_empty() {
                self.cwd = c;
            }
        }
        let profile = profile.unwrap_or_else(|| "acp".into());
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
        self.stdin = Some(stdin);

        // stdout reader
        {
            let pending = self.pending.clone();
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

        let agent = self
            .call(
                "initialize",
                json!({
                    "protocolVersion": 1,
                    "clientCapabilities": { "fs": { "readTextFile": true, "writeTextFile": true } },
                    "clientInfo": { "name": "dshdeck", "version": "0.1.0" }
                }),
            )
            .await?;
        self.write_line(&json!({ "jsonrpc": "2.0", "method": "initialized", "params": {} }))
            .await?;
        self.booted = true;
        Ok(agent)
    }

    async fn write_line(&mut self, payload: &Value) -> Result<(), String> {
        let stdin = self.stdin.as_mut().ok_or("not booted")?;
        let mut s = payload.to_string();
        s.push('\n');
        stdin
            .write_all(s.as_bytes())
            .await
            .map_err(|e| e.to_string())?;
        stdin.flush().await.map_err(|e| e.to_string())?;
        Ok(())
    }

    async fn call(&mut self, method: &str, params: Value) -> Result<Value, String> {
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

    pub async fn session_new(&mut self, cwd: Option<String>) -> Result<Value, String> {
        if let Some(c) = cwd {
            if !c.is_empty() {
                self.cwd = c;
            }
        }
        let result = self
            .call(
                "session/new",
                json!({ "cwd": self.cwd, "mcpServers": {} }),
            )
            .await?;
        self.session_id = result
            .get("sessionId")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        Ok(result)
    }

    pub async fn session_list(&mut self) -> Result<Value, String> {
        self.call("session/list", json!({})).await
    }

    pub async fn session_resume(&mut self, session_id: &str, cwd: &str) -> Result<Value, String> {
        if !cwd.is_empty() {
            self.cwd = cwd.to_string();
        }
        let result = self
            .call("session/resume", json!({ "sessionId": session_id, "cwd": cwd }))
            .await?;
        self.session_id = Some(session_id.to_string());
        Ok(result)
    }

    pub async fn session_prompt(&mut self, text: &str) -> Result<Value, String> {
        let sid = self.session_id.clone().ok_or("no session")?;
        self.call(
            "session/prompt",
            json!({ "sessionId": sid, "prompt": [{ "type": "text", "text": text }] }),
        )
        .await
    }

    pub async fn session_cancel(&mut self) -> Result<Value, String> {
        let sid = self.session_id.clone().ok_or("no session")?;
        self.call("session/cancel", json!({ "sessionId": sid })).await
    }

    pub async fn session_close(&mut self) -> Result<Value, String> {
        if let Some(sid) = self.session_id.clone() {
            let r = self.call("session/close", json!({ "sessionId": sid })).await;
            self.session_id = None;
            return r;
        }
        Ok(json!({}))
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

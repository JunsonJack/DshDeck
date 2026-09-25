//! dsh-readonly · session replay parser (strictly read-only over ~/.dsh/sessions).
//! Format notes: docs/W0-调研笔记.md §10 — multi-frame zstd JSONL, event types
//! user/message · assistant/message · tool/call · tool/result · session/title.
use serde_json::{json, Value};
use std::io::Read;
use std::path::{Path, PathBuf};

fn encode_cwd_dir(cwd: &str) -> String {
    let parts: Vec<&str> = cwd
        .split(['\\', '/', ':'])
        .filter(|s| !s.is_empty())
        .collect();
    format!("--{}--", parts.join("-"))
}

fn decode_frames(buf: &[u8]) -> Result<Vec<u8>, String> {
    // dsh writes concatenated zstd frames (one per event batch). The
    // StreamingDecoder stops at frame boundaries, so slice per frame magic
    // (28 B5 2F FD) and decode each slice — mirrors the Node parser.
    const MAGIC: [u8; 4] = [0x28, 0xb5, 0x2f, 0xfd];
    let mut offs = Vec::new();
    let mut i = 0;
    while i + 4 <= buf.len() {
        if buf[i..i + 4] == MAGIC {
            offs.push(i);
            i += 4;
        } else {
            i += 1;
        }
    }
    if offs.is_empty() {
        return Err("no zstd frames found".into());
    }
    let mut out = Vec::new();
    for (f, &start) in offs.iter().enumerate() {
        let end = offs.get(f + 1).copied().unwrap_or(buf.len());
        let mut dec = ruzstd::decoding::StreamingDecoder::new(std::io::Cursor::new(&buf[start..end]))
            .map_err(|e| format!("zstd frame {f}: {e}"))?;
        dec.read_to_end(&mut out)
            .map_err(|e| format!("zstd decode frame {f}: {e}"))?;
    }
    Ok(out)
}

fn texts(blocks: &Value) -> String {
    let mut out = Vec::new();
    if let Some(arr) = blocks.as_array() {
        for b in arr {
            if b.get("type").and_then(|v| v.as_str()) == Some("text") {
                if let Some(t) = b.get("text").and_then(|v| v.as_str()) {
                    out.push(t.to_string());
                }
            }
        }
    }
    out.join("\n")
}

fn map_events(lines: &[&str]) -> (Vec<Value>, Option<String>) {
    let mut events = Vec::new();
    let mut title: Option<String> = None;
    for l in lines {
        let Ok(o) = serde_json::from_str::<Value>(l) else {
            continue;
        };
        let typ = o.get("type").and_then(|v| v.as_str()).unwrap_or("");
        match typ {
            "session/title" => {
                if let Some(t) = o.pointer("/data/title").and_then(|v| v.as_str()) {
                    title = Some(t.to_string());
                }
            }
            "user/message" => {
                let text = texts(&o.pointer("/data/content").cloned().unwrap_or(Value::Null));
                if !text.is_empty() {
                    events.push(json!({ "kind": "user", "text": text }));
                }
            }
            "assistant/message" => {
                let blocks = o.pointer("/data/message/content").cloned().unwrap_or(Value::Null);
                if let Some(arr) = blocks.as_array() {
                    for b in arr {
                        let bt = b.get("type").and_then(|v| v.as_str()).unwrap_or("");
                        match bt {
                            "text" => {
                                if let Some(t) = b.get("text").and_then(|v| v.as_str()) {
                                    if !t.is_empty() {
                                        events.push(json!({ "kind": "assistant", "text": t }));
                                    }
                                }
                            }
                            "reasoning" => {
                                if let Some(t) = b.get("text").and_then(|v| v.as_str()) {
                                    if !t.is_empty() {
                                        events.push(json!({ "kind": "thought", "text": t }));
                                    }
                                }
                            }
                            _ => {} // tool-call blocks covered by tool/call events
                        }
                    }
                }
            }
            "tool/call" => {
                let Some(id) = o.pointer("/data/callId").and_then(|v| v.as_str()) else {
                    continue;
                };
                let title = o.pointer("/data/name").and_then(|v| v.as_str()).unwrap_or("tool");
                let raw_input = o
                    .pointer("/data/arguments")
                    .and_then(|v| v.as_str())
                    .and_then(|s| serde_json::from_str::<Value>(s).ok())
                    .unwrap_or_else(|| o.pointer("/data/arguments").cloned().unwrap_or(Value::Null));
                events.push(json!({ "kind": "tool_call", "id": id, "title": title, "rawInput": raw_input }));
            }
            "tool/result" => {
                let id = o
                    .pointer("/data/message/toolCallId")
                    .or_else(|| o.pointer("/data/message/source/callId"))
                    .and_then(|v| v.as_str());
                let Some(id) = id else { continue };
                let text = texts(&o.pointer("/data/message/content").cloned().unwrap_or(Value::Null));
                events.push(json!({ "kind": "tool_result", "id": id, "text": text, "status": "completed" }));
            }
            _ => {} // internal events — ignored for replay
        }
    }
    (events, title)
}

fn sessions_root() -> Option<PathBuf> {
    std::env::var_os("USERPROFILE").map(|u| Path::new(&u).join(".dsh").join("sessions"))
}

fn locate(session_id: &str, cwd: &str) -> Result<PathBuf, String> {
    let root = sessions_root().ok_or("未找到 USERPROFILE")?;
    if !root.exists() {
        return Err("未找到 ~/.dsh/sessions 目录".into());
    }
    let bare = session_id.strip_prefix("session-").unwrap_or(session_id);
    let mut candidates = Vec::new();
    if !cwd.is_empty() {
        candidates.push(root.join(encode_cwd_dir(cwd)).join(bare).join("session.v4.jsonl.zstd"));
        candidates.push(root.join(encode_cwd_dir(cwd)).join(format!("session-{bare}")).join("session.v4.jsonl.zstd"));
    }
    for c in &candidates {
        if c.exists() {
            return Ok(c.clone());
        }
    }
    // fallback: header scan across cwd dirs
    let dirs = std::fs::read_dir(&root).map_err(|e| e.to_string())?;
    for d in dirs.flatten() {
        for name in [bare.to_string(), format!("session-{bare}")] {
            let p = d.path().join(&name).join("session.v4.jsonl.zstd");
            if !p.exists() {
                continue;
            }
            if let Ok(buf) = std::fs::read(&p) {
                if let Ok(data) = decode_frames(&buf) {
                    let first = String::from_utf8_lossy(&data);
                    if let Some(line) = first.lines().next() {
                        if let Ok(head) = serde_json::from_str::<Value>(line) {
                            let id = head.get("id").and_then(|v| v.as_str()).unwrap_or("");
                            if id == bare || id == session_id {
                                return Ok(p);
                            }
                        }
                    }
                }
            }
        }
    }
    Err(format!("未找到会话 {bare} 的存储文件"))
}

/// Parse one session's stored history into UI replay events. Never hard-errors:
/// failures degrade to ok=false with a reason (per the replayable contract).
pub fn session_replay(session_id: &str, cwd: &str) -> Result<Value, String> {
    match do_replay(session_id, cwd) {
        Ok(v) => Ok(v),
        Err(e) => Ok(json!({ "ok": false, "error": e, "events": [] })),
    }
}

fn do_replay(session_id: &str, cwd: &str) -> Result<Value, String> {
    let p = locate(session_id, cwd)?;
    let buf = std::fs::read(&p).map_err(|e| format!("read: {e}"))?;
    let data = decode_frames(&buf)?;
    let text = String::from_utf8_lossy(&data);
    let lines: Vec<&str> = text.lines().filter(|l| !l.trim().is_empty()).collect();
    let (events, title) = map_events(&lines);
    Ok(json!({ "ok": true, "events": events, "title": title }))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Parses real ~/.dsh/sessions files. Run explicitly:
    /// cargo test session_replay_real -- --ignored
    #[test]
    #[ignore = "needs real ~/.dsh/sessions content"]
    fn session_replay_real() {
        let root = sessions_root().expect("USERPROFILE");
        let mut total = 0;
        let mut with_events = 0;
        for dir in std::fs::read_dir(&root).unwrap().flatten() {
            for sid in std::fs::read_dir(dir.path()).unwrap().flatten() {
                if !sid.path().join("session.v4.jsonl.zstd").exists() {
                    continue;
                }
                total += 1;
                let id = sid.file_name().to_string_lossy().to_string();
                let r = session_replay(&id, "").unwrap();
                assert_eq!(
                    r.get("ok").and_then(|v| v.as_bool()),
                    Some(true),
                    "session {id} must parse: {r}"
                );
                let n = r.get("events").and_then(|v| v.as_array()).map(|a| a.len()).unwrap_or(0);
                if n > 0 {
                    with_events += 1;
                }
            }
        }
        assert!(total > 0, "no session files present");
        assert!(with_events > 0, "no session yielded replay events");
    }
}

//! DshDeck shell — Tauri host + ACP bridge (thin shell over `dsh --profile acp`).
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod acp;

use acp::AcpState;
use std::sync::Mutex;
use tauri::{Emitter, State};
use tokio::sync::Mutex as AsyncMutex;

struct AppState {
    acp: AsyncMutex<AcpState>,
    cwd: Mutex<String>,
}

fn emit(app: &tauri::AppHandle, event: &str, payload: serde_json::Value) {
    let _ = app.emit(event, payload);
}

#[tauri::command]
async fn boot(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    cwd: Option<String>,
    profile: Option<String>,
) -> Result<serde_json::Value, String> {
    let mut st = state.acp.lock().await;
    let agent = st
        .boot(cwd.clone(), profile, {
            let app = app.clone();
            move |evt| {
                match evt.kind {
                    "session_update" => emit(&app, "session/update", evt.payload),
                    "notify" => emit(&app, "acp/notify", evt.payload),
                    "request" => emit(&app, "acp/request", evt.payload),
                    "permission" => emit(&app, "permission/request", evt.payload),
                    "stderr" => emit(&app, "stderr", evt.payload),
                    "exit" => emit(&app, "exit", evt.payload),
                    _ => emit(&app, "acp/evt", evt.payload),
                }
            }
        })
        .await?;
    if let Ok(mut c) = state.cwd.lock() {
        *c = st.cwd.clone();
    }
    Ok(agent)
}

#[tauri::command]
async fn session_new(
    state: State<'_, AppState>,
    cwd: Option<String>,
) -> Result<serde_json::Value, String> {
    let mut st = state.acp.lock().await;
    let r = st.session_new(cwd).await?;
    if let Ok(mut c) = state.cwd.lock() {
        *c = st.cwd.clone();
    }
    Ok(r)
}

#[tauri::command]
async fn session_list(state: State<'_, AppState>) -> Result<serde_json::Value, String> {
    let conn = state.acp.lock().await.conn().ok_or("not booted")?;
    conn.session_list().await
}

#[tauri::command]
async fn session_resume(
    state: State<'_, AppState>,
    session_id: String,
    cwd: String,
) -> Result<serde_json::Value, String> {
    let mut st = state.acp.lock().await;
    let r = st.session_resume(&session_id, &cwd).await?;
    if let Ok(mut c) = state.cwd.lock() {
        *c = st.cwd.clone();
    }
    Ok(r)
}

#[tauri::command]
async fn session_prompt(
    state: State<'_, AppState>,
    text: String,
) -> Result<serde_json::Value, String> {
    let conn = state.acp.lock().await.conn().ok_or("not booted")?;
    conn.session_prompt(&text).await
}

#[tauri::command]
async fn session_cancel(state: State<'_, AppState>) -> Result<serde_json::Value, String> {
    let conn = state.acp.lock().await.conn().ok_or("not booted")?;
    conn.session_cancel().await
}

#[tauri::command]
async fn session_close(state: State<'_, AppState>) -> Result<serde_json::Value, String> {
    let conn = state.acp.lock().await.conn().ok_or("not booted")?;
    conn.session_close().await
}

#[tauri::command]
async fn permission_response(
    state: State<'_, AppState>,
    id: i64,
    allow: bool,
    option_id: Option<String>,
) -> Result<serde_json::Value, String> {
    let conn = state.acp.lock().await.conn().ok_or("not booted")?;
    let outcome = if allow {
        serde_json::json!({
            "outcome": "selected",
            "optionId": option_id.unwrap_or_else(|| "allow-once".into())
        })
    } else {
        serde_json::json!({ "outcome": "cancelled" })
    };
    conn.respond(id, serde_json::json!({ "outcome": outcome }))
        .await?;
    Ok(serde_json::json!({ "ok": true }))
}

#[tauri::command]
async fn git_diff(state: State<'_, AppState>) -> Result<serde_json::Value, String> {
    let cwd = state.cwd.lock().map(|c| c.clone()).unwrap_or_default();
    acp::git_diff(&cwd)
}

#[tauri::command]
async fn git_status(state: State<'_, AppState>) -> Result<serde_json::Value, String> {
    let cwd = state.cwd.lock().map(|c| c.clone()).unwrap_or_default();
    acp::git_status(&cwd)
}

#[tauri::command]
fn health() -> serde_json::Value {
    let dsh = which::which("dsh").ok().map(|p| p.display().to_string());
    serde_json::json!({
        "dsh": dsh,
        "ok": dsh.is_some(),
    })
}

fn log_line(msg: &str) {
    if let Some(base) = std::env::var_os("LOCALAPPDATA") {
        let dir = std::path::PathBuf::from(base).join("DshDeck");
        let path = dir.join("app.log");
        let res = std::fs::create_dir_all(&dir).and_then(|()| {
            std::fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(&path)
                .and_then(|mut f| {
                    use std::io::Write;
                    writeln!(f, "[{}] {msg}", chrono_lite_now())
                })
        });
        if let Err(e) = res {
            eprintln!("[dshdeck] log write failed ({}): {e}", path.display());
        }
    }
    eprintln!("[dshdeck] {msg}");
}

fn chrono_lite_now() -> String {
    // avoid chrono dep — ISO-ish local time via system
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    format!("{now}")
}

fn main() {
    if std::env::var_os("WEBVIEW2_USER_DATA_FOLDER").is_none() {
        if let Some(base) = std::env::var_os("LOCALAPPDATA") {
            let dir = std::path::PathBuf::from(base).join("DshDeck").join("WebView2");
            let _ = std::fs::create_dir_all(&dir);
            std::env::set_var("WEBVIEW2_USER_DATA_FOLDER", &dir);
            log_line(&format!("WEBVIEW2_USER_DATA_FOLDER={}", dir.display()));
        }
    }

    log_line("starting DshDeck");
    log_line(&format!("cwd={}", std::env::current_dir().map(|p| p.display().to_string()).unwrap_or_default()));

    let result = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(AppState {
            acp: AsyncMutex::new(AcpState::new()),
            cwd: Mutex::new(String::new()),
        })
        .setup(|app| {
            use tauri::WebviewWindowBuilder;
            let builder = WebviewWindowBuilder::new(app, "main", tauri::WebviewUrl::App("index.html".into()))
                .title("DshDeck")
                .inner_size(1280.0, 840.0)
                .min_inner_size(960.0, 640.0)
                .resizable(true)
                .visible(true);
            match builder.build() {
                Ok(_w) => {
                    log_line("webview window created");
                    Ok(())
                }
                Err(e) => {
                    log_line(&format!("webview window FAILED: {e}"));
                    Err(e.into())
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            boot,
            session_new,
            session_list,
            session_resume,
            session_prompt,
            session_cancel,
            session_close,
            permission_response,
            git_diff,
            git_status,
            health,
        ])
        .run(tauri::generate_context!());

    if let Err(e) = result {
        log_line(&format!("RUN ERROR: {e}"));
        eprintln!("DshDeck failed to start: {e}");
        std::process::exit(1);
    }
}

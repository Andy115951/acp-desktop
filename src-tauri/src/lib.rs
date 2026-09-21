mod acp_host;

use acp_host::{AcpSession, AppState, SessionStatus};
use serde::Serialize;
use std::env;
use std::path::PathBuf;
use tauri::Manager;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentInfo {
    pub id: String,
    pub name: String,
    pub binary: String,
    pub available: bool,
}

fn binary_on_path(binary: &str) -> bool {
    let Some(path_os) = env::var_os("PATH") else {
        return false;
    };

    let candidates: Vec<PathBuf> = {
        #[cfg(windows)]
        {
            vec![
                PathBuf::from(binary),
                PathBuf::from(format!("{binary}.exe")),
                PathBuf::from(format!("{binary}.cmd")),
                PathBuf::from(format!("{binary}.bat")),
            ]
        }
        #[cfg(not(windows))]
        {
            vec![PathBuf::from(binary)]
        }
    };

    for dir in env::split_paths(&path_os) {
        for name in &candidates {
            let full = dir.join(name);
            if full.is_file() {
                return true;
            }
        }
    }
    false
}

#[tauri::command]
fn detect_agents() -> Vec<AgentInfo> {
    let agents = [
        ("grok", "Grok Build", "grok"),
        ("codex", "Codex", "codex"),
        ("claude", "Claude Code", "claude"),
    ];

    agents
        .into_iter()
        .map(|(id, name, binary)| AgentInfo {
            id: id.to_string(),
            name: name.to_string(),
            binary: binary.to_string(),
            available: binary_on_path(binary),
        })
        .collect()
}

#[tauri::command]
async fn connect_grok(
    app: tauri::AppHandle,
    cwd: String,
    resume_session_id: Option<String>,
) -> Result<(), String> {
    let path = PathBuf::from(&cwd);
    if !path.is_dir() {
        return Err(format!("Not a directory: {cwd}"));
    }
    if !binary_on_path("grok") {
        return Err("`grok` not found on PATH".into());
    }
    AcpSession::start(app, path, resume_session_id)
}

#[tauri::command]
async fn disconnect_grok(app: tauri::AppHandle) -> Result<(), String> {
    let state = app.state::<AppState>();
    let mut guard = state.inner.lock().await;
    if let Some(session) = guard.session.take() {
        session.stop();
    }
    Ok(())
}

#[tauri::command]
async fn send_prompt(app: tauri::AppHandle, text: String) -> Result<String, String> {
    let state = app.state::<AppState>();
    let text = text.trim().to_string();
    if text.is_empty() {
        return Err("empty prompt".into());
    }
    let guard = state.inner.lock().await;
    let session = guard
        .session
        .as_ref()
        .ok_or_else(|| "not connected".to_string())?;
    session.prompt(text).await
}

#[tauri::command]
async fn cancel_prompt(app: tauri::AppHandle) -> Result<(), String> {
    let state = app.state::<AppState>();
    let guard = state.inner.lock().await;
    let session = guard
        .session
        .as_ref()
        .ok_or_else(|| "not connected".to_string())?;
    session.cancel()
}

#[tauri::command]
async fn respond_permission(
    app: tauri::AppHandle,
    request_id: u64,
    option_id: Option<String>,
) -> Result<(), String> {
    let state = app.state::<AppState>();
    let guard = state.inner.lock().await;
    let session = guard
        .session
        .as_ref()
        .ok_or_else(|| "not connected".to_string())?;
    session.respond_permission(request_id, option_id).await
}

#[tauri::command]
async fn session_status(app: tauri::AppHandle) -> SessionStatus {
    let state = app.state::<AppState>();
    let guard = state.inner.lock().await;
    match &guard.session {
        Some(s) => SessionStatus {
            connected: true,
            cwd: Some(s.cwd.display().to_string()),
            session_id: None,
            busy: false,
            error: None,
            load_session_supported: None,
        },
        None => SessionStatus {
            connected: false,
            cwd: None,
            session_id: None,
            busy: false,
            error: None,
            load_session_supported: None,
        },
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .manage(AppState::new())
        .invoke_handler(tauri::generate_handler![
            detect_agents,
            connect_grok,
            disconnect_grok,
            send_prompt,
            cancel_prompt,
            respond_permission,
            session_status
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detect_agents_includes_grok() {
        let agents = detect_agents();
        assert!(agents.iter().any(|a| a.id == "grok" && a.binary == "grok"));
    }
}

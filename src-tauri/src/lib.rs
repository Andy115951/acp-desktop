mod agent_backend;
mod acp_host;

use acp_host::{AcpSession, AppState, SessionStatus};
use agent_backend::{
    agent_override_status, detect_builtin_agents, enrich_connect_error, lookup_backend,
    missing_agent_message, resolve_agent_command, set_fake_agent_enabled, using_override_agent,
    AgentInfo, AgentOverrideStatus,
};
use std::path::PathBuf;
use tauri::Manager;

#[tauri::command]
fn detect_agents() -> Vec<AgentInfo> {
    detect_builtin_agents()
}

/// Connect the selected built-in agent (or fake/custom override) via ACP stdio.
///
/// UI must pass `agent_id` from `detect_agents` (e.g. `"grok"`). Vendor spawn
/// details stay behind [`agent_backend::AgentBackend`] — no UI fork per CLI.
#[tauri::command]
async fn connect_agent(
    app: tauri::AppHandle,
    agent_id: String,
    cwd: String,
    resume_session_id: Option<String>,
) -> Result<(), String> {
    let path = PathBuf::from(&cwd);
    if !path.is_dir() {
        return Err(format!("Not a directory: {cwd}"));
    }

    let backend = lookup_backend(&agent_id)?;
    if !using_override_agent() && !backend.detect() {
        return Err(missing_agent_message(backend));
    }
    let agent_argv = resolve_agent_command(backend)?;
    // Awaits initialize + session/new|load so Connect stays busy until ready.
    AcpSession::start(app, path, resume_session_id, agent_argv, agent_id.clone())
        .await
        .map_err(|e| enrich_connect_error(&agent_id, &e))
}

#[tauri::command]
async fn disconnect_agent(app: tauri::AppHandle) -> Result<(), String> {
    let state = app.state::<AppState>();
    let session = {
        let mut guard = state
            .inner
            .lock()
            .map_err(|_| "session state lock poisoned".to_string())?;
        guard.session.take()
    };
    if let Some(session) = session {
        // Clears any pending Ask oneshot before tearing down the ACP loop.
        session.stop().await;
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
    let session = {
        let guard = state
            .inner
            .lock()
            .map_err(|_| "session state lock poisoned".to_string())?;
        guard
            .session
            .as_ref()
            .ok_or_else(|| "not connected".to_string())?
            .clone()
    };
    session.prompt(text).await
}

#[tauri::command]
async fn cancel_prompt(app: tauri::AppHandle) -> Result<(), String> {
    let state = app.state::<AppState>();
    let session = {
        let guard = state
            .inner
            .lock()
            .map_err(|_| "session state lock poisoned".to_string())?;
        guard
            .session
            .as_ref()
            .ok_or_else(|| "not connected".to_string())?
            .clone()
    };
    session.cancel().await
}

#[tauri::command]
async fn respond_permission(
    app: tauri::AppHandle,
    request_id: u64,
    option_id: Option<String>,
) -> Result<(), String> {
    let state = app.state::<AppState>();
    let session = {
        let guard = state
            .inner
            .lock()
            .map_err(|_| "session state lock poisoned".to_string())?;
        guard
            .session
            .as_ref()
            .ok_or_else(|| "not connected".to_string())?
            .clone()
    };
    session.respond_permission(request_id, option_id).await
}

#[tauri::command]
fn get_agent_override() -> Result<AgentOverrideStatus, String> {
    agent_override_status()
}

#[tauri::command]
fn set_fake_agent(enabled: bool) -> Result<AgentOverrideStatus, String> {
    set_fake_agent_enabled(enabled)
}

#[tauri::command]
async fn session_status(app: tauri::AppHandle) -> SessionStatus {
    let state = app.state::<AppState>();
    let Ok(guard) = state.inner.lock() else {
        return SessionStatus {
            connected: false,
            cwd: None,
            session_id: None,
            busy: false,
            error: Some("session state lock poisoned".into()),
            load_session_supported: None,
        };
    };
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
            connect_agent,
            disconnect_agent,
            send_prompt,
            cancel_prompt,
            respond_permission,
            get_agent_override,
            set_fake_agent,
            session_status
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;
    use agent_backend::{resolve_default_agent_command, GrokBackend};
    use std::sync::Mutex;

    // Serialize env-mutating tests (cargo may run test threads in parallel).
    static ENV_LOCK: Mutex<()> = Mutex::new(());

    #[test]
    fn detect_agents_includes_grok_and_codex_connectable() {
        let agents = detect_agents();
        let grok = agents.iter().find(|a| a.id == "grok").expect("grok");
        assert_eq!(grok.binary, "grok");
        assert!(grok.connectable);
        assert!(agents.iter().any(|a| a.id == "codex" && a.connectable));
        assert!(agents.iter().any(|a| a.id == "claude" && !a.connectable));
    }

    #[test]
    fn resolve_agent_command_defaults_to_grok() {
        let _g = ENV_LOCK.lock().unwrap();
        std::env::remove_var("ACP_DESKTOP_AGENT_CMD");
        std::env::remove_var("ACP_DESKTOP_FAKE_AGENT");
        assert_eq!(
            resolve_default_agent_command().unwrap(),
            vec!["grok", "agent", "stdio"]
        );
        assert!(!using_override_agent());
    }

    #[test]
    fn resolve_agent_command_fake_flag() {
        let _g = ENV_LOCK.lock().unwrap();
        std::env::remove_var("ACP_DESKTOP_AGENT_CMD");
        std::env::set_var("ACP_DESKTOP_FAKE_AGENT", "1");
        let cmd = resolve_default_agent_command().expect("fake agent should resolve after cargo build");
        assert_eq!(cmd.len(), 1);
        assert!(
            cmd[0].ends_with("fake-acp-agent") || cmd[0].ends_with("fake-acp-agent.exe"),
            "unexpected fake agent path: {:?}",
            cmd
        );
        assert!(using_override_agent());
        std::env::remove_var("ACP_DESKTOP_FAKE_AGENT");
    }

    #[test]
    fn set_fake_agent_toggle_roundtrip() {
        let _g = ENV_LOCK.lock().unwrap();
        std::env::remove_var("ACP_DESKTOP_AGENT_CMD");
        std::env::remove_var("ACP_DESKTOP_FAKE_AGENT");
        let on = set_fake_agent_enabled(true).expect("enable fake");
        assert!(on.using_override);
        assert_eq!(on.mode, "fake");
        assert!(on.command[0].contains("fake-acp-agent"));
        let off = set_fake_agent_enabled(false).expect("disable fake");
        assert!(!off.using_override);
        assert_eq!(off.mode, "grok");
        assert_eq!(off.command, vec!["grok", "agent", "stdio"]);
    }

    #[test]
    fn resolve_agent_command_explicit_cmd() {
        let _g = ENV_LOCK.lock().unwrap();
        std::env::set_var("ACP_DESKTOP_AGENT_CMD", "/tmp/fake-acp-agent");
        std::env::set_var("ACP_DESKTOP_FAKE_AGENT", "1");
        assert_eq!(
            resolve_agent_command(&GrokBackend).unwrap(),
            vec!["/tmp/fake-acp-agent"]
        );
        std::env::remove_var("ACP_DESKTOP_AGENT_CMD");
        std::env::remove_var("ACP_DESKTOP_FAKE_AGENT");
    }

    #[test]
    fn lookup_rejects_unimplemented_agent() {
        match lookup_backend("claude") {
            Ok(_) => panic!("claude should not be connectable yet"),
            Err(err) => assert!(err.contains("M4") || err.contains("not wired"), "{err}"),
        }
    }
}

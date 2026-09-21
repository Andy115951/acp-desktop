//! Long-lived Grok ACP session bridged into Tauri.

use agent_client_protocol::schema::ProtocolVersion;
use agent_client_protocol::schema::v1::{
    CancelNotification, ContentBlock, InitializeRequest, LoadSessionRequest, NewSessionRequest,
    PermissionOptionKind, PromptRequest, RequestPermissionOutcome, RequestPermissionRequest,
    RequestPermissionResponse, SelectedPermissionOutcome, SessionId, SessionNotification,
    SessionUpdate, TextContent,
};
use agent_client_protocol::util::MatchDispatch;
use agent_client_protocol::{
    AcpAgent, Agent, Client, ConnectionTo, SessionMessage,
};
use serde::Serialize;
use std::env;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::{mpsc, oneshot, Mutex};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StreamEvent {
    pub kind: String,
    pub text: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PermissionEvent {
    pub request_id: u64,
    pub title: String,
    pub detail: String,
    pub options: Vec<PermissionOptionDto>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PermissionOptionDto {
    pub id: String,
    pub name: String,
    pub kind: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionStatus {
    pub connected: bool,
    pub cwd: Option<String>,
    pub session_id: Option<String>,
    pub busy: bool,
    pub error: Option<String>,
    /// Whether the agent advertised `agentCapabilities.loadSession` after initialize.
    pub load_session_supported: Option<bool>,
}


/// Resolve the ACP agent subprocess command.
///
/// Priority:
/// 1. `ACP_DESKTOP_AGENT_CMD` — whitespace-split command + args (for tests / custom agents)
/// 2. `ACP_DESKTOP_FAKE_AGENT=1` — spawn in-repo `fake-acp-agent` (PATH, then
///    workspace `target/{debug,release}/fake-acp-agent`)
/// 3. Default: `grok agent stdio`
pub fn resolve_agent_command() -> Result<Vec<String>, String> {
    if let Ok(cmd) = env::var("ACP_DESKTOP_AGENT_CMD") {
        let parts: Vec<String> = cmd.split_whitespace().map(|s| s.to_string()).collect();
        if parts.is_empty() {
            return Err("ACP_DESKTOP_AGENT_CMD is empty".into());
        }
        return Ok(parts);
    }

    let fake = env::var("ACP_DESKTOP_FAKE_AGENT").unwrap_or_default();
    if fake == "1" || fake.eq_ignore_ascii_case("true") {
        let path = find_fake_agent_bin().ok_or_else(|| {
            "fake-acp-agent not found (build with `cargo build -p fake-acp-agent`,              put it on PATH, or set ACP_DESKTOP_AGENT_CMD to its absolute path)"
                .to_string()
        })?;
        return Ok(vec![path.display().to_string()]);
    }

    Ok(vec!["grok".into(), "agent".into(), "stdio".into()])
}

pub fn using_override_agent() -> bool {
    env::var("ACP_DESKTOP_AGENT_CMD").is_ok()
        || matches!(
            env::var("ACP_DESKTOP_FAKE_AGENT").ok().as_deref(),
            Some("1") | Some("true") | Some("TRUE")
        )
}

/// Locate the in-repo fake agent binary for deterministic permission smoke.
pub fn find_fake_agent_bin() -> Option<PathBuf> {
    if binary_named_on_path("fake-acp-agent") {
        return Some(PathBuf::from("fake-acp-agent"));
    }

    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    // src-tauri crate → workspace root is parent
    let workspace = manifest_dir.parent().unwrap_or(manifest_dir.as_path());
    let mut candidates = vec![
        workspace.join("target/debug/fake-acp-agent"),
        workspace.join("target/release/fake-acp-agent"),
    ];
    #[cfg(windows)]
    {
        candidates.push(workspace.join("target/debug/fake-acp-agent.exe"));
        candidates.push(workspace.join("target/release/fake-acp-agent.exe"));
    }

    if let Ok(cwd) = env::current_dir() {
        candidates.push(cwd.join("target/debug/fake-acp-agent"));
        candidates.push(cwd.join("target/release/fake-acp-agent"));
        candidates.push(cwd.join("fake-acp-agent"));
    }

    for candidate in candidates {
        if candidate.is_file() {
            return Some(
                candidate
                    .canonicalize()
                    .unwrap_or(candidate),
            );
        }
    }
    None
}

fn binary_named_on_path(binary: &str) -> bool {
    let Some(path_os) = env::var_os("PATH") else {
        return false;
    };
    let names: Vec<PathBuf> = {
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
        for name in &names {
            let full = dir.join(name);
            if full.is_file() {
                return true;
            }
        }
    }
    false
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentOverrideStatus {
    /// `grok` | `fake` | `custom`
    pub mode: String,
    pub command: Vec<String>,
    pub using_override: bool,
    /// Absolute (or PATH) path when fake binary is resolvable.
    pub fake_agent_path: Option<String>,
}

pub fn agent_override_status() -> Result<AgentOverrideStatus, String> {
    let command = resolve_agent_command()?;
    let using_override = using_override_agent();
    let mode = if env::var("ACP_DESKTOP_AGENT_CMD").is_ok()
        && !matches!(
            env::var("ACP_DESKTOP_FAKE_AGENT").ok().as_deref(),
            Some("1") | Some("true") | Some("TRUE")
        )
    {
        "custom".into()
    } else if using_override {
        "fake".into()
    } else {
        "grok".into()
    };
    Ok(AgentOverrideStatus {
        mode,
        command,
        using_override,
        fake_agent_path: find_fake_agent_bin().map(|p| p.display().to_string()),
    })
}

/// Dev/session toggle: point the host at the in-repo fake agent (process env only).
pub fn set_fake_agent_enabled(enabled: bool) -> Result<AgentOverrideStatus, String> {
    if enabled {
        let path = find_fake_agent_bin().ok_or_else(|| {
            "fake-acp-agent not built. Run: cargo build -p fake-acp-agent".to_string()
        })?;
        // Prefer absolute CMD so spawn does not depend on PATH inside Tauri.
        env::set_var("ACP_DESKTOP_AGENT_CMD", path.display().to_string());
        env::set_var("ACP_DESKTOP_FAKE_AGENT", "1");
    } else {
        env::remove_var("ACP_DESKTOP_AGENT_CMD");
        env::remove_var("ACP_DESKTOP_FAKE_AGENT");
    }
    agent_override_status()
}

enum HostCommand {
    Prompt {
        text: String,
        reply: oneshot::Sender<Result<String, String>>,
    },
    Cancel,
    Stop,
}

struct PendingPermission {
    reply: oneshot::Sender<RequestPermissionResponse>,
}

pub struct AcpSession {
    cmd_tx: mpsc::UnboundedSender<HostCommand>,
    pending_permission: Arc<Mutex<Option<(u64, PendingPermission)>>>,
    #[allow(dead_code)]
    next_perm_id: Arc<Mutex<u64>>,
    pub cwd: PathBuf,
    #[allow(dead_code)]
    session_id: Arc<Mutex<Option<SessionId>>>,
}

impl AcpSession {
    /// Start a Grok ACP session.
    ///
    /// When `resume_session_id` is `Some`, uses `ConnectionTo::load_session` /
    /// `session/load` after initialize (if the agent advertises `loadSession`).
    /// Otherwise creates a new session via `session/new`.
    pub fn start(
        app: AppHandle,
        cwd: PathBuf,
        resume_session_id: Option<String>,
    ) -> Result<(), String> {
        let state = app.state::<AppState>();
        {
            let guard = state.inner.blocking_lock();
            if guard.session.is_some() {
                return Err("A session is already connected. Disconnect first.".into());
            }
        }

        let (cmd_tx, cmd_rx) = mpsc::unbounded_channel::<HostCommand>();
        let pending_permission: Arc<Mutex<Option<(u64, PendingPermission)>>> =
            Arc::new(Mutex::new(None));
        let next_perm_id = Arc::new(Mutex::new(1u64));
        let session_id: Arc<Mutex<Option<SessionId>>> = Arc::new(Mutex::new(None));

        let pending_for_handler = pending_permission.clone();
        let next_perm_for_handler = next_perm_id.clone();
        let app_for_handler = app.clone();
        let app_for_notif = app.clone();
        let cwd_for_task = cwd.clone();
        let session_id_for_task = session_id.clone();
        let app_for_status = app.clone();
        let resume_for_task = resume_session_id;

        // Spawn the ACP connection on a dedicated OS thread with its own runtime.
        std::thread::Builder::new()
            .name("acp-agent".into())
            .spawn(move || {
                let rt = tokio::runtime::Builder::new_multi_thread()
                    .enable_all()
                    .worker_threads(2)
                    .build()
                    .expect("tokio runtime");
                let _ = rt.block_on(async move {
                    let agent_args = match resolve_agent_command() {
                        Ok(args) => args,
                        Err(e) => {
                            let _ = app_for_status.emit(
                                "acp://status",
                                SessionStatus {
                                    connected: false,
                                    cwd: Some(cwd_for_task.display().to_string()),
                                    session_id: None,
                                    busy: false,
                                    error: Some(e),
                                    load_session_supported: None,
                                },
                            );
                            clear_session_slot(&app_for_status);
                            return;
                        }
                    };
                    let agent = match AcpAgent::from_args(agent_args) {
                        Ok(a) => a,
                        Err(e) => {
                            let _ = app_for_status.emit(
                                "acp://status",
                                SessionStatus {
                                    connected: false,
                                    cwd: Some(cwd_for_task.display().to_string()),
                                    session_id: None,
                                    busy: false,
                                    error: Some(format!("Failed to configure agent: {e}")),
                                    load_session_supported: None,
                                },
                            );
                            // Session slot is installed after spawn returns; clear if present.
                            clear_session_slot(&app_for_status);
                            return;
                        }
                    };

                    let connect_result = Client
                        .builder()
                        .name("acp-desktop")
                        .on_receive_notification(
                            {
                                let app = app_for_notif.clone();
                                async move |notification: SessionNotification, _cx| {
                                    emit_session_update(&app, &notification.update);
                                    Ok(())
                                }
                            },
                            agent_client_protocol::on_receive_notification!(),
                        )
                        .on_receive_request(
                            {
                                let pending = pending_for_handler.clone();
                                let next_id = next_perm_for_handler.clone();
                                let app = app_for_handler.clone();
                                async move |request: RequestPermissionRequest, responder, _cx| {
                                    let options: Vec<PermissionOptionDto> = request
                                        .options
                                        .iter()
                                        .map(|o| PermissionOptionDto {
                                            id: o.option_id.0.to_string(),
                                            name: o.name.clone(),
                                            kind: format!("{:?}", o.kind),
                                        })
                                        .collect();

                                    let title = request
                                        .tool_call
                                        .fields
                                        .title
                                        .clone()
                                        .unwrap_or_else(|| "Permission required".into());
                                    let detail = format!(
                                        "toolCallId={} kind={:?}",
                                        request.tool_call.tool_call_id.0,
                                        request.tool_call.fields.kind
                                    );

                                    let (tx, rx) = oneshot::channel();
                                    let request_id = {
                                        let mut n = next_id.lock().await;
                                        let id = *n;
                                        *n += 1;
                                        id
                                    };
                                    {
                                        let mut slot = pending.lock().await;
                                        *slot = Some((request_id, PendingPermission { reply: tx }));
                                    }
                                    let _ = app.emit(
                                        "acp://permission",
                                        PermissionEvent {
                                            request_id,
                                            title,
                                            detail,
                                            options,
                                        },
                                    );

                                    match rx.await {
                                        Ok(response) => responder.respond(response),
                                        Err(_) => responder.respond(RequestPermissionResponse::new(
                                            RequestPermissionOutcome::Cancelled,
                                        )),
                                    }
                                }
                            },
                            agent_client_protocol::on_receive_request!(),
                        )
                        .connect_with(agent, |connection: ConnectionTo<Agent>| {
                            let mut cmd_rx = cmd_rx;
                            let session_id = session_id_for_task.clone();
                            let app = app_for_status.clone();
                            let cwd = cwd_for_task.clone();
                            let resume_id = resume_for_task.clone();
                            async move {
                                let init = connection
                                    .send_request(InitializeRequest::new(ProtocolVersion::V1))
                                    .block_task()
                                    .await?;

                                let load_session_supported =
                                    init.agent_capabilities.load_session;

                                let _ = app.emit(
                                    "acp://status",
                                    SessionStatus {
                                        connected: true,
                                        cwd: Some(cwd.display().to_string()),
                                        session_id: None,
                                        busy: false,
                                        error: None,
                                        load_session_supported: Some(load_session_supported),
                                    },
                                );

                                let sid = if let Some(saved_id) = resume_id {
                                    if !load_session_supported {
                                        let msg = "Agent does not advertise loadSession; Resume is unavailable. Use New session.";
                                        let _ = app.emit(
                                            "acp://status",
                                            SessionStatus {
                                                connected: false,
                                                cwd: Some(cwd.display().to_string()),
                                                session_id: None,
                                                busy: false,
                                                error: Some(msg.into()),
                                                load_session_supported: Some(false),
                                            },
                                        );
                                        return Err(
                                            agent_client_protocol::Error::internal_error()
                                                .data(msg),
                                        );
                                    }

                                    let _ = app.emit(
                                        "acp://status",
                                        SessionStatus {
                                            connected: true,
                                            cwd: Some(cwd.display().to_string()),
                                            session_id: Some(saved_id.clone()),
                                            busy: true,
                                            error: None,
                                            load_session_supported: Some(true),
                                        },
                                    );

                                    // Prefer 2.2.x helpers so pre-response replay is routed.
                                    let restored = match connection
                                        .load_session_from(LoadSessionRequest::new(
                                            SessionId::new(saved_id.as_str()),
                                            cwd.clone(),
                                        ))
                                        .block_task()
                                        .start_session()
                                        .await
                                    {
                                        Ok(r) => r,
                                        Err(e) => {
                                            let msg = format!(
                                                "session/load failed: {e}. You can start a New session."
                                            );
                                            let _ = app.emit(
                                                "acp://status",
                                                SessionStatus {
                                                    connected: false,
                                                    cwd: Some(cwd.display().to_string()),
                                                    session_id: None,
                                                    busy: false,
                                                    error: Some(msg.clone()),
                                                    load_session_supported: Some(true),
                                                },
                                            );
                                            return Err(
                                                agent_client_protocol::Error::internal_error()
                                                    .data(msg),
                                            );
                                        }
                                    };

                                    let loaded_sid = restored.session().session_id().clone();
                                    // Drain replayed session/update into the chat UI, then drop
                                    // ActiveSession so later updates hit the connection handler.
                                    drain_load_replay(&app, restored.into_session()).await;
                                    loaded_sid
                                } else {
                                    let new_session = connection
                                        .send_request(NewSessionRequest::new(cwd.clone()))
                                        .block_task()
                                        .await?;
                                    new_session.session_id
                                };

                                {
                                    let mut slot = session_id.lock().await;
                                    *slot = Some(sid.clone());
                                }
                                let _ = app.emit(
                                    "acp://status",
                                    SessionStatus {
                                        connected: true,
                                        cwd: Some(cwd.display().to_string()),
                                        session_id: Some(sid.0.to_string()),
                                        busy: false,
                                        error: None,
                                        load_session_supported: Some(load_session_supported),
                                    },
                                );

                                while let Some(cmd) = cmd_rx.recv().await {
                                    match cmd {
                                        HostCommand::Prompt { text, reply } => {
                                            let _ = app.emit(
                                                "acp://status",
                                                SessionStatus {
                                                    connected: true,
                                                    cwd: Some(cwd.display().to_string()),
                                                    session_id: Some(sid.0.to_string()),
                                                    busy: true,
                                                    error: None,
                                                    load_session_supported: Some(
                                                        load_session_supported,
                                                    ),
                                                },
                                            );
                                            let result = connection
                                                .send_request(PromptRequest::new(
                                                    sid.clone(),
                                                    vec![ContentBlock::Text(TextContent::new(
                                                        text,
                                                    ))],
                                                ))
                                                .block_task()
                                                .await;
                                            let mapped = match result {
                                                Ok(r) => Ok(format!("{:?}", r.stop_reason)),
                                                Err(e) => Err(format!("prompt failed: {e}")),
                                            };
                                            let _ = reply.send(mapped);
                                            let _ = app.emit(
                                                "acp://status",
                                                SessionStatus {
                                                    connected: true,
                                                    cwd: Some(cwd.display().to_string()),
                                                    session_id: Some(sid.0.to_string()),
                                                    busy: false,
                                                    error: None,
                                                    load_session_supported: Some(
                                                        load_session_supported,
                                                    ),
                                                },
                                            );
                                        }
                                        HostCommand::Cancel => {
                                            let _ = connection.send_notification(
                                                CancelNotification::new(sid.clone()),
                                            );
                                        }
                                        HostCommand::Stop => break,
                                    }
                                }

                                Ok(())
                            }
                        })
                        .await;

                    if let Err(e) = connect_result {
                        let _ = app_for_status.emit(
                            "acp://status",
                            SessionStatus {
                                connected: false,
                                cwd: Some(cwd_for_task.display().to_string()),
                                session_id: None,
                                busy: false,
                                error: Some(format!("{e}")),
                                load_session_supported: None,
                            },
                        );
                    } else {
                        let _ = app_for_status.emit(
                            "acp://status",
                            SessionStatus {
                                connected: false,
                                cwd: Some(cwd_for_task.display().to_string()),
                                session_id: None,
                                busy: false,
                                error: None,
                                load_session_supported: None,
                            },
                        );
                    }
                    clear_session_slot(&app_for_status);
                });
            })
            .map_err(|e| format!("failed to spawn acp thread: {e}"))?;

        let session = AcpSession {
            cmd_tx,
            pending_permission,
            next_perm_id,
            cwd,
            session_id,
        };

        let mut guard = state.inner.blocking_lock();
        guard.session = Some(session);
        Ok(())
    }

    pub async fn prompt(&self, text: String) -> Result<String, String> {
        let (tx, rx) = oneshot::channel();
        self.cmd_tx
            .send(HostCommand::Prompt { text, reply: tx })
            .map_err(|_| "session channel closed".to_string())?;
        rx.await
            .map_err(|_| "session dropped before reply".to_string())?
    }

    pub fn cancel(&self) -> Result<(), String> {
        self.cmd_tx
            .send(HostCommand::Cancel)
            .map_err(|_| "session channel closed".to_string())
    }

    pub fn stop(&self) {
        let _ = self.cmd_tx.send(HostCommand::Stop);
    }

    pub async fn respond_permission(
        &self,
        request_id: u64,
        option_id: Option<String>,
    ) -> Result<(), String> {
        let pending = {
            let mut slot = self.pending_permission.lock().await;
            slot.take()
        };
        let Some((id, pending)) = pending else {
            return Err("no pending permission request".into());
        };
        if id != request_id {
            return Err("stale permission request id".into());
        }
        let response = match option_id {
            Some(oid) => RequestPermissionResponse::new(RequestPermissionOutcome::Selected(
                SelectedPermissionOutcome::new(oid),
            )),
            None => RequestPermissionResponse::new(RequestPermissionOutcome::Cancelled),
        };
        pending
            .reply
            .send(response)
            .map_err(|_| "permission responder gone".to_string())
    }
}

pub struct AppStateInner {
    pub session: Option<AcpSession>,
}

pub struct AppState {
    pub inner: Mutex<AppStateInner>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(AppStateInner { session: None }),
        }
    }
}

fn clear_session_slot(app: &AppHandle) {
    let state = app.state::<AppState>();
    let mut guard = state.inner.blocking_lock();
    guard.session = None;
}

fn content_block_text(block: &ContentBlock) -> String {
    match block {
        ContentBlock::Text(t) => t.text.clone(),
        other => format!("{other:?}"),
    }
}

fn emit_session_update(app: &AppHandle, update: &SessionUpdate) {
    let (kind, text) = match update {
        SessionUpdate::AgentMessageChunk(chunk) => {
            ("agent_message".into(), content_block_text(&chunk.content))
        }
        SessionUpdate::AgentThoughtChunk(chunk) => {
            ("agent_thought".into(), content_block_text(&chunk.content))
        }
        SessionUpdate::UserMessageChunk(chunk) => {
            ("user_message".into(), content_block_text(&chunk.content))
        }
        SessionUpdate::ToolCall(tc) => ("tool_call".into(), tc.title.clone()),
        SessionUpdate::ToolCallUpdate(u) => ("tool_call_update".into(), format!("{u:?}")),
        SessionUpdate::Plan(p) => ("plan".into(), format!("{p:?}")),
        other => ("other".into(), format!("{other:?}")),
    };
    let _ = app.emit("acp://stream", StreamEvent { kind, text });
}

/// Drain queued `session/load` replay updates into the UI, then return so
/// `ActiveSession` can be dropped and subsequent traffic uses the connection
/// notification handler.
async fn drain_load_replay(
    app: &AppHandle,
    mut session: agent_client_protocol::ActiveSession<'static, Agent>,
) {
    loop {
        tokio::select! {
            biased;
            result = session.read_update() => {
                match result {
                    Ok(SessionMessage::SessionMessage(dispatch)) => {
                        let app = app.clone();
                        let _ = MatchDispatch::new(dispatch)
                            .if_notification(async move |notif: SessionNotification| {
                                emit_session_update(&app, &notif.update);
                                Ok(())
                            })
                            .await;
                    }
                    Ok(SessionMessage::StopReason(_)) => {}
                    Ok(_) => {}
                    Err(_) => break,
                }
            }
            _ = tokio::time::sleep(Duration::from_millis(150)) => break,
        }
    }
}

// Silence unused import warnings for kinds we pattern on in UI helpers.
#[allow(dead_code)]
fn _kind_name(kind: &PermissionOptionKind) -> &'static str {
    match kind {
        PermissionOptionKind::AllowOnce => "AllowOnce",
        PermissionOptionKind::AllowAlways => "AllowAlways",
        PermissionOptionKind::RejectOnce => "RejectOnce",
        PermissionOptionKind::RejectAlways => "RejectAlways",
        _ => "Other",
    }
}

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
use std::sync::{Mutex as StdMutex};
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

/// Take the pending Ask only when `request_id` matches.
///
/// On mismatch the slot is left untouched so a later correct reply (or Cancel)
/// can still unblock `session/request_permission`. Taking-then-dropping on
/// stale ids used to cancel the real Ask by dropping the oneshot.
fn take_matching_permission(
    slot: &mut Option<(u64, PendingPermission)>,
    request_id: u64,
) -> Result<PendingPermission, String> {
    match slot.as_ref().map(|(id, _)| *id) {
        None => Err("no pending permission request".into()),
        Some(id) if id != request_id => Err("stale permission request id".into()),
        Some(_) => Ok(slot.take().expect("checked Some").1),
    }
}

/// Take a pending permission oneshot (if any) and reply with `Cancelled`.
///
/// Used when the UI Cancels a prompt while Ask is open: the host command loop
/// may be blocked inside `Prompt` awaiting the agent, so clearing the shared
/// slot here is what actually unblocks `session/request_permission`.
fn cancel_taken_permission(pending: Option<(u64, PendingPermission)>) -> bool {
    match pending {
        Some((_id, pending)) => {
            let _ = pending.reply.send(RequestPermissionResponse::new(
                RequestPermissionOutcome::Cancelled,
            ));
            true
        }
        None => false,
    }
}

async fn cancel_pending_permission(
    slot: &Mutex<Option<(u64, PendingPermission)>>,
) -> bool {
    let pending = { slot.lock().await.take() };
    cancel_taken_permission(pending)
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

impl Clone for AcpSession {
    fn clone(&self) -> Self {
        Self {
            cmd_tx: self.cmd_tx.clone(),
            pending_permission: self.pending_permission.clone(),
            next_perm_id: self.next_perm_id.clone(),
            cwd: self.cwd.clone(),
            session_id: self.session_id.clone(),
        }
    }
}

impl AcpSession {
    /// Start a Grok ACP session.
    ///
    /// When `resume_session_id` is `Some`, uses `ConnectionTo::load_session` /
    /// `session/load` after initialize (if the agent advertises `loadSession`).
    /// Otherwise creates a new session via `session/new`.
    /// Spawn the ACP thread and **await handshake** (`initialize` +
    /// `session/new` or `session/load`) before returning.
    ///
    /// Installs the session slot *before* the thread runs so Disconnect works
    /// during connect, and so early failures can `clear_session_slot` without
    /// racing a late install that would leave a zombie half-connected session.
    /// Returning only after ready keeps the UI `busy` flag honest: Connect /
    /// Resume stay disabled until the session is actually usable (or failed).
    pub async fn start(
        app: AppHandle,
        cwd: PathBuf,
        resume_session_id: Option<String>,
    ) -> Result<(), String> {
        let state = app.state::<AppState>();

        let (cmd_tx, cmd_rx) = mpsc::unbounded_channel::<HostCommand>();
        let pending_permission: Arc<Mutex<Option<(u64, PendingPermission)>>> =
            Arc::new(Mutex::new(None));
        let next_perm_id = Arc::new(Mutex::new(1u64));
        let session_id: Arc<Mutex<Option<SessionId>>> = Arc::new(Mutex::new(None));
        let (ready_tx, ready_rx) = oneshot::channel::<Result<(), String>>();

        let pending_for_handler = pending_permission.clone();
        let pending_for_cmds = pending_permission.clone();
        let next_perm_for_handler = next_perm_id.clone();
        let app_for_handler = app.clone();
        let app_for_notif = app.clone();
        let cwd_for_task = cwd.clone();
        let session_id_for_task = session_id.clone();
        let app_for_status = app.clone();
        let resume_for_task = resume_session_id;

        let session = AcpSession {
            cmd_tx,
            pending_permission,
            next_perm_id,
            cwd,
            session_id,
        };

        // Install before spawn so clear_session_slot / Disconnect always see it.
        {
            let mut guard = state
                .inner
                .lock()
                .map_err(|_| "session state lock poisoned".to_string())?;
            if guard.session.is_some() {
                return Err("A session is already connected. Disconnect first.".into());
            }
            guard.session = Some(session);
        }

        // Spawn the ACP connection on a dedicated OS thread with its own runtime.
        let ready_slot: ConnectReadySlot = Arc::new(StdMutex::new(Some(ready_tx)));
        let ready_for_thread = ready_slot.clone();
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
                            let msg = e.clone();
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
                            signal_connect_ready(&ready_for_thread, Err(msg));
                            return;
                        }
                    };
                    let agent = match AcpAgent::from_args(agent_args) {
                        Ok(a) => a,
                        Err(e) => {
                            let msg = format!("Failed to configure agent: {e}");
                            let _ = app_for_status.emit(
                                "acp://status",
                                SessionStatus {
                                    connected: false,
                                    cwd: Some(cwd_for_task.display().to_string()),
                                    session_id: None,
                                    busy: false,
                                    error: Some(msg.clone()),
                                    load_session_supported: None,
                                },
                            );
                            clear_session_slot(&app_for_status);
                            signal_connect_ready(&ready_for_thread, Err(msg));
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
                        .connect_with(agent, {
                            let ready_for_connect = ready_for_thread.clone();
                            let session_id_for_task = session_id_for_task.clone();
                            let app_for_inner = app_for_status.clone();
                            let cwd_for_inner = cwd_for_task.clone();
                            let resume_for_task = resume_for_task.clone();
                            let pending_for_cmds = pending_for_cmds.clone();
                            move |connection: ConnectionTo<Agent>| {
                            let mut cmd_rx = cmd_rx;
                            let session_id = session_id_for_task;
                            let app = app_for_inner;
                            let cwd = cwd_for_inner;
                            let resume_id = resume_for_task;
                            let pending_perms = pending_for_cmds;
                            let ready_for_thread = ready_for_connect;
                            async move {
                                let init = connection
                                    .send_request(InitializeRequest::new(ProtocolVersion::V1))
                                    .block_task()
                                    .await?;

                                let load_session_supported =
                                    init.agent_capabilities.load_session;

                                // Handshake still in progress — keep busy so UI
                                // Connect/Resume stay disabled until session id is set.
                                let _ = app.emit(
                                    "acp://status",
                                    SessionStatus {
                                        connected: true,
                                        cwd: Some(cwd.display().to_string()),
                                        session_id: None,
                                        busy: true,
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
                                    let n = drain_load_replay(&app, restored.into_session()).await;
                                    if n == 0 {
                                        // Surface a clear UI signal when load succeeded but
                                        // produced no replay chunks (agent quirk / empty history).
                                        let _ = app.emit(
                                            "acp://stream",
                                            StreamEvent {
                                                kind: "status".into(),
                                                text: "Resume: session loaded (no replayed history)"
                                                    .into(),
                                            },
                                        );
                                    }
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
                                // Unblock connect_grok only once the session is usable.
                                signal_connect_ready(&ready_for_thread, Ok(()));

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
                                            // Belt-and-suspenders: AcpSession::cancel already
                                            // clears the oneshot; no-op if already taken.
                                            let _ = cancel_pending_permission(&pending_perms).await;
                                            let _ = connection.send_notification(
                                                CancelNotification::new(sid.clone()),
                                            );
                                        }
                                        HostCommand::Stop => {
                                            let _ = cancel_pending_permission(&pending_perms).await;
                                            break;
                                        }
                                    }
                                }

                                Ok(())
                            }
                            }
                        })
                        .await;

                    if let Err(e) = connect_result {
                        let msg = format!("{e}");
                        let _ = app_for_status.emit(
                            "acp://status",
                            SessionStatus {
                                connected: false,
                                cwd: Some(cwd_for_task.display().to_string()),
                                session_id: None,
                                busy: false,
                                error: Some(msg.clone()),
                                load_session_supported: None,
                            },
                        );
                        // Handshake never completed — unblock await with Err.
                        signal_connect_ready(&ready_for_thread, Err(msg));
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
                        // Disconnect / agent exit after a successful ready: no-op.
                        signal_connect_ready(
                            &ready_for_thread,
                            Err("ACP session ended before ready".into()),
                        );
                    }
                    clear_session_slot(&app_for_status);
                });
            })
            .map_err(|e| {
                // Spawn failed — slot still holds the unused session handle.
                clear_session_slot(&app);
                format!("failed to spawn acp thread: {e}")
            })?;

        // Wait until initialize + session/new|load finishes (or fails).
        match ready_rx.await {
            Ok(result) => result,
            Err(_) => {
                clear_session_slot(&app);
                Err("ACP thread exited before connect ready".into())
            }
        }
    }

    pub async fn prompt(&self, text: String) -> Result<String, String> {
        // Clone sender first so callers can drop AppState lock before awaiting.
        let cmd_tx = self.cmd_tx.clone();
        let (tx, rx) = oneshot::channel();
        cmd_tx
            .send(HostCommand::Prompt { text, reply: tx })
            .map_err(|_| "session channel closed".to_string())?;
        rx.await
            .map_err(|_| "session dropped before reply".to_string())?
    }

    pub async fn cancel(&self) -> Result<(), String> {
        // Must clear pending Ask here: the cmd loop is often blocked inside
        // Prompt awaiting the agent, so HostCommand::Cancel alone cannot
        // unblock session/request_permission.
        let _ = cancel_pending_permission(&self.pending_permission).await;
        self.cmd_tx
            .send(HostCommand::Cancel)
            .map_err(|_| "session channel closed".to_string())
    }

    pub async fn stop(&self) {
        let _ = cancel_pending_permission(&self.pending_permission).await;
        let _ = self.cmd_tx.send(HostCommand::Stop);
    }

    pub async fn respond_permission(
        &self,
        request_id: u64,
        option_id: Option<String>,
    ) -> Result<(), String> {
        let pending = {
            let mut slot = self.pending_permission.lock().await;
            take_matching_permission(&mut slot, request_id)?
        };
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
    /// std mutex: short critical sections from both Tauri async commands
    /// and the dedicated ACP thread (must not use tokio blocking_lock).
    pub inner: StdMutex<AppStateInner>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            inner: StdMutex::new(AppStateInner { session: None }),
        }
    }
}


/// Shared slot so both the connect_with closure and the outer failure
/// paths can fire the connect-ready oneshot at most once.
type ConnectReadySlot = Arc<StdMutex<Option<oneshot::Sender<Result<(), String>>>>>;

fn signal_connect_ready(ready: &ConnectReadySlot, result: Result<(), String>) {
    let mut guard = ready.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(tx) = guard.take() {
        let _ = tx.send(result);
    }
}

fn clear_session_slot(app: &AppHandle) {
    let state = app.state::<AppState>();
    let mut guard = state.inner.lock().unwrap_or_else(|e| e.into_inner());
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
///
/// Important: `load_session_from` routes pre-response `session/update` into the
/// `ActiveSession` channel (they do **not** hit the connection-level
/// `on_receive_notification`). Dropping the session without draining loses
/// those updates. A short competing `select!` sleep was racing the first
/// replay chunk on slower hosts — wait up to `first_wait` for the first
/// update, then a short idle for trailing chunks.
///
/// Returns how many `session/update` notifications were drained.
async fn drain_load_replay(
    app: &AppHandle,
    mut session: agent_client_protocol::ActiveSession<'static, Agent>,
) -> usize {
    // Generous first-chunk budget: notification is queued before the load
    // response, but stdio + spawn scheduling can still lag briefly after
    // `start_session` returns.
    let first_wait = Duration::from_secs(2);
    let idle_after = Duration::from_millis(250);
    let mut drained = 0usize;
    let mut saw_any = false;
    let overall = tokio::time::Instant::now() + first_wait;

    loop {
        let now = tokio::time::Instant::now();
        if now >= overall && !saw_any {
            break;
        }
        let wait = if saw_any {
            idle_after
        } else {
            overall.saturating_duration_since(now)
        };
        if wait.is_zero() {
            break;
        }

        match tokio::time::timeout(wait, session.read_update()).await {
            Ok(Ok(SessionMessage::SessionMessage(dispatch))) => {
                let app = app.clone();
                let hit = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
                let hit_flag = hit.clone();
                let result = MatchDispatch::new(dispatch)
                    .if_notification(async move |notif: SessionNotification| {
                        emit_session_update(&app, &notif.update);
                        hit_flag.store(true, std::sync::atomic::Ordering::SeqCst);
                        Ok(())
                    })
                    .await
                    .otherwise_ignore();
                if result.is_ok() && hit.load(std::sync::atomic::Ordering::SeqCst) {
                    drained += 1;
                    saw_any = true;
                }
            }
            Ok(Ok(SessionMessage::StopReason(_))) => {
                // Load replay is notifications only; stop reasons are prompt-turn bookkeeping.
            }
            Ok(Ok(_)) => {}
            Ok(Err(_)) => break,
            Err(_) => break, // idle / first-chunk deadline
        }
    }

    drained
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

#[cfg(test)]
mod pending_permission_tests {
    use super::*;

    #[test]
    fn cancel_taken_permission_sends_cancelled() {
        assert!(!cancel_taken_permission(None));

        let (tx, mut rx) = oneshot::channel();
        assert!(cancel_taken_permission(Some((
            7,
            PendingPermission { reply: tx }
        ))));

        let resp = rx.try_recv().expect("oneshot should already be ready");
        assert!(matches!(
            resp.outcome,
            RequestPermissionOutcome::Cancelled
        ));
    }

    #[tokio::test]
    async fn cancel_pending_permission_clears_slot() {
        let slot: Mutex<Option<(u64, PendingPermission)>> = Mutex::new(None);
        assert!(!cancel_pending_permission(&slot).await);

        let (tx, rx) = oneshot::channel();
        *slot.lock().await = Some((3, PendingPermission { reply: tx }));
        assert!(cancel_pending_permission(&slot).await);
        assert!(slot.lock().await.is_none());

        let resp = rx.await.expect("oneshot");
        assert!(matches!(
            resp.outcome,
            RequestPermissionOutcome::Cancelled
        ));
        // Idempotent when empty.
        assert!(!cancel_pending_permission(&slot).await);
    }

    #[test]
    fn take_matching_leaves_slot_on_stale_id() {
        let (tx, mut rx) = oneshot::channel();
        let mut slot = Some((9u64, PendingPermission { reply: tx }));
        let err = match take_matching_permission(&mut slot, 1) {
            Err(e) => e,
            Ok(_) => panic!("expected stale id error"),
        };
        assert!(err.contains("stale"));
        assert!(slot.is_some(), "stale id must not take the pending Ask");
        assert!(rx.try_recv().is_err(), "oneshot must still be pending");

        let pending = take_matching_permission(&mut slot, 9).expect("match");
        assert!(slot.is_none());
        let _ = pending.reply.send(RequestPermissionResponse::new(
            RequestPermissionOutcome::Cancelled,
        ));
        assert!(rx.try_recv().is_ok());
    }

    #[test]
    fn take_matching_errors_when_empty() {
        let mut slot: Option<(u64, PendingPermission)> = None;
        let err = match take_matching_permission(&mut slot, 1) {
            Err(e) => e,
            Ok(_) => panic!("expected empty slot error"),
        };
        assert!(err.contains("no pending"));
    }

    /// After Cancel clears the slot, a late UI Allow must not panic — empty error.
    #[tokio::test]
    async fn cancel_then_take_matching_reports_no_pending() {
        let slot: Mutex<Option<(u64, PendingPermission)>> = Mutex::new(None);
        let (tx, rx) = oneshot::channel();
        *slot.lock().await = Some((4, PendingPermission { reply: tx }));
        assert!(cancel_pending_permission(&slot).await);
        let _ = rx.await;

        let mut guard = slot.lock().await;
        let err = match take_matching_permission(&mut guard, 4) {
            Err(e) => e,
            Ok(_) => panic!("expected no pending after cancel"),
        };
        assert!(err.contains("no pending"));
    }

    #[tokio::test]
    async fn signal_connect_ready_fires_once() {
        let (tx, rx) = oneshot::channel::<Result<(), String>>();
        let ready: ConnectReadySlot = Arc::new(StdMutex::new(Some(tx)));
        signal_connect_ready(&ready, Ok(()));
        assert!(ready.lock().unwrap().is_none());
        assert!(rx.await.expect("oneshot").is_ok());
        // Second signal is a no-op (channel already taken).
        signal_connect_ready(&ready, Err("late".into()));
    }

    #[tokio::test]
    async fn signal_connect_ready_forwards_err() {
        let (tx, rx) = oneshot::channel::<Result<(), String>>();
        let ready: ConnectReadySlot = Arc::new(StdMutex::new(Some(tx)));
        signal_connect_ready(&ready, Err("boom".into()));
        let err = rx.await.expect("oneshot").expect_err("err");
        assert!(err.contains("boom"));
    }
}

//! Long-lived ACP session bridged into Tauri (agent-agnostic stdio host).

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
use std::future::Future;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};
use crate::agent_backend::enrich_connect_error;
use std::sync::{Mutex as StdMutex};
use tokio::sync::{mpsc, oneshot, watch, Mutex};

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


// Agent command resolution / fake toggle: see `agent_backend`.

enum HostCommand {
    Prompt {
        text: String,
        reply: oneshot::Sender<Result<String, String>>,
    },
    Cancel,
}

/// Keep control commands responsive while a prompt waits on the agent.
async fn await_prompt<F: Future>(
    prompt: F,
    commands: &mut mpsc::UnboundedReceiver<HostCommand>,
    pending: &Mutex<Option<(u64, PendingPermission)>>,
    mut cancel: impl FnMut(),
) -> Option<F::Output> {
    tokio::pin!(prompt);
    loop {
        tokio::select! {
            result = &mut prompt => return Some(result),
            command = commands.recv() => match command {
                Some(HostCommand::Cancel) => {
                    cancel_pending_permission(pending).await;
                    cancel();
                }
                Some(HostCommand::Prompt { reply, .. }) => {
                    let _ = reply.send(Err("A prompt is already running.".into()));
                }
                None => return None,
            }
        }
    }
}

/// Disconnect can interrupt initialize, session/load and an active prompt.
async fn until_stopped<F: Future>(
    future: F,
    shutdown: &mut watch::Receiver<bool>,
) -> Option<F::Output> {
    tokio::select! {
        biased;
        _ = shutdown.wait_for(|stopped| *stopped) => None,
        result = future => Some(result),
    }
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

/// Install a new Ask oneshot, cancelling any previous pending Ask first.
///
/// Blind overwrite would drop the old oneshot (agent sees Cancelled via
/// rx Err) but is easy to miss in reviews; explicit Cancelled keeps the
/// contract obvious and covers a second `session/request_permission`
/// while the UI still shows the first card.
fn install_pending_permission(
    slot: &mut Option<(u64, PendingPermission)>,
    request_id: u64,
    reply: oneshot::Sender<RequestPermissionResponse>,
) -> bool {
    let replaced = cancel_taken_permission(slot.take());
    *slot = Some((request_id, PendingPermission { reply }));
    replaced
}

/// Take a pending permission oneshot (if any) and reply with `Cancelled`.
///
/// Used for Cancel, Disconnect and agent exit so no Ask responder is left
/// waiting after its session or prompt has ended.
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
    shutdown: watch::Sender<bool>,
    stopped: watch::Receiver<bool>,
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
            shutdown: self.shutdown.clone(),
            stopped: self.stopped.clone(),
            pending_permission: self.pending_permission.clone(),
            next_perm_id: self.next_perm_id.clone(),
            cwd: self.cwd.clone(),
            session_id: self.session_id.clone(),
        }
    }
}

impl AcpSession {
    /// Start an ACP stdio session for the given agent argv.
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
        agent_argv: Vec<String>,
        agent_id: String,
    ) -> Result<(), String> {
        let state = app.state::<AppState>();

        let (cmd_tx, cmd_rx) = mpsc::unbounded_channel::<HostCommand>();
        let (shutdown, mut shutdown_rx) = watch::channel(false);
        let (stopped_tx, stopped) = watch::channel(false);
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
        let agent_argv_for_task = agent_argv;
        let agent_id_for_task = agent_id.clone();

        let session = AcpSession {
            cmd_tx,
            shutdown,
            stopped,
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
                    let agent = match AcpAgent::from_args(agent_argv_for_task) {
                        Ok(a) => a,
                        Err(e) => {
                            let msg = enrich_connect_error(
                                &agent_id_for_task,
                                &format!("Failed to configure agent: {e}"),
                            );
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

                    let connection = Client
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
                                        let _ = install_pending_permission(&mut slot, request_id, tx);
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
                            let agent_id_for_prompt = agent_id_for_task.clone();
                            move |connection: ConnectionTo<Agent>| {
                            let mut cmd_rx = cmd_rx;
                            let session_id = session_id_for_task;
                            let app = app_for_inner;
                            let cwd = cwd_for_inner;
                            let resume_id = resume_for_task;
                            let pending_perms = pending_for_cmds;
                            let ready_for_thread = ready_for_connect;
                            let agent_id_for_prompt = agent_id_for_prompt;
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

                                    // Do NOT emit session_id until load succeeds. Emitting the
                                    // saved id while busy caused the UI to re-persist a dead
                                    // Resume id over the clear-on-failure path (FS_NOT_FOUND).
                                    let _ = app.emit(
                                        "acp://status",
                                        SessionStatus {
                                            connected: true,
                                            cwd: Some(cwd.display().to_string()),
                                            session_id: None,
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
                                            // Keep "session/load failed" prefix for UI matchers;
                                            // point users at Connect rather than raw FS_NOT_FOUND.
                                            let msg = format!(
                                                "session/load failed: {e}. Saved session is missing or expired — use Connect (New session)."
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
                                        // Replay can also arrive through the connection-level
                                        // handler, so an empty drain does not imply no history.
                                        let _ = app.emit(
                                            "acp://stream",
                                            StreamEvent {
                                                kind: "status".into(),
                                                text: "Resume: session loaded"
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
                                // Unblock connect_agent only once the session is usable.
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
                                            let prompt = connection
                                                .send_request(PromptRequest::new(
                                                    sid.clone(),
                                                    vec![ContentBlock::Text(TextContent::new(
                                                        text,
                                                    ))],
                                                ))
                                                .block_task();
                                            let Some(result) = await_prompt(
                                                prompt,
                                                &mut cmd_rx,
                                                &pending_perms,
                                                || {
                                                    let _ = connection.send_notification(
                                                        CancelNotification::new(sid.clone()),
                                                    );
                                                },
                                            ).await else {
                                                break;
                                            };
                                            let mapped = match result {
                                                Ok(r) => Ok(format!("{:?}", r.stop_reason)),
                                                Err(e) => Err(enrich_connect_error(
                                                    &agent_id_for_prompt,
                                                    &format!("prompt failed: {e}"),
                                                )),
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
                                    }
                                }

                                Ok(())
                            }
                            }
                        });

                    let connect_result = until_stopped(connection, &mut shutdown_rx).await;
                    cancel_pending_permission(&pending_for_handler).await;

                    if let Some(Err(e)) = connect_result {
                        let msg = enrich_connect_error(&agent_id_for_task, &format!("{e}"));
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
                    // Disconnect must await final status + slot cleanup before a
                    // replacement session can publish its own events.
                    stopped_tx.send_replace(true);
                });
            })
            .map_err(|e| {
                // Spawn failed — slot still holds the unused session handle.
                clear_session_slot(&app);
                enrich_connect_error(&agent_id, &format!("failed to spawn acp thread: {e}"))
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
        // Release the Ask immediately as well as notifying the running agent.
        let _ = cancel_pending_permission(&self.pending_permission).await;
        self.cmd_tx
            .send(HostCommand::Cancel)
            .map_err(|_| "session channel closed".to_string())
    }

    pub async fn stop(&self) {
        let _ = cancel_pending_permission(&self.pending_permission).await;
        self.shutdown.send_replace(true);
        let _ = self.stopped.clone().wait_for(|stopped| *stopped).await;
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

/// Map an ACP `session/update` into a UI stream event, or `None` when the
/// update is session metadata (commands / mode / config / info / usage) that
/// must not appear as a chat bubble.
///
/// The previous catch-all used `Debug` formatting (`AvailableCommandsUpdate(...)`,
/// etc.), which leaked raw enum dumps into the transcript.
fn stream_event_for_session_update(update: &SessionUpdate) -> Option<StreamEvent> {
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
        SessionUpdate::ToolCallUpdate(u) => {
            let status = u
                .fields
                .status
                .as_ref()
                .map(|s| format!("{s:?}"))
                .unwrap_or_else(|| "updated".into());
            let label = u
                .fields
                .title
                .clone()
                .unwrap_or_else(|| u.tool_call_id.0.to_string());
            ("tool_call_update".into(), format!("{label} · {status}"))
        }
        SessionUpdate::Plan(p) => {
            let n = p.entries.len();
            let summary = if n == 0 {
                "plan (empty)".into()
            } else {
                let first = p
                    .entries
                    .first()
                    .map(|e| e.content.as_str())
                    .unwrap_or("");
                if n == 1 {
                    format!("plan: {first}")
                } else {
                    format!("plan ({n} steps): {first}…")
                }
            };
            ("plan".into(), summary)
        }
        // Non-chat session metadata — keep off the transcript entirely.
        SessionUpdate::AvailableCommandsUpdate(_)
        | SessionUpdate::CurrentModeUpdate(_)
        | SessionUpdate::ConfigOptionUpdate(_)
        | SessionUpdate::SessionInfoUpdate(_)
        | SessionUpdate::UsageUpdate(_) => return None,
        // `SessionUpdate` is non_exhaustive; never Debug-dump unknowns into chat.
        _ => return None,
    };
    Some(StreamEvent { kind, text })
}

fn emit_session_update(app: &AppHandle, update: &SessionUpdate) {
    if let Some(event) = stream_event_for_session_update(update) {
        let _ = app.emit("acp://stream", event);
    }
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
mod session_control_tests {
    use super::*;
    use agent_client_protocol::schema::v1::{InitializeResponse, PromptResponse, StopReason};
    use agent_client_protocol::Responder;
    use std::future::pending;

    const DEADLINE: Duration = Duration::from_millis(250);

    #[tokio::test]
    async fn cancel_reaches_agent_before_prompt_finishes() {
        let (tx, mut commands) = mpsc::unbounded_channel();
        let pending_permission = Mutex::new(None);
        let (cancel_tx, cancel_rx) = oneshot::channel();
        let mut cancel_tx = Some(cancel_tx);
        tx.send(HostCommand::Cancel).unwrap();

        let result = tokio::time::timeout(
            DEADLINE,
            await_prompt(
                async {
                    cancel_rx.await.expect("cancel notification");
                    "cancelled"
                },
                &mut commands,
                &pending_permission,
                || {
                    cancel_tx.take().unwrap().send(()).unwrap();
                },
            ),
        )
        .await
        .expect("Cancel must reach the agent while its prompt is running");

        assert_eq!(result, Some("cancelled"));
    }

    #[tokio::test]
    async fn running_agent_receives_session_cancel_without_a_permission_request() {
        let (tx, mut commands) = mpsc::unbounded_channel();
        let pending_prompt = Arc::new(Mutex::new(None::<Responder<PromptResponse>>));
        let prompt_slot = pending_prompt.clone();
        let cancel_slot = pending_prompt.clone();
        // An in-memory ACP agent only finishes its prompt after it receives
        // session/cancel. No Ask response can accidentally unblock this turn.
        let agent = Agent
            .builder()
            .on_receive_request(
                async move |request: InitializeRequest, responder, _cx| {
                    responder.respond(InitializeResponse::new(request.protocol_version))
                },
                agent_client_protocol::on_receive_request!(),
            )
            .on_receive_request(
                async move |_request: PromptRequest, responder, _cx| {
                    *prompt_slot.lock().await = Some(responder);
                    tx.send(HostCommand::Cancel).unwrap();
                    Ok(())
                },
                agent_client_protocol::on_receive_request!(),
            )
            .on_receive_notification(
                async move |cancel: CancelNotification, _cx| {
                    assert_eq!(cancel.session_id, SessionId::new("interrupt-session"));
                    cancel_slot
                        .lock()
                        .await
                        .take()
                        .unwrap()
                        .respond(PromptResponse::new(StopReason::Cancelled))
                },
                agent_client_protocol::on_receive_notification!(),
            );
        let client = Client
            .builder()
            .connect_with(agent, async move |connection| {
                connection
                    .send_request(InitializeRequest::new(ProtocolVersion::V1))
                    .block_task()
                    .await?;
                let sid = SessionId::new("interrupt-session");
                let result = await_prompt(
                    connection
                        .send_request(PromptRequest::new(
                            sid.clone(),
                            vec![ContentBlock::Text(TextContent::new(
                                "wait for cancellation",
                            ))],
                        ))
                        .block_task(),
                    &mut commands,
                    &Mutex::new(None),
                    || {
                        connection
                            .send_notification(CancelNotification::new(sid.clone()))
                            .unwrap();
                    },
                )
                .await
                .expect("command channel remains open")?;
                assert_eq!(result.stop_reason, StopReason::Cancelled);
                Ok(())
            });

        tokio::time::timeout(Duration::from_secs(5), client)
            .await
            .expect("agent must receive Cancel before its prompt can finish")
            .expect("ACP cancellation round trip");
        assert!(pending_prompt.lock().await.is_none());
    }

    #[tokio::test]
    async fn disconnect_interrupts_an_unresponsive_connection() {
        let (shutdown, mut shutdown_rx) = watch::channel(false);
        let (started_tx, started_rx) = oneshot::channel();
        let connection = tokio::spawn(async move {
            until_stopped(
                async {
                    started_tx.send(()).unwrap();
                    pending::<()>().await;
                },
                &mut shutdown_rx,
            )
            .await
        });
        started_rx.await.unwrap();
        shutdown.send(true).unwrap();

        let result = tokio::time::timeout(DEADLINE, connection)
            .await
            .expect("Disconnect must interrupt handshake or prompt")
            .unwrap();
        assert_eq!(result, None);
    }

    #[tokio::test]
    async fn overlapping_prompt_is_rejected_without_delaying_cancel() {
        let (tx, mut commands) = mpsc::unbounded_channel();
        let pending_permission = Mutex::new(None);
        let (reply, rejected) = oneshot::channel();
        let (cancel_tx, cancel_rx) = oneshot::channel();
        let mut cancel_tx = Some(cancel_tx);
        tx.send(HostCommand::Prompt {
            text: "second turn".into(),
            reply,
        })
        .unwrap();
        tx.send(HostCommand::Cancel).unwrap();

        tokio::time::timeout(
            DEADLINE,
            await_prompt(
                async {
                    cancel_rx.await.unwrap();
                },
                &mut commands,
                &pending_permission,
                || {
                    cancel_tx.take().unwrap().send(()).unwrap();
                },
            ),
        )
        .await
        .unwrap();
        assert_eq!(
            rejected.await.unwrap().unwrap_err(),
            "A prompt is already running."
        );
    }

    #[tokio::test]
    async fn cancelling_prompt_resolves_pending_permission() {
        let (tx, mut commands) = mpsc::unbounded_channel();
        let (permission_tx, permission_rx) = oneshot::channel();
        let pending_permission = Mutex::new(Some((
            1,
            PendingPermission {
                reply: permission_tx,
            },
        )));
        tx.send(HostCommand::Cancel).unwrap();

        let result = tokio::time::timeout(
            DEADLINE,
            await_prompt(permission_rx, &mut commands, &pending_permission, || {}),
        )
        .await
        .unwrap()
        .unwrap()
        .unwrap();

        assert!(matches!(
            result.outcome,
            RequestPermissionOutcome::Cancelled
        ));
        assert!(pending_permission.lock().await.is_none());
    }

    #[tokio::test]
    async fn completed_prompt_returns_normally() {
        let (_tx, mut commands) = mpsc::unbounded_channel();
        assert_eq!(
            await_prompt(
                async { "end_turn" },
                &mut commands,
                &Mutex::new(None),
                || panic!("completed turn must not be cancelled"),
            )
            .await,
            Some("end_turn")
        );
    }

    #[tokio::test]
    async fn disconnect_before_connection_starts_does_not_poll_it() {
        let (_shutdown, mut shutdown_rx) = watch::channel(true);
        let result = until_stopped(
            async {
                panic!("connection must not start after Disconnect");
            },
            &mut shutdown_rx,
        )
        .await;
        assert_eq!(result, None);
    }

    #[tokio::test]
    async fn stop_waits_for_worker_cleanup() {
        let (cmd_tx, _commands) = mpsc::unbounded_channel();
        let (shutdown, mut shutdown_rx) = watch::channel(false);
        let (stopped_tx, stopped) = watch::channel(false);
        let session = AcpSession {
            cmd_tx,
            shutdown,
            stopped,
            pending_permission: Arc::new(Mutex::new(None)),
            next_perm_id: Arc::new(Mutex::new(1)),
            cwd: PathBuf::from("."),
            session_id: Arc::new(Mutex::new(None)),
        };
        let stop = session.stop();
        tokio::pin!(stop);
        tokio::time::timeout(DEADLINE, async {
            tokio::select! {
                _ = &mut stop => panic!("Disconnect returned before worker cleanup"),
                _ = shutdown_rx.wait_for(|shutdown| *shutdown) => {},
            }
        })
        .await
        .unwrap();
        assert!(!*session.stopped.borrow());

        stopped_tx.send_replace(true);
        tokio::time::timeout(DEADLINE, stop).await.unwrap();
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

    #[test]
    fn install_pending_replaces_and_cancels_previous() {
        let (tx1, mut rx1) = oneshot::channel();
        let mut slot = Some((1u64, PendingPermission { reply: tx1 }));
        let (tx2, mut rx2) = oneshot::channel();
        assert!(install_pending_permission(&mut slot, 2, tx2));
        assert_eq!(slot.as_ref().map(|(id, _)| *id), Some(2));
        let resp = rx1.try_recv().expect("previous Ask cancelled");
        assert!(matches!(
            resp.outcome,
            RequestPermissionOutcome::Cancelled
        ));
        assert!(rx2.try_recv().is_err(), "new Ask still pending");
        let pending = take_matching_permission(&mut slot, 2).expect("match");
        let _ = pending.reply.send(RequestPermissionResponse::new(
            RequestPermissionOutcome::Cancelled,
        ));
        assert!(rx2.try_recv().is_ok());
    }

    #[test]
    fn install_pending_into_empty_slot() {
        let mut slot: Option<(u64, PendingPermission)> = None;
        let (tx, mut rx) = oneshot::channel();
        assert!(!install_pending_permission(&mut slot, 5, tx));
        assert_eq!(slot.as_ref().map(|(id, _)| *id), Some(5));
        assert!(rx.try_recv().is_err());
    }
}


#[cfg(test)]
mod stream_event_mapping_tests {
    use super::*;
    use agent_client_protocol::schema::v1::{
        AvailableCommandsUpdate, ContentChunk, CurrentModeUpdate, Plan, PlanEntry,
        PlanEntryPriority, PlanEntryStatus, SessionInfoUpdate, SessionModeId, TextContent,
        ToolCall, ToolCallId, ToolCallStatus, ToolCallUpdate, ToolCallUpdateFields, UsageUpdate,
    };

    #[test]
    fn agent_message_chunk_emits_text() {
        let update = SessionUpdate::AgentMessageChunk(ContentChunk::new(ContentBlock::Text(
            TextContent::new("hello"),
        )));
        let ev = stream_event_for_session_update(&update).expect("emit");
        assert_eq!(ev.kind, "agent_message");
        assert_eq!(ev.text, "hello");
    }

    #[test]
    fn available_commands_update_is_filtered() {
        let update =
            SessionUpdate::AvailableCommandsUpdate(AvailableCommandsUpdate::new(vec![]));
        assert!(
            stream_event_for_session_update(&update).is_none(),
            "AvailableCommandsUpdate must not become a chat bubble"
        );
    }

    #[test]
    fn other_metadata_updates_are_filtered() {
        let cases = [
            SessionUpdate::CurrentModeUpdate(CurrentModeUpdate::new(SessionModeId::new("default"))),
            SessionUpdate::SessionInfoUpdate(SessionInfoUpdate::new()),
            SessionUpdate::UsageUpdate(UsageUpdate::new(1, 2)),
        ];
        for update in cases {
            assert!(
                stream_event_for_session_update(&update).is_none(),
                "metadata update must not leak: {update:?}"
            );
        }
    }

    #[test]
    fn tool_call_update_is_compact_not_debug_dump() {
        let update = SessionUpdate::ToolCallUpdate(ToolCallUpdate::new(
            ToolCallId::new("tc-1"),
            ToolCallUpdateFields::new()
                .title("Read file")
                .status(ToolCallStatus::Completed),
        ));
        let ev = stream_event_for_session_update(&update).expect("emit");
        assert_eq!(ev.kind, "tool_call_update");
        assert!(ev.text.contains("Read file"), "{}", ev.text);
        assert!(ev.text.contains("Completed"), "{}", ev.text);
        assert!(
            !ev.text.contains("ToolCallUpdate"),
            "must not Debug-dump the whole update: {}",
            ev.text
        );
    }

    #[test]
    fn tool_call_emits_title() {
        let update = SessionUpdate::ToolCall(ToolCall::new(ToolCallId::new("tc-2"), "Shell"));
        let ev = stream_event_for_session_update(&update).expect("emit");
        assert_eq!(ev.kind, "tool_call");
        assert_eq!(ev.text, "Shell");
    }

    #[test]
    fn plan_is_compact_summary() {
        let update = SessionUpdate::Plan(Plan::new(vec![PlanEntry::new(
            "step one",
            PlanEntryPriority::Medium,
            PlanEntryStatus::Pending,
        )]));
        let ev = stream_event_for_session_update(&update).expect("emit");
        assert_eq!(ev.kind, "plan");
        assert!(ev.text.contains("step one"), "{}", ev.text);
        assert!(
            !ev.text.starts_with("Plan "),
            "must not Debug-dump Plan: {}",
            ev.text
        );
    }
}

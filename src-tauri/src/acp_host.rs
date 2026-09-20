//! Long-lived Grok ACP session bridged into Tauri.

use agent_client_protocol::schema::ProtocolVersion;
use agent_client_protocol::schema::v1::{
    CancelNotification, ContentBlock, InitializeRequest, NewSessionRequest,
    PermissionOptionKind, PromptRequest, RequestPermissionOutcome, RequestPermissionRequest,
    RequestPermissionResponse, SelectedPermissionOutcome, SessionId, SessionNotification,
    SessionUpdate, TextContent,
};
use agent_client_protocol::{AcpAgent, Agent, Client, ConnectionTo};
use serde::Serialize;
use std::path::PathBuf;
use std::sync::Arc;
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
    pub fn start(app: AppHandle, cwd: PathBuf) -> Result<(), String> {
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

        // Spawn the ACP connection on a dedicated OS thread with its own runtime.
        std::thread::Builder::new()
            .name("acp-grok".into())
            .spawn(move || {
                let rt = tokio::runtime::Builder::new_multi_thread()
                    .enable_all()
                    .worker_threads(2)
                    .build()
                    .expect("tokio runtime");
                let _ = rt.block_on(async move {
                    let agent = match AcpAgent::from_args(["grok", "agent", "stdio"]) {
                        Ok(a) => a,
                        Err(e) => {
                            let _ = app_for_status.emit(
                                "acp://status",
                                SessionStatus {
                                    connected: false,
                                    cwd: Some(cwd_for_task.display().to_string()),
                                    session_id: None,
                                    busy: false,
                                    error: Some(format!("Failed to configure grok: {e}")),
                                },
                            );
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
                            async move {
                                let _init = connection
                                    .send_request(InitializeRequest::new(ProtocolVersion::V1))
                                    .block_task()
                                    .await?;

                                let _ = app.emit(
                                    "acp://status",
                                    SessionStatus {
                                        connected: true,
                                        cwd: Some(cwd.display().to_string()),
                                        session_id: None,
                                        busy: false,
                                        error: None,
                                    },
                                );
                                                                let new_session = connection
                                    .send_request(NewSessionRequest::new(cwd.clone()))
                                    .block_task()
                                    .await?;

                                let sid = new_session.session_id.clone();
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
                            },
                        );
                    }
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

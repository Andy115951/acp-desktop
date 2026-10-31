//! Bounded, capability-gated metadata discovery. Never creates/loads a session.
use agent_client_protocol::schema::v1::{ListSessionsRequest, ListSessionsResponse};
use agent_client_protocol::{Agent, ConnectionTo};
use serde::Serialize;
use std::{collections::HashSet, future::Future, path::{Path, PathBuf}, time::Duration};
use tokio::time::{timeout_at, Instant};

/// Tie discovery to the lifetime of its connection, including cancellation.
pub struct DiscoveryTask(tokio::task::JoinHandle<()>);

impl Drop for DiscoveryTask {
    fn drop(&mut self) { self.0.abort(); }
}

/// Start listing after the session is ready; never hold Connect or Resume on it.
pub fn start_discovery(
    connection: ConnectionTo<Agent>,
    agent_id: String,
    cwd: PathBuf,
    supported: bool,
    report: impl FnOnce(SessionDiscovery) + Send + 'static,
) -> DiscoveryTask {
    DiscoveryTask(tokio::spawn(async move {
        let result = discover_sessions(&connection, &agent_id, &cwd, supported).await;
        report(result);
    }))
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveredSession {
    pub session_id: String,
    pub cwd: String,
    pub title: Option<String>,
    pub updated_at: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionDiscovery {
    pub agent_id: String,
    pub cwd: String,
    pub supported: bool,
    pub sessions: Vec<DiscoveredSession>,
    /// Timeout/error/cyclic cursor/safety limit: keep app-known and partial results.
    pub incomplete: bool,
}

pub async fn discover_sessions(
    connection: &ConnectionTo<Agent>,
    agent_id: &str,
    cwd: &Path,
    supported: bool,
) -> SessionDiscovery {
    collect_pages(
        agent_id,
        cwd,
        supported,
        Duration::from_secs(10),
        |cursor| {
            let request = ListSessionsRequest::new()
                .cwd(cwd.to_path_buf())
                .cursor(cursor);
            async move {
                connection
                    .send_request(request)
                    .block_task()
                    .await
                    .map_err(|error| error.to_string())
            }
        },
    )
    .await
}

async fn collect_pages<F, Fut>(
    agent_id: &str,
    cwd: &Path,
    supported: bool,
    timeout: Duration,
    mut fetch: F,
) -> SessionDiscovery
where
    F: FnMut(Option<String>) -> Fut,
    Fut: Future<Output = Result<ListSessionsResponse, String>>,
{
    let mut result = SessionDiscovery {
        agent_id: agent_id.into(),
        cwd: cwd.display().to_string(),
        supported,
        sessions: vec![],
        incomplete: false,
    };
    if !supported {
        return result;
    }
    let deadline = Instant::now() + timeout;
    let mut cursor = None;
    let mut cursors = HashSet::new();
    let mut ids = HashSet::new();
    // Bound both request count and retained metadata; do not block Connect indefinitely.
    for _ in 0..20 {
        let page = match timeout_at(deadline, fetch(cursor)).await {
            Ok(Ok(page)) => page,
            _ => {
                result.incomplete = true;
                return result;
            }
        };
        for entry in page.sessions {
            if entry.cwd != cwd
                || entry.session_id.0.trim().is_empty()
                || !ids.insert(entry.session_id.0.to_string())
            {
                continue;
            }
            if result.sessions.len() == 2000 {
                result.incomplete = true;
                return result;
            }
            result.sessions.push(DiscoveredSession {
                session_id: entry.session_id.0.to_string(),
                cwd: entry.cwd.display().to_string(),
                title: entry.title,
                updated_at: entry.updated_at,
            });
        }
        match page.next_cursor {
            None => return result,
            Some(next) if cursors.insert(next.clone()) => cursor = Some(next),
            _ => {
                result.incomplete = true;
                return result;
            }
        }
    }
    result.incomplete = true;
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use agent_client_protocol::schema::v1::{ContentBlock, InitializeRequest, InitializeResponse, ListSessionsRequest, NewSessionRequest, NewSessionResponse, PromptRequest, PromptResponse, SessionInfo, StopReason, TextContent};
    use agent_client_protocol::{Agent, Client, ConnectionTo};
    use std::collections::VecDeque;

    fn info(id: &str, cwd: &str) -> SessionInfo {
        SessionInfo::new(id.to_string(), cwd)
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn slow_listing_does_not_delay_a_ready_session_or_first_prompt() {
        use std::sync::{Arc, Mutex};
        use tokio::sync::oneshot;
        let (listed_tx, listed_rx) = oneshot::channel();
        let listed_tx = Arc::new(Mutex::new(Some(listed_tx)));
        let pending = Arc::new(Mutex::new(None));
        let list_pending = pending.clone();
        let agent = Agent.builder()
            .on_receive_request(async move |request: InitializeRequest, responder, _cx| {
                responder.respond(InitializeResponse::new(request.protocol_version))
            }, agent_client_protocol::on_receive_request!())
            .on_receive_request(async move |_request: NewSessionRequest, responder, _cx| {
                responder.respond(NewSessionResponse::new("ready-session"))
            }, agent_client_protocol::on_receive_request!())
            .on_receive_request(async move |_request: ListSessionsRequest, responder, _cx| {
                *list_pending.lock().unwrap() = Some(responder);
                if let Some(tx) = listed_tx.lock().unwrap().take() { let _ = tx.send(()); }
                Ok(())
            }, agent_client_protocol::on_receive_request!())
            .on_receive_request(async move |_request: PromptRequest, responder, _cx| {
                responder.respond(PromptResponse::new(StopReason::EndTurn))
            }, agent_client_protocol::on_receive_request!());
        let client = Client.builder().connect_with(agent, move |connection: ConnectionTo<Agent>| async move {
            crate::protocol_init::initialize_v1(&connection).await?;
            let session = connection.send_request(NewSessionRequest::new("/one")).block_task().await?;
            let (reported_tx, reported_rx) = oneshot::channel();
            let _discovery = start_discovery(connection.clone(), "agent".into(), "/one".into(), true, move |result| { let _ = reported_tx.send(result); });
            tokio::time::timeout(Duration::from_secs(1), listed_rx).await.unwrap().unwrap();
            // The listing response is still withheld. The usable session and its
            // first prompt must not wait for that slow background operation.
            let prompt = connection.send_request(PromptRequest::new(session.session_id,
                vec![ContentBlock::Text(TextContent::new("fixture"))])).block_task();
            let result = tokio::time::timeout(Duration::from_secs(1), prompt).await.expect("prompt blocked on history discovery")?;
            assert_eq!(result.stop_reason, StopReason::EndTurn);
            pending.lock().unwrap().take().unwrap().respond(ListSessionsResponse::new(vec![info("earlier", "/one")]))?;
            let reported = tokio::time::timeout(Duration::from_secs(1), reported_rx).await.unwrap().unwrap();
            assert_eq!(reported.sessions[0].session_id, "earlier");
            assert!(!reported.incomplete);
            Ok(())
        });
        tokio::time::timeout(Duration::from_secs(5), client).await.unwrap().unwrap();
    }

    #[tokio::test]
    async fn dropping_discovery_cancels_its_pending_report() {
        use std::sync::{Arc, Mutex, atomic::{AtomicBool, Ordering}};
        use tokio::sync::oneshot;
        let (requested_tx, requested_rx) = oneshot::channel();
        let requested_tx = Arc::new(Mutex::new(Some(requested_tx)));
        let pending = Arc::new(Mutex::new(None));
        let peer_pending = pending.clone();
        let agent = Agent.builder().on_receive_request(async move |_request: ListSessionsRequest, responder, _cx| {
            *peer_pending.lock().unwrap() = Some(responder);
            if let Some(tx) = requested_tx.lock().unwrap().take() { let _ = tx.send(()); }
            Ok(())
        }, agent_client_protocol::on_receive_request!());
        let client = Client.builder().connect_with(agent, move |connection: ConnectionTo<Agent>| async move {
            let reported = Arc::new(AtomicBool::new(false));
            let reported_by_task = reported.clone();
            let task = start_discovery(connection, "agent".into(), "/one".into(), true,
                move |_| { reported_by_task.store(true, Ordering::SeqCst); });
            tokio::time::timeout(Duration::from_secs(1), requested_rx).await.unwrap().unwrap();
            drop(task);
            pending.lock().unwrap().take().unwrap().respond(ListSessionsResponse::new(vec![info("late", "/one")]))?;
            tokio::time::sleep(Duration::from_millis(50)).await;
            assert!(!reported.load(Ordering::SeqCst));
            Ok(())
        });
        tokio::time::timeout(Duration::from_secs(5), client).await.unwrap().unwrap();
    }
    #[tokio::test]
    async fn unsupported_never_sends_a_list_request() {
        let result = collect_pages(
            "codex",
            Path::new("/one"),
            false,
            Duration::from_secs(1),
            |_| async { panic!("unadvertised list") },
        )
        .await;
        assert!(!result.supported);
        assert!(!result.incomplete);
        assert!(result.sessions.is_empty());
    }
    #[tokio::test]
    async fn follows_opaque_cursors_and_filters_foreign_workspaces_and_duplicates() {
        let mut pages = VecDeque::from([
            ListSessionsResponse::new(vec![info("first", "/one"), info("foreign", "/other")])
                .next_cursor("opaque"),
            ListSessionsResponse::new(vec![info("first", "/one"), info("second", "/one")]),
        ]);
        let mut seen = vec![];
        let result = collect_pages(
            "codex",
            Path::new("/one"),
            true,
            Duration::from_secs(1),
            |cursor| {
                seen.push(cursor);
                let page = pages.pop_front().unwrap();
                async { Ok(page) }
            },
        )
        .await;
        assert_eq!(seen, vec![None, Some("opaque".into())]);
        assert_eq!(
            result
                .sessions
                .iter()
                .map(|entry| entry.session_id.as_str())
                .collect::<Vec<_>>(),
            vec!["first", "second"]
        );
        assert!(!result.incomplete);
    }
    #[tokio::test]
    async fn retains_partial_results_after_a_failed_page() {
        let mut first = true;
        let result = collect_pages(
            "codex",
            Path::new("/one"),
            true,
            Duration::from_secs(1),
            |_| {
                let page = if first {
                    first = false;
                    Ok(ListSessionsResponse::new(vec![info("first", "/one")]).next_cursor("next"))
                } else {
                    Err("unsupported despite capability".into())
                };
                async { page }
            },
        )
        .await;
        assert!(result.incomplete);
        assert_eq!(result.sessions.len(), 1);
    }
    #[tokio::test]
    async fn stops_cyclic_cursors() {
        let result = collect_pages(
            "codex",
            Path::new("/one"),
            true,
            Duration::from_secs(1),
            |_| async {
                Ok(ListSessionsResponse::new(vec![info("first", "/one")]).next_cursor("loop"))
            },
        )
        .await;
        assert!(result.incomplete);
        assert_eq!(result.sessions.len(), 1);
    }
    #[tokio::test]
    async fn bounds_listing_deadline() {
        let result = collect_pages(
            "codex",
            Path::new("/one"),
            true,
            Duration::from_millis(5),
            |_| async {
                tokio::time::sleep(Duration::from_secs(1)).await;
                Ok(ListSessionsResponse::new(vec![]))
            },
        )
        .await;
        assert!(result.incomplete);
        assert!(result.sessions.is_empty());
    }
    #[tokio::test]
    async fn bounds_page_count() {
        let mut page = 0;
        let result = collect_pages(
            "codex",
            Path::new("/one"),
            true,
            Duration::from_secs(1),
            |_| {
                page += 1;
                let next = page.to_string();
                async { Ok(ListSessionsResponse::new(vec![]).next_cursor(next)) }
            },
        )
        .await;
        assert_eq!(page, 20);
        assert!(result.incomplete);
    }
    #[tokio::test]
    async fn bounds_retained_metadata() {
        let result = collect_pages(
            "codex",
            Path::new("/one"),
            true,
            Duration::from_secs(1),
            |_| async {
                Ok(ListSessionsResponse::new(
                    (0..2002).map(|id| info(&id.to_string(), "/one")).collect(),
                ))
            },
        )
        .await;
        assert_eq!(result.sessions.len(), 2000);
        assert!(result.incomplete);
    }
}

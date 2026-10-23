//! Bounded, capability-gated metadata discovery. Never creates/loads a session.
use agent_client_protocol::schema::v1::{ListSessionsRequest, ListSessionsResponse};
use agent_client_protocol::{Agent, ConnectionTo};
use serde::Serialize;
use std::{collections::HashSet, future::Future, path::Path, time::Duration};
use tokio::time::{timeout_at, Instant};

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
    use agent_client_protocol::schema::v1::SessionInfo;
    use std::collections::VecDeque;

    fn info(id: &str, cwd: &str) -> SessionInfo {
        SessionInfo::new(id.to_string(), cwd)
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

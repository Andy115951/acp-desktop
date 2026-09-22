//! Pluggable ACP agent backends (M3+).
//!
//! The UI talks only to host commands (`detect_agents`, `connect_agent`, …).
//! Vendor spawn details live behind [`AgentBackend`]:
//! - [`GrokBackend`] — `grok agent stdio`
//! - [`CodexBackend`] — `codex-acp` / `npx -y @agentclientprotocol/codex-acp` (M4)

use serde::Serialize;
use std::env;
use std::path::PathBuf;

/// Host-owned agent plug-in surface.
///
/// ACP session ops (`initialize` / `session/new` / `session/load` / `prompt` /
/// `cancel` / permission replies) stay on the shared `AcpSession` bridge — they
/// are protocol-identical for stdio agents. Backends own identity, detection,
/// and default spawn argv (plus env overrides via [`resolve_agent_command`]).
pub trait AgentBackend: Send + Sync {
    fn id(&self) -> &'static str;
    fn display_name(&self) -> &'static str;
    /// Binary probed on `PATH` for the Agents list.
    fn binary(&self) -> &'static str;
    fn detect(&self) -> bool;
    /// Default argv when no `ACP_DESKTOP_*` override applies.
    fn default_argv(&self) -> Vec<String>;
}

/// Grok Build — `grok agent stdio`.
pub struct GrokBackend;

impl AgentBackend for GrokBackend {
    fn id(&self) -> &'static str {
        "grok"
    }

    fn display_name(&self) -> &'static str {
        "Grok Build"
    }

    fn binary(&self) -> &'static str {
        "grok"
    }

    fn detect(&self) -> bool {
        binary_named_on_path(self.binary())
    }

    fn default_argv(&self) -> Vec<String> {
        vec!["grok".into(), "agent".into(), "stdio".into()]
    }
}

static GROK_BACKEND: GrokBackend = GrokBackend;

/// Codex via official ACP adapter (`@agentclientprotocol/codex-acp`).
///
/// Prefer a global `codex-acp` binary; otherwise spawn through `npx -y`.
/// Availability: `codex-acp` **or** local `codex` CLI (adapter bundles Codex,
/// but detecting `codex` means the user already uses Codex on this machine).
pub struct CodexBackend;

impl AgentBackend for CodexBackend {
    fn id(&self) -> &'static str {
        "codex"
    }

    fn display_name(&self) -> &'static str {
        "Codex"
    }

    fn binary(&self) -> &'static str {
        // Shown in the Agents list; primary probe target is still `codex-acp`.
        "codex-acp"
    }

    fn detect(&self) -> bool {
        codex_is_detectable(
            binary_named_on_path("codex-acp"),
            binary_named_on_path("codex"),
        )
    }

    fn default_argv(&self) -> Vec<String> {
        codex_spawn_argv(binary_named_on_path("codex-acp"))
    }
}

/// Pure detect rule: `codex-acp` **or** local `codex` CLI.
pub fn codex_is_detectable(has_codex_acp: bool, has_codex: bool) -> bool {
    has_codex_acp || has_codex
}

/// Pure spawn argv: prefer global `codex-acp`, else `npx -y` published adapter.
///
/// Common Mac state: `codex` on PATH but no `codex-acp` → Connect uses npx
/// (first run may download). Callers pass the `codex-acp` probe result only;
/// detect may still be true via `codex` alone.
pub fn codex_spawn_argv(has_codex_acp: bool) -> Vec<String> {
    if has_codex_acp {
        vec!["codex-acp".into()]
    } else {
        vec![
            "npx".into(),
            "-y".into(),
            "@agentclientprotocol/codex-acp".into(),
        ]
    }
}

/// Agents-list detail when Codex is available only via `codex` (npx spawn).
pub fn codex_availability_detail(has_codex_acp: bool, has_codex: bool) -> Option<String> {
    if has_codex_acp {
        None
    } else if has_codex {
        Some(
            "codex on PATH; Connect spawns via npx (@agentclientprotocol/codex-acp).              Install `codex-acp` globally to skip the download."
                .into(),
        )
    } else {
        None
    }
}

static CODEX_BACKEND: CodexBackend = CodexBackend;

/// Built-in catalog entry (detect list). Only `backend`-bearing rows are
/// connectable; Claude remains an M4+/later placeholder.
#[derive(Clone, Copy)]
pub struct BuiltinAgent {
    pub id: &'static str,
    pub name: &'static str,
    pub binary: &'static str,
    /// `Some` when [`connect_agent`] can spawn this id.
    pub backend: Option<&'static dyn AgentBackend>,
}

/// Built-in agent table. Do not depend on the ACP Registry for v1.
static BUILTIN_AGENTS: &[BuiltinAgent] = &[
    BuiltinAgent {
        id: "grok",
        name: "Grok Build",
        binary: "grok",
        backend: Some(&GROK_BACKEND),
    },
    BuiltinAgent {
        id: "codex",
        name: "Codex",
        binary: "codex-acp",
        backend: Some(&CODEX_BACKEND),
    },
    BuiltinAgent {
        id: "claude",
        name: "Claude Code",
        binary: "claude",
        backend: None,
    },
];

pub fn builtin_agents() -> &'static [BuiltinAgent] {
    BUILTIN_AGENTS
}

/// Look up a connectable backend by id.
pub fn lookup_backend(agent_id: &str) -> Result<&'static dyn AgentBackend, String> {
    let id = agent_id.trim();
    if id.is_empty() {
        return Err("agent_id is required".into());
    }
    for entry in builtin_agents() {
        if entry.id == id {
            return entry.backend.ok_or_else(|| {
                format!(
                    "agent `{id}` is listed but not wired yet. Use `grok`/`codex` or enable the fake/custom override."
                )
            });
        }
    }
    Err(format!("unknown agent_id: {id}"))
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentInfo {
    pub id: String,
    pub name: String,
    pub binary: String,
    pub available: bool,
    /// Host can `connect_agent` this id (false for unwired placeholders).
    pub connectable: bool,
    /// Optional Agents-list note (e.g. Codex npx fallback when only `codex` is present).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

pub fn detect_builtin_agents() -> Vec<AgentInfo> {
    builtin_agents()
        .iter()
        .map(|entry| {
            let (available, name) = if let Some(backend) = entry.backend {
                (backend.detect(), backend.display_name())
            } else {
                (binary_named_on_path(entry.binary), entry.name)
            };
            let detail = if entry.id == "codex" {
                codex_availability_detail(
                    binary_named_on_path("codex-acp"),
                    binary_named_on_path("codex"),
                )
            } else {
                None
            };
            AgentInfo {
                id: entry.id.to_string(),
                name: name.to_string(),
                binary: entry.binary.to_string(),
                available,
                connectable: entry.backend.is_some(),
                detail,
            }
        })
        .collect()
}

/// Resolve the ACP agent subprocess argv.
///
/// Priority:
/// 1. `ACP_DESKTOP_AGENT_CMD` — whitespace-split command + args (tests / custom)
/// 2. `ACP_DESKTOP_FAKE_AGENT=1` — in-repo `fake-acp-agent`
/// 3. Selected backend [`AgentBackend::default_argv`]
pub fn resolve_agent_command(backend: &dyn AgentBackend) -> Result<Vec<String>, String> {
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

    Ok(backend.default_argv())
}

/// Default resolve against Grok (tests / override status when no agent selected).
pub fn resolve_default_agent_command() -> Result<Vec<String>, String> {
    resolve_agent_command(&GROK_BACKEND)
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
            return Some(candidate.canonicalize().unwrap_or(candidate));
        }
    }
    None
}

pub fn binary_named_on_path(binary: &str) -> bool {
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
    /// `grok` | `fake` | `custom` (or other backend id when not overridden)
    pub mode: String,
    pub command: Vec<String>,
    pub using_override: bool,
    /// Absolute (or PATH) path when fake binary is resolvable.
    pub fake_agent_path: Option<String>,
}

pub fn agent_override_status() -> Result<AgentOverrideStatus, String> {
    let command = resolve_default_agent_command()?;
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
        GROK_BACKEND.id().into()
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


/// Clear message when detect() fails before spawn (Connect preflight).
pub fn missing_agent_message(backend: &dyn AgentBackend) -> String {
    match backend.id() {
        "codex" => concat!(
            "Codex ACP not found on PATH. Install `codex` and/or `codex-acp` ",
            "(`npm i -g @agentclientprotocol/codex-acp`), or ensure `npx`/`node` ",
            "is available so Connect can fall back to ",
            "`npx -y @agentclientprotocol/codex-acp`. ",
            "Auth stays with the local CLI: ChatGPT login or ",
            "`CODEX_API_KEY` / `OPENAI_API_KEY`."
        )
        .into(),
        "grok" => format!(
            "`{}` not found on PATH. Install Grok Build CLI, or set ACP_DESKTOP_FAKE_AGENT=1 / ACP_DESKTOP_AGENT_CMD.",
            backend.binary()
        ),
        _ => format!(
            "`{}` not found on PATH (or set ACP_DESKTOP_FAKE_AGENT=1 / ACP_DESKTOP_AGENT_CMD)",
            backend.binary()
        ),
    }
}

fn looks_like_auth_failure(raw: &str) -> bool {
    let lower = raw.to_ascii_lowercase();
    [
        "auth",
        "unauthor",
        "login",
        "chatgpt",
        "api key",
        "api_key",
        "apikey",
        "codex_api_key",
        "openai_api_key",
        "not signed",
        "sign in",
        "401",
        "403",
        "forbidden",
        "credential",
    ]
    .iter()
    .any(|k| lower.contains(k))
}

fn looks_like_spawn_failure(raw: &str) -> bool {
    let lower = raw.to_ascii_lowercase();
    [
        "no such file",
        "not found",
        "enoent",
        "spawn",
        "executable",
        "npx",
        "failed to configure",
        "failed to spawn",
        "command not found",
    ]
    .iter()
    .any(|k| lower.contains(k))
}

/// Append vendor-specific guidance to a raw connect/handshake error.
///
/// Keeps the original message first so matchers like `session/load failed`
/// still work on the leading text.
pub fn enrich_connect_error(agent_id: &str, raw: &str) -> String {
    let raw = raw.trim();
    if raw.is_empty() {
        return raw.to_string();
    }
    // Avoid stacking the same hint if we already enriched once.
    if raw.contains("Codex auth:") || raw.contains("Codex ACP:") {
        return raw.to_string();
    }
    match agent_id.trim() {
        "codex" if looks_like_auth_failure(raw) => format!(
            "{raw}\n\nCodex auth: sign in via the local `codex` CLI (ChatGPT), \
             or set `CODEX_API_KEY` / `OPENAI_API_KEY` in the environment, then retry Connect."
        ),
        "codex" if looks_like_spawn_failure(raw) => format!(
            "{raw}\n\nCodex ACP: install `codex-acp` (`npm i -g @agentclientprotocol/codex-acp`) \
             or ensure `npx`/`node` is on PATH. Detect also accepts a local `codex` binary."
        ),
        "codex" => format!(
            "{raw}\n\nIf this looks like missing install or auth: install `codex`/`codex-acp`, \
             complete ChatGPT login in the Codex CLI (or set `CODEX_API_KEY` / `OPENAI_API_KEY`), \
             then retry Connect."
        ),
        _ => raw.to_string(),
    }
}

/// Shared across crates' unit tests that mutate process env (see `lib` tests).
#[cfg(test)]
pub static TEST_ENV_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

#[cfg(test)]
mod tests {
    use super::*;

    use super::TEST_ENV_LOCK as ENV_LOCK;

    #[test]
    fn builtin_table_lists_grok_and_codex_connectable() {
        let agents = detect_builtin_agents();
        let grok = agents.iter().find(|a| a.id == "grok").expect("grok");
        assert!(grok.connectable);
        assert_eq!(grok.binary, "grok");
        let codex = agents.iter().find(|a| a.id == "codex").expect("codex");
        assert!(codex.connectable);
        assert_eq!(codex.binary, "codex-acp");
        let claude = agents.iter().find(|a| a.id == "claude").expect("claude");
        assert!(!claude.connectable);
    }

    #[test]
    fn lookup_backend_grok_ok() {
        let b = lookup_backend("grok").unwrap();
        assert_eq!(b.id(), "grok");
        assert_eq!(b.default_argv(), vec!["grok", "agent", "stdio"]);
    }

    #[test]
    fn lookup_backend_codex_ok() {
        let b = lookup_backend("codex").unwrap();
        assert_eq!(b.id(), "codex");
        assert_eq!(b.binary(), "codex-acp");
        let argv = b.default_argv();
        assert!(
            argv == vec!["codex-acp".to_string()]
                || argv
                    == vec![
                        "npx".to_string(),
                        "-y".to_string(),
                        "@agentclientprotocol/codex-acp".to_string()
                    ],
            "unexpected codex argv: {argv:?}"
        );
    }

    #[test]
    fn lookup_backend_rejects_claude_placeholder() {
        match lookup_backend("claude") {
            Ok(_) => panic!("claude should not be connectable yet"),
            Err(err) => assert!(
                err.contains("not wired") || err.contains("M4"),
                "{err}"
            ),
        }
    }

    #[test]
    fn resolve_defaults_to_backend_argv() {
        let _g = ENV_LOCK.lock().unwrap();
        env::remove_var("ACP_DESKTOP_AGENT_CMD");
        env::remove_var("ACP_DESKTOP_FAKE_AGENT");
        assert_eq!(
            resolve_agent_command(&GROK_BACKEND).unwrap(),
            vec!["grok", "agent", "stdio"]
        );
    }

    #[test]
    fn resolve_respects_custom_cmd_override() {
        let _g = ENV_LOCK.lock().unwrap();
        env::set_var("ACP_DESKTOP_AGENT_CMD", "/tmp/custom-agent --stdio");
        env::remove_var("ACP_DESKTOP_FAKE_AGENT");
        assert_eq!(
            resolve_agent_command(&GROK_BACKEND).unwrap(),
            vec!["/tmp/custom-agent", "--stdio"]
        );
        env::remove_var("ACP_DESKTOP_AGENT_CMD");
    }

    #[test]
    fn missing_agent_message_codex_mentions_auth() {
        let msg = missing_agent_message(&CODEX_BACKEND);
        assert!(msg.contains("Codex"), "{msg}");
        assert!(
            msg.contains("CODEX_API_KEY") || msg.contains("ChatGPT"),
            "{msg}"
        );
        assert!(msg.contains("codex-acp") || msg.contains("npx"), "{msg}");
    }

    #[test]
    fn enrich_connect_error_codex_auth() {
        let out = enrich_connect_error("codex", "initialize failed: unauthorized");
        assert!(out.starts_with("initialize failed"), "{out}");
        assert!(out.contains("Codex auth:"), "{out}");
        assert!(out.contains("CODEX_API_KEY"), "{out}");
    }

    #[test]
    fn enrich_connect_error_codex_spawn() {
        let out = enrich_connect_error("codex", "Failed to configure agent: No such file or directory");
        assert!(out.contains("Codex ACP:"), "{out}");
        assert!(out.contains("npx"), "{out}");
    }

    #[test]
    fn enrich_connect_error_preserves_session_load_prefix() {
        let raw = "session/load failed: unknown id. You can start a New session.";
        let out = enrich_connect_error("codex", raw);
        assert!(out.starts_with("session/load failed"), "{out}");
    }

    #[test]
    fn enrich_connect_error_noop_for_grok() {
        let raw = "something broke";
        assert_eq!(enrich_connect_error("grok", raw), raw);
    }

    #[test]
    fn codex_spawn_argv_prefers_binary_when_present() {
        assert_eq!(codex_spawn_argv(true), vec!["codex-acp".to_string()]);
    }

    #[test]
    fn codex_spawn_argv_falls_back_to_npx() {
        assert_eq!(
            codex_spawn_argv(false),
            vec![
                "npx".to_string(),
                "-y".to_string(),
                "@agentclientprotocol/codex-acp".to_string()
            ]
        );
    }

    #[test]
    fn codex_is_detectable_via_codex_alone() {
        // Common Mac: `codex` installed, `codex-acp` not on PATH.
        assert!(codex_is_detectable(false, true));
        assert!(codex_is_detectable(true, false));
        assert!(codex_is_detectable(true, true));
        assert!(!codex_is_detectable(false, false));
    }

    #[test]
    fn codex_availability_detail_npx_when_only_codex() {
        let d = codex_availability_detail(false, true).expect("detail");
        assert!(d.contains("npx"), "{d}");
        assert!(d.contains("codex-acp"), "{d}");
        assert!(codex_availability_detail(true, true).is_none());
        assert!(codex_availability_detail(true, false).is_none());
        assert!(codex_availability_detail(false, false).is_none());
    }

    #[test]
    fn resolve_codex_uses_spawn_helper_without_override() {
        let _g = ENV_LOCK.lock().unwrap();
        env::remove_var("ACP_DESKTOP_AGENT_CMD");
        env::remove_var("ACP_DESKTOP_FAKE_AGENT");
        let argv = resolve_agent_command(&CODEX_BACKEND).unwrap();
        assert!(
            argv == codex_spawn_argv(true) || argv == codex_spawn_argv(false),
            "unexpected codex resolve argv: {argv:?}"
        );
    }

}

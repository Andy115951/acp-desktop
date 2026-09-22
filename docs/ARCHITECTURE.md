# Architecture

Living notes for how `acp-desktop` is meant to be built. Product scope stays in the root [README](../README.md).

## Layers

```text
┌─────────────────────────────────────────────┐
│  React UI (Vite + TS + Tailwind + Zustand)  │
│  chat stream · permission cards · agent UI  │
└──────────────────┬──────────────────────────┘
                   │ Tauri commands / events
┌──────────────────▼──────────────────────────┐
│  Tauri 2 host (Rust)                        │
│  window · PATH probe · prefs store          │
│  AgentBackend dispatch                      │
└──────────────────┬──────────────────────────┘
                   │ ACP v1 JSON-RPC (stdio)
┌──────────────────▼──────────────────────────┐
│  Local agent process                        │
│  e.g. `grok agent stdio` / `codex-acp`      │
│  (later: claude-agent-acp)                  │
└─────────────────────────────────────────────┘
```

## AgentBackend

Rust trait (name may vary) owned by the host:

- `id` / display name
- `detect()` — is the binary (or adapter) on `PATH`?
- `spawn(cwd)` — start the ACP stdio subprocess
- `initialize` / `session_new` / `session_load` / `prompt` / `cancel`
- map agent → client requests: especially `session/request_permission` → UI allow/deny

Implementations in `src-tauri/src/agent_backend.rs`:
- **GrokBackend** — `grok agent stdio`
- **CodexBackend** (M4) — `codex-acp` if on `PATH`, else `npx -y @agentclientprotocol/codex-acp`; detect via `codex-acp` **or** `codex`

Host commands: `detect_agents`, `connect_agent(agent_id, …)`, `disconnect_agent` — UI never imports vendor spawn details.
ACP session ops (`initialize` / `session/*` / permission replies) stay on the shared `AcpSession` bridge (protocol-identical for stdio agents).
Claude Code stays a built-in table placeholder until a later milestone.

Built-in agent table + optional user overrides (`ACP_DESKTOP_AGENT_CMD` / `ACP_DESKTOP_FAKE_AGENT`). Do **not** depend on the ACP Registry for v1.

## Event flow (one turn)

1. UI sends `prompt` (and cwd / session id) via Tauri command.
2. Host writes ACP `session/prompt` to the agent stdin.
3. Agent emits `session/update` notifications (chunks, tool calls, plans, …).
4. Host forwards typed events to the UI (Tauri events).
5. If the agent requests permission, host pauses that tool path, shows a card, then replies allow/deny on the ACP channel.
6. Turn ends when the prompt response returns a stop reason (or the user cancels).

Stdout is ACP-only. Agent logs on stderr may be shown in a debug pane later; they must not be parsed as protocol.

## Sessions and storage

- Conversation / skill / auth state: **vendor directories** (e.g. `~/.grok`, Codex home), same as the TUI.
- App preferences only: last workspace folder, selected agent id, per-agent `cwd→sessionId` maps (`{agentId}.sessionByCwd`) — via `tauri-plugin-store`.
- No unified cross-vendor session DB. Switching agents disconnects, clears the transcript, and reloads that vendor's Resume id.
- Launch hydrate runs **after** agent detect so `selectedAgentId` is known; if detect still flips mid-read, Resume is reloaded for the agent selected at commit time (never cross-vendor).

## Defaults (scaffold)

| Choice | Default |
| --- | --- |
| App shell | Tauri 2 |
| UI | React + Vite + TypeScript + Tailwind + Zustand |
| Repo layout | `src/` + `src-tauri/` (single package) |
| ACP | v1 via `agent-client-protocol` |
| First agent | Grok Build |
| Permissions | Ask (no YOLO default) |

## Testing / fake agent

- In-repo crate `tools/fake-acp-agent`: ACP v1 stdio agent that **always** `session/request_permission`s on prompt (allow → stream text + EndTurn; reject → EndTurn with no side-effect text). Advertises `loadSession` and implements `session/load` for `fake-session-N` ids (replay `fake-agent: resumed` before the load response; unknown ids → invalid params) so Mac `tauri:fake` can exercise Disconnect→Resume without Grok.
- Host override: `ACP_DESKTOP_AGENT_CMD` (full command) or `ACP_DESKTOP_FAKE_AGENT=1` (PATH, else workspace `target/{debug,release}/fake-acp-agent`). Default remains `grok agent stdio`.
- Dev UI toggle sets the same process env for the running app (not persisted). `npm run tauri:fake` is the one-command smoke entry.
- Fake override is **vendor-agnostic**: with `ACP_DESKTOP_FAKE_AGENT=1` (or the Dev toggle), `connect_agent("codex")` still spawns `fake-acp-agent`. UI Connect stays enabled for a missing-but-connectable agent when fake is on (`canConnectSelectedAgent`).
- Linux `tauri:fake` can hydrate `selectedAgentId` + `lastCwd` from prefs to smoke Switch→Codex without Mac GUI (per-vendor Resume: Codex shows Connect while Grok map has a session for the same cwd). Scripted WebKit clicks under Xvfb are unreliable (no AT-SPI); full Connect/Ask/Resume click path remains Mac UI E2E.
- Host `drain_load_replay` waits up to 2s for the first ActiveSession update then 250ms idle (pre-response `session/update` never hits the connection handler — dropping early lost Resume replay). Automated: `cargo test -p fake-acp-agent` (allow + reject + loadSession + host-style drain) + `cargo test -p acp-desktop` + `tsc`; GitHub Actions CI runs these on push/PR. Does not replace Mac UI E2E for permission cards / Resume.

## Deferred

- Third agent: Claude Code (`@agentclientprotocol/claude-agent-acp`)
- Permission card placement: modal vs inline
- Packaging / notarization / auto-update
- UI language (start simple; not a protocol blocker)

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
│  e.g. `grok agent stdio`                    │
│  (later: codex-acp / claude-agent-acp)      │
└─────────────────────────────────────────────┘
```

## AgentBackend

Rust trait (name may vary) owned by the host:

- `id` / display name
- `detect()` — is the binary (or adapter) on `PATH`?
- `spawn(cwd)` — start the ACP stdio subprocess
- `initialize` / `session_new` / `session_load` / `prompt` / `cancel`
- map agent → client requests: especially `session/request_permission` → UI allow/deny

First implementation: **GrokBackend** (`grok`, args `["agent", "stdio"]`).  
Second implementation (later): thin wrapper around an ACP adapter command, same trait — no UI fork per vendor.

Built-in agent table + optional user overrides (command / args / env). Do **not** depend on the ACP Registry for v1.

## Event flow (one turn)

1. UI sends `prompt` (and cwd / session id) via Tauri command.
2. Host writes ACP `session/prompt` to the agent stdin.
3. Agent emits `session/update` notifications (chunks, tool calls, plans, …).
4. Host forwards typed events to the UI (Tauri events).
5. If the agent requests permission, host pauses that tool path, shows a card, then replies allow/deny on the ACP channel.
6. Turn ends when the prompt response returns a stop reason (or the user cancels).

Stdout is ACP-only. Agent logs on stderr may be shown in a debug pane later; they must not be parsed as protocol.

## Sessions and storage

- Conversation / skill / auth state: **vendor directories** (e.g. `~/.grok`), same as the TUI.
- App preferences only: last workspace folder, selected agent id, window bits — via `tauri-plugin-store` (or equivalent).
- No unified cross-vendor session DB. Histories must not mix when switching agents.

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
- Host `drain_load_replay` waits up to 2s for the first ActiveSession update then 250ms idle (pre-response `session/update` never hits the connection handler — dropping early lost Resume replay). Automated: `cargo test -p fake-acp-agent` (allow + reject + loadSession + host-style drain) + `cargo test -p acp-desktop` + `tsc`; GitHub Actions CI runs these on push/PR. Does not replace Mac UI E2E for permission cards / Resume.

## Deferred

- Second agent: Codex vs Claude Code
- Switcher chrome: top dropdown vs left list
- Permission card placement: modal vs inline
- Packaging / notarization / auto-update
- UI language (start simple; not a protocol blocker)

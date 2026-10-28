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
│  e.g. `grok agent stdio` / `codex-acp` /    │
│  `claude-agent-acp` / `copilot --acp`       │
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
- **ClaudeBackend** (M6) — `claude-agent-acp` if on `PATH`, else `npx -y @agentclientprotocol/claude-agent-acp`; detect via `claude-agent-acp` **or** `claude`
- **CopilotBackend** (M8) — `copilot --acp`; detect via `copilot` on `PATH` (no npx adapter)

Host commands: `detect_agents`, `connect_agent(agent_id, …)`, `disconnect_agent` — UI never imports vendor spawn details.
ACP session ops (`initialize` / `session/*` / permission replies) stay on the shared `AcpSession` bridge (protocol-identical for stdio agents).

Built-in agent table + stable-ID custom launch profiles + optional development overrides (`ACP_DESKTOP_AGENT_CMD` / `ACP_DESKTOP_FAKE_AGENT`, built-ins only). Do **not** depend on the ACP Registry for v1.

## Event flow (one turn)

1. UI sends `prompt` (and cwd / session id) via Tauri command.
2. Host writes ACP `session/prompt` to the agent stdin.
3. Agent emits `session/update` notifications (chunks, tool calls, plans, …).
4. Host forwards typed events to the UI (Tauri events).
5. If the agent requests permission, host pauses that tool path, shows a card, then replies allow/deny on the ACP channel.
6. Turn ends when the prompt response returns a stop reason (or the user cancels).

Metadata notifications for available commands, context usage and configuration options use `acp://metadata` with agent/workspace/session identity, including notifications drained during Resume. Only explicit presentation fields cross the bridge; `_meta` and raw cost objects do not. Reports are volatile, stay outside the transcript and are cleared on disconnect/reconnect. Command insertion requires an advertised command and an idle connection; it never sends a prompt automatically. New/load response configuration and live configuration notifications use the same presentation bridge. `set_session_config` targets the current session and validates option/value IDs against the latest advertised select choices in the host before sending ACP v1 `session/set_config_option`. The response publishes the complete accepted option list; provider error payloads are replaced with a generic failure. Requests have a 15-second timeout and remain interruptible through Disconnect. Unknown control kinds are read-only; this client does not advertise boolean config support.

Stdout is ACP-only. Agent logs on stderr may be shown in a debug pane later; they must not be parsed as protocol.


The `connect_agent` acknowledgment returns agent/cwd/session ID and a client-generated
connection token only after New/Resume completes. First Send waits for this result
before submitting the unchanged draft once. Editing or canceling invalidates its
automatic dispatch. All host session events carry the same token so queued events
from stopped connections cannot modify a replacement conversation. Async context,
catalog and send results also check their operation generation before committing.

## Sessions and storage

- Conversation / skill / auth state: **vendor directories** (e.g. `~/.grok`, Codex home), same as the TUI.
- App preferences only: last workspace folder, selected agent id, UI locale (`ui.locale`), and per-agent session catalogs (`{agentId}.sessions.v1`) — via `tauri-plugin-store`. Catalog entries contain cwd, session ID, optional title, creation/last-used timestamps, unavailable status, and an optional archive timestamp. No messages, tool results or credentials are copied into them.
- Each catalog imports the legacy `{agentId}.sessionByCwd` map once, retaining all valid workspace IDs. The legacy key is left intact; an existing catalog is authoritative so stale IDs are not imported again. Unknown schema versions are not overwritten. Metadata I/O is serialized to prevent concurrent status updates from losing sessions.
- No unified cross-vendor transcript DB. Idle agent/workspace/history navigation disconnects the current process, clears its transcript and reloads the selected context. Unsent drafts and the last selected target stay in memory, scoped by stable agent ID, cwd and vendor session ID (or a local New target). They are not persisted. History navigation resumes directly; New opens a draft without spawning a process. A failed Resume marks only that entry unavailable and requires explicit New rather than silently creating a replacement.
- Sidebar search is volatile component state keyed by stable agent ID and cwd. It filters only available, non-archived metadata by normalized title/ID, preserves catalog order and does not alter selection, drafts or transcripts. A nonmatching selected entry is shown separately from the matching count. Search/clear consume their own keyboard events so permission shortcuts cannot authorize/cancel a tool while typing or clearing. The prior agent's list is hidden and its operations are inert while agent selection awaits process teardown/context reload. Untitled saved/live conversations show their full vendor ID.
- Recent workspaces (`recentWorkspaces.v1`) are shared across agents, bounded to 20 unique paths, and seeded from the old last-workspace preference. A successful folder choice updates the recent list and last folder together. Session lists remain scoped by both agent and cwd.
- Rename edits only the app title (up to 120 UTF-16 code units). Archive sets an app-only tombstone; no vendor delete command is sent. Archived entries remain hidden after later status updates and can be restored from the archived list. Explicit metadata edits roll back the shared store cache on write failure and show an error.
- Navigation is blocked during connection, prompt submission/replies, configuration changes, permission decisions and context transitions. Rename, archive and restore additionally require a disconnected session. Both UI and store enforce these rules. Delayed metadata results cannot overwrite a newer selection, and status persistence uses the connection's agent identity rather than a possibly changed UI selection.
- Launch hydrate runs **after** agent detect so `selectedAgentId` is known; if detect still flips mid-read, Resume is reloaded for the agent selected at commit time (never cross-vendor).
- After initialize, Connect/Resume requests `session/list` only when `sessionCapabilities.list` is present. Discovery filters by the selected cwd, follows opaque cursors, deduplicates IDs and rejects foreign workspaces. It is bounded to 10 seconds total, 20 pages and 2,000 entries; repeated cursors, errors and limits produce an explicit incomplete notice, retaining app-known and partial results. Disconnect interrupts discovery through the existing connection shutdown path.
- `acp://sessions` carries only agent/cwd, listing support, incomplete status and session metadata. The frontend imports it into the corresponding catalog without changing the selected ID or appending transcript content. Existing names, archive tombstones and unavailable flags win over vendor metadata. Unsupported agents retain the app-known picker; listing failure does not prevent session creation/loading.

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
- Fake override is **vendor-agnostic**: with `ACP_DESKTOP_FAKE_AGENT=1` (or the Dev toggle), `connect_agent("codex")` / `connect_agent("claude")` / `connect_agent("copilot")` still spawns `fake-acp-agent`. UI Connect stays enabled for a missing-but-connectable agent when fake is on (`canConnectSelectedAgent`).
- Headless Codex ACP smoke (local, not CI): `npm run smoke:codex-acp` — same wire path as `codex_spawn_argv`.
- Headless Claude ACP smoke (local, not CI): `npm run smoke:claude-acp` — same wire path as `claude_spawn_argv` (`claude-agent-acp` or `npx -y @agentclientprotocol/claude-agent-acp`); needs local Claude login / `ANTHROPIC_API_KEY`.
- Headless Copilot ACP smoke (local, not CI): `npm run smoke:copilot-acp` — same wire path as `copilot_spawn_argv` (`copilot --acp`); needs local Copilot CLI + GitHub login.
- Linux `tauri:fake` can hydrate `selectedAgentId` + `lastCwd` from prefs to smoke Switch→Codex/Claude/Copilot without Mac GUI (per-vendor Resume). Scripted WebKit clicks under Xvfb are unreliable (no AT-SPI); full Connect/Ask/Resume click path remains Mac UI E2E.
- Host `drain_load_replay` waits up to 2s for the first ActiveSession update then 250ms idle. Automated: `cargo test -p fake-acp-agent` + `cargo test -p acp-desktop` + `tsc` + vitest; GitHub Actions CI runs these on push/PR. Does not replace Mac UI E2E for permission cards / Resume.

## Verification and distribution

The [compatibility matrix](COMPATIBILITY.md) distinguishes real-agent checks from
fixtures and external blockers. Native acceptance must be recorded for the
relevant change; the early milestone UI waivers are not blanket release approval.
[PACKAGING.md](PACKAGING.md) describes audited macOS arm64 candidate archives,
ad-hoc signing and pending fresh-user installation. Notarization and auto-update
are not implemented by that pipeline.

### Custom launch profiles

`custom_agents.rs` owns a bounded, versioned registry under the application config
directory. Validation runs on read, write and launch; malformed/unknown registries
are retained, with built-ins still usable. Writes use a sibling temporary file
and rename under a registry mutex. Host-generated `custom-<UUID>` IDs cannot
collide with built-ins, change on edit, or be reused through creation. Editing is
blocked while connected. Removal affects only the launch registry.

Custom profiles construct `AcpAgentConfig` with separate executable, argv and
child-only environment fields; they bypass developer command-string overrides
and never use shell parsing. CLI authentication and inherited environment remain
unchanged. Raw custom subprocess errors are replaced by recovery-phase messages;
configuration validation errors never echo rejected values. Session catalogs and
metadata events use the stable profile ID through the existing shared ACP host.

### Protocol version boundary

`protocol_init.rs` explicitly requests ACP v1 and validates the response before
session discovery, Resume or New. Any other major version closes the connection
with an app-owned compatibility message, including for custom agents. Unknown
capability keys are ignored; missing known capabilities stay off. No draft v2,
terminal, filesystem or boolean-configuration client support is advertised.
Known unsupported control kinds remain read-only; arbitrary unknown wire enum
variants still depend on the pinned SDK schema and are not claimed as supported.

Reference: [ACP v1 initialization and version negotiation](https://agentclientprotocol.com/protocol/v1/initialization).

### Settings surface

The settings surface is a modal side panel with a bounded scroll region. Its
contents stay mounted while hidden so profile forms are not discarded on close.
Explicit opening focuses the panel; profile editing focuses its Name field and
content replacement retains focus inside the open modal without activating a
background app. Tab cycles through visible controls
(including only summaries of closed disclosures). Settings owns its keys and
restores focus to the originating control, or the header trigger when that
control disappears. Permission state hides the panel immediately and takes focus
without a competing close/return callback. Conversation configuration errors stay
visible outside collapsed session options and are repeated on the active settings
surface. Settings UI state does not reconnect or submit the conversation.


### App-local keyboard actions

A window capture listener recognizes exact platform modifier chords from the
shared `appShortcuts` contract. The same contract renders localized shortcut help
and control titles. It does not register OS-level shortcuts or activate windows.
Recognized actions are consumed before nested controls and permission hotkeys,
then reuse the existing New/navigation/settings guards. Modal settings, local
history editors and unfinished custom-profile edits own their focus. Search focus
uses a consumed token initialized on context mount so an old request cannot replay
when agent/workspace identity changes. Permission hotkeys separately reject
modifiers, repeats, composition/keyCode 229 and consumed events; native modified
Enter/Space button clicks are suppressed on the permission card as well.

# acp-desktop

Unofficial desktop **ACP client**: one window to switch the local coding-agent CLIs you already installed (Grok Build, Codex, Claude Code, and others that speak ACP).

**Not affiliated with, endorsed by, or a product of xAI, OpenAI, Anthropic, or any other vendor.** Their names and marks belong to them. This repo does not ship vendor CLIs, installers, or credentials.

各家 CLI 你自己装、自己登录。本应用只拉起它们的 ACP stdio（例如 `grok agent stdio`、`codex-acp`、`claude-agent-acp`、`copilot --acp`）。会话仍在各家自己的目录里，能和原 TUI 接着聊。改文件、跑命令默认要你点头。

## What it is

A small ACP window — not an IDE, not a single-vendor Grok wrapper:

- Detect which CLIs are on `PATH` (missing ones stay grey)
- Switch agent in one window; histories do not mix
- Streaming chat + permission cards (allow / deny)
- Resume the same vendor session the TUI uses

## How agents connect

ACP = [Agent Client Protocol](https://agentclientprotocol.com): JSON-RPC between a window/IDE and a local coding agent (usually stdin/stdout). MCP is agent↔tools; ACP is window↔agent.

| CLI | How we talk to it (no PTY scrape) |
| --- | --- |
| Grok Build | `grok agent stdio` |
| Claude Code | usually `@agentclientprotocol/claude-agent-acp` |
| Codex | `@agentclientprotocol/codex-acp` |
| Copilot CLI | `copilot --acp` (public preview) |
| Anything without ACP | out of scope |

## Architecture

```text
React (Vite)  --Tauri IPC-->  Rust host (Tauri 2)
                                 |
                                 |  agent-client-protocol (ACP v1)
                                 v
                           grok agent stdio | codex-acp | claude-agent-acp | copilot --acp
```

- UI never talks to the CLI directly; the Rust host owns spawn, handshake, streaming, and permission replies.
- Vendor session files stay in each CLI’s own directories; this app does not re-store chat history.
- See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for `AgentBackend`, event flow, and defaults.

## Status

M1 (scaffold) and **M2 (Grok ACP path)** are on `main` (merged via [#8](https://github.com/Andy115951/acp-desktop/pull/8)): `initialize` → `session/new` | `session/load` → streaming `session/update` → Ask permission cards → Resume/New session UI. Preferences (`tauri-plugin-store`) keep lightweight per-agent session metadata and the last workspace folder (no chat history locally).

**Startup:** the window opens without requesting initial focus. On macOS, launching while another app is active leaves that app active; click ACP Desktop when you are ready to use it.

**Agent session information:** while connected, the app shows slash commands and context usage reported by the current agent. A command button inserts its name before your draft; add arguments and send explicitly. Reports refresh during a session and reset on disconnect or context change. Missing reports remain unknown, and empty command lists are distinct from missing reports. Token counts are shown exactly as reported; the app does not estimate usage or normalize prices.

**Session configuration:** the connected agent can report select controls for model, mode, reasoning or other settings, including grouped choices. The app uses the reported IDs, current values and choices without hard-coded vendor defaults. Changing a choice waits for the agent response; rejected or timed-out changes retain the last reported values and show a retry notice. Controls and prompt sending are disabled while a change is pending, but Disconnect remains available. Live reports replace the option list. Missing reports remain unknown; unsupported control types are read-only and boolean controls are not advertised by this client. Configuration is session-local and is refreshed by the agent on Resume.

**Saved sessions:** after Disconnect, choose an app-known session for the current agent/workspace and click Resume. New session keeps the earlier entries, and relaunch restores the most recently used session as the default. Existing cwd→sessionId preferences migrate automatically. Workspace/session selection is disabled until you disconnect; a missing or expired session is removed from the picker without discarding other entries or deleting vendor history. Use Recent workspaces to return to a previously opened folder. Rename changes only the app title; Archive app entry hides a record without deleting vendor history, and Archived sessions lets you restore it. These actions require a disconnected, idle session. Connect and Resume also discover vendor sessions when the agent advertises `sessionCapabilities.list`, following pagination for the selected workspace. Unsupported agents keep the app-known list. Discovery errors, repeated cursors or safety limits show an incomplete notice and keep existing entries usable (10 seconds total, up to 20 pages / 2,000 entries per connection). Local names, archives and stale-entry decisions are preserved.

Protocol smoke against a local logged-in `grok agent stdio` (Mac): streaming turn + `session/load` resume both OK (`loadSession: true`). In-repo **fake ACP agent** + `cargo test -p fake-acp-agent` / `cargo test -p acp-desktop` + Vitest/`tsc` (CI on push/PR) cover `session/request_permission` allow/deny and `loadSession` replay without Grok. Host deadline-drains `session/load` ActiveSession replay so Resume does not miss `fake-agent: resumed`.

Issue [#3](https://github.com/Andy115951/acp-desktop/issues/3) is **closed** (M2 Done on the [project board](https://github.com/users/Andy115951/projects/2)). Optional polish [#9](https://github.com/Andy115951/acp-desktop/pull/9) (last workspace folder prefs) is merged to `main`.

**Done on main:** [#4](https://github.com/Andy115951/acp-desktop/issues/4) M3 `AgentBackend` (`GrokBackend` + `connect_agent`).

**Done on main:** [#5](https://github.com/Andy115951/acp-desktop/issues/5) M4 — Codex via `@agentclientprotocol/codex-acp`, Agents list + Switch dropdown, per-vendor session prefs (`{agentId}.sessionByCwd`) (merged [#12](https://github.com/Andy115951/acp-desktop/pull/12); Mac UI E2E waived).

**Done on main:** [#6](https://github.com/Andy115951/acp-desktop/issues/6) M5 macOS packaging (`tauri build` → `.app` / `.dmg`; no vendor CLIs in the bundle). See [docs/PACKAGING.md](docs/PACKAGING.md).

**Done on main:** [#14](https://github.com/Andy115951/acp-desktop/issues/14) M6 Claude via `@agentclientprotocol/claude-agent-acp` (merged [#15](https://github.com/Andy115951/acp-desktop/pull/15) as `ae0df18`) — detect `claude-agent-acp` **or** `claude`, spawn binary or `npx -y`, Agents list selectable, per-vendor session prefs.

**Done on main:** [#17](https://github.com/Andy115951/acp-desktop/issues/17) M7 UI language (`en` / `zh-CN`) — header locale toggle, `tauri-plugin-store` key `ui.locale`, chrome strings in `App.tsx` + `PermissionCard.tsx` (merged [#18](https://github.com/Andy115951/acp-desktop/pull/18) as `718de50`).

**Done on main:** [#19](https://github.com/Andy115951/acp-desktop/issues/19) M8 Copilot via `copilot --acp` (merged [#20](https://github.com/Andy115951/acp-desktop/pull/20) as `7ca85e7`) — detect `copilot` on PATH, Agents list selectable, per-vendor session prefs (`copilot.sessionByCwd`).

Plan board: [acp-desktop project](https://github.com/users/Andy115951/projects/2) (issues #2–#6 + #14 + #17 + #19 Done).

## Develop

Prerequisites: [Node.js](https://nodejs.org/) 22.12+ (or a supported newer LTS), [Rust](https://rustup.rs/) 1.90+, and OS webview deps ([Tauri prerequisites](https://tauri.app/start/prerequisites/) — on macOS that means Xcode CLT / WebKit).

```bash
npm install
npm run tauri dev
```

### Codex ACP headless Connect/Ask/Resume (Mac)

Spawns the same argv as `CodexBackend` (`codex-acp` if on `PATH`, else `npx -y @agentclientprotocol/codex-acp`), then over stdio NDJSON runs:

`initialize` → `session/new` → `session/prompt` → fresh-process `session/load`

Asserts `protocolVersion: 1`, `loadSession`, `authMethods` (`api-key`, `chat-gpt`), a usable `sessionId`, prompt `end_turn`, and Resume replay chunks. Needs a local Codex login (ChatGPT / API key). Does **not** replace Mac UI Connect/Ask/Resume clicks.

```bash
npm run smoke:codex-acp
# optional: CODEX_ACP_SMOKE_SKIP_PROMPT=1 npm run smoke:codex-acp
```


### Claude ACP headless Connect/Ask/Resume (Mac)

Spawns the same argv as `ClaudeBackend` (`claude-agent-acp` if on `PATH`, else `npx -y @agentclientprotocol/claude-agent-acp`), then over stdio NDJSON runs:

`initialize` → `session/new` → `session/prompt` → fresh-process `session/load`

Needs a local Claude Code login (Pro/Max) or `ANTHROPIC_API_KEY`. Does **not** replace Mac UI Connect/Ask/Resume clicks.

```bash
npm run smoke:claude-acp
# optional: CLAUDE_ACP_SMOKE_SKIP_PROMPT=1 npm run smoke:claude-acp
```

### Copilot ACP headless Connect/Ask/Resume (Mac)

Spawns the same argv as `CopilotBackend` (`copilot --acp`), then over stdio NDJSON runs:

`initialize` → `session/new` → `session/prompt` → fresh-process `session/load` (when `loadSession` is advertised)

Needs a local GitHub Copilot CLI install + GitHub login. Does **not** replace Mac UI Connect/Ask/Resume clicks.

```bash
npm run smoke:copilot-acp
# optional: COPILOT_ACP_SMOKE_SKIP_PROMPT=1 npm run smoke:copilot-acp
```

### Fake ACP agent (permission smoke)

Grok may not emit `session/request_permission` for every prompt. For a deterministic allow/deny path:

```bash
# From repo root (Cargo workspace)
cargo test -p fake-acp-agent
cargo test -p acp-desktop
npx tsc --noEmit
npm test

# One-command Tauri UI smoke (builds fake agent, sets ACP_DESKTOP_FAKE_AGENT=1)
npm run tauri:fake
```

GitHub Actions (`.github/workflows/ci.yml`) runs the same `cargo test` + `tsc` + `vitest` checks on push/PR.

In the app, use the **Dev: fake ACP agent** toggle (same process-env override; not persisted). Then: Pick folder → Connect → Send any prompt → inline permission card Allow/Reject (keys: **a**/**Enter** Allow, **r** Reject, **Esc** Cancel; toolbar Cancel also clears a pending Ask) → Disconnect → **Resume** (expect `fake-agent: resumed` replay; prompt still asks permission).

Acceptance fixtures in the fake agent: send `fake:usage-limit` for a quota error,
`fake:deny-report` for an explicit refusal message, or `fake:parallel` for two
permission requests issued before either decision. Starting the fake binary with
`--stale-session` creates a session that is deliberately unavailable on Resume.
`--list-sessions` advertises a two-page session list (including a foreign-workspace
entry that the host must reject); `--list-error` advertises listing but fails the
request so app-known fallback can be checked. `--session-info` reports two commands
and 2,048 / 8,192 context tokens on new/load; send `fake:clear-session-info` to
replace the command list with an empty list and update usage to 4,096 tokens.
`--config-options` returns Model/Mode/Reasoning selectors on new/load; Fast is
accepted, Rejected model fails with synthetic error data, and Slow model delays
its response for five seconds to exercise Disconnect. `fake:config-update` sends
a live mode update, while `fake:clear-config` removes all configuration controls.
These fixtures do not call a vendor API or perform the proposed tool actions.
For conversation rendering, `fake:stream` emits thought/reply chunks and
`fake:long-stream` emits 180 lines over several seconds for scroll testing.
`fake:markdown` streams headings, lists, code and unsafe-content samples;
`fake:tool` previews input, locations, updates and a diff after an Ask decision
without writing a file. Set `ACP_DESKTOP_FAKE_RICH_REPLAY=1` when launching the
app to include the Markdown fixture in fake Resume replay. The fake-agent
toggle is under the collapsed **Developer tools** panel below the conversation.

Env alternatives:

```bash
cargo build -p fake-acp-agent
ACP_DESKTOP_FAKE_AGENT=1 npm run tauri dev
# or: ACP_DESKTOP_AGENT_CMD="$(pwd)/target/debug/fake-acp-agent" npm run tauri dev
```

`ACP_DESKTOP_FAKE_AGENT=1` resolves `target/debug/fake-acp-agent` from the workspace when the binary is not on PATH. Default for users remains `grok agent stdio`.


## Build / release (macOS, M5)

Ship a local `.app` / `.dmg` without bundling vendor CLIs:

```bash
npm install
npm run tauri:build:macos
```

Artifacts: `src-tauri/target/release/bundle/macos/` and `.../dmg/`. Signing & notarization stay optional (set `APPLE_SIGNING_IDENTITY` when you have a Developer ID cert). Details: [docs/PACKAGING.md](docs/PACKAGING.md).

## Roadmap

Upcoming M9–M12 plans and acceptance evidence live in the
[GitHub Project](https://github.com/users/Andy115951/projects/2).

1. **Tauri skeleton + Grok detect** — done (M1 / [#2](https://github.com/Andy115951/acp-desktop/issues/2))
2. **Grok ACP path** — done (M2 / [#3](https://github.com/Andy115951/acp-desktop/issues/3), [#8](https://github.com/Andy115951/acp-desktop/pull/8) + [#9](https://github.com/Andy115951/acp-desktop/pull/9))
3. **AgentBackend** — done (M3 / [#4](https://github.com/Andy115951/acp-desktop/issues/4), [#11](https://github.com/Andy115951/acp-desktop/pull/11))
4. **Multi-agent switch** — done (M4 / [#5](https://github.com/Andy115951/acp-desktop/issues/5), [#12](https://github.com/Andy115951/acp-desktop/pull/12))
5. **macOS packaging** — done (M5 / [#6](https://github.com/Andy115951/acp-desktop/issues/6)); see [docs/PACKAGING.md](docs/PACKAGING.md)
6. **Claude backend** — done (M6 / [#14](https://github.com/Andy115951/acp-desktop/issues/14), [#15](https://github.com/Andy115951/acp-desktop/pull/15))
7. **UI language** — done (M7 / [#17](https://github.com/Andy115951/acp-desktop/issues/17), [#18](https://github.com/Andy115951/acp-desktop/pull/18)): `en` / `zh-CN` chrome locale
8. **Copilot backend** — done (M8 / [#19](https://github.com/Andy115951/acp-desktop/issues/19), [#20](https://github.com/Andy115951/acp-desktop/pull/20) as `7ca85e7`): `copilot --acp`

## Tech notes

- Protocol: **ACP v1 (stable)**, local stdio subprocess only
- Shell: **Tauri 2** + **React** (Vite, TypeScript, Tailwind, Zustand)
- ACP client: official Rust crate [`agent-client-protocol`](https://crates.io/crates/agent-client-protocol)
- Layout: single repo (`src/` frontend + `src-tauri/` backend)
- Agents: built-in table + user-defined command/args (no ACP Registry in v1)
- Preferences: `tauri-plugin-store` (last folder / selected agent / `ui.locale` / per-agent session metadata); no local transcript database
- First agent: **Grok Build** via `grok agent stdio`

### Still open

- Mac UI E2E for real Codex / Claude / Copilot Connect / Ask / Resume — **waived** as a merge/dev blocker (headless `smoke:codex-acp` / `smoke:claude-acp` / `smoke:copilot-acp` + fake-agent CI remain)
- Packaging notarization / auto-update (needs Apple Developer ID; see [docs/PACKAGING.md](docs/PACKAGING.md))

## Non-goals

- Shipping or bundling vendor binaries / official logos
- Default YOLO / auto-approve everything
- PTY-wrapping a TUI that has no ACP
- Forking third-party vendor desktop shells as the mainline
- Unified account or unified cross-vendor session format
- Collecting tokens

## License

MIT. See [LICENSE](LICENSE).

# acp-desktop

Unofficial desktop **ACP client**: one window to switch the local coding-agent CLIs you already installed (Grok Build, Codex, Claude Code, and others that speak ACP).

**Not affiliated with, endorsed by, or a product of xAI, OpenAI, Anthropic, or any other vendor.** Their names and marks belong to them. This repo does not ship vendor CLIs, installers, or credentials.

各家 CLI 你自己装、自己登录。本应用只拉起它们的 ACP stdio（例如 `grok agent stdio`、`codex-acp`、`claude-agent-acp`）。会话仍在各家自己的目录里，能和原 TUI 接着聊。改文件、跑命令默认要你点头。

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
| Copilot CLI | `copilot --acp` (preview) — later |
| Anything without ACP | out of scope |

## Architecture

```text
React (Vite)  --Tauri IPC-->  Rust host (Tauri 2)
                                 |
                                 |  agent-client-protocol (ACP v1)
                                 v
                           grok agent stdio | codex-acp | claude-agent-acp
```

- UI never talks to the CLI directly; the Rust host owns spawn, handshake, streaming, and permission replies.
- Vendor session files stay in each CLI’s own directories; this app does not re-store chat history.
- See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for `AgentBackend`, event flow, and defaults.

## Status

M1 (scaffold) and **M2 (Grok ACP path)** are on `main` (merged via [#8](https://github.com/Andy115951/acp-desktop/pull/8)): `initialize` → `session/new` | `session/load` → streaming `session/update` → Ask permission cards → Resume/New session UI. Preferences (`tauri-plugin-store`) keep cwd→sessionId **and** last workspace folder so relaunch restores the folder for Connect/Resume (no chat history locally).

Protocol smoke against a local logged-in `grok agent stdio` (Mac): streaming turn + `session/load` resume both OK (`loadSession: true`). In-repo **fake ACP agent** + `cargo test -p fake-acp-agent` / `cargo test -p acp-desktop` + Vitest/`tsc` (CI on push/PR) cover `session/request_permission` allow/deny and `loadSession` replay without Grok. Host deadline-drains `session/load` ActiveSession replay so Resume does not miss `fake-agent: resumed`.

Issue [#3](https://github.com/Andy115951/acp-desktop/issues/3) is **closed** (M2 Done on the [project board](https://github.com/users/Andy115951/projects/2)). Optional polish [#9](https://github.com/Andy115951/acp-desktop/pull/9) (last workspace folder prefs) is merged to `main`.

**Done on main:** [#4](https://github.com/Andy115951/acp-desktop/issues/4) M3 `AgentBackend` (`GrokBackend` + `connect_agent`).

**Done on main:** [#5](https://github.com/Andy115951/acp-desktop/issues/5) M4 — Codex via `@agentclientprotocol/codex-acp`, Agents list + Switch dropdown, per-vendor session prefs (`{agentId}.sessionByCwd`) (merged [#12](https://github.com/Andy115951/acp-desktop/pull/12); Mac UI E2E waived).

**Done on main:** [#6](https://github.com/Andy115951/acp-desktop/issues/6) M5 macOS packaging (`tauri build` → `.app` / `.dmg`; no vendor CLIs in the bundle). See [docs/PACKAGING.md](docs/PACKAGING.md).

**Done on main:** [#14](https://github.com/Andy115951/acp-desktop/issues/14) M6 Claude via `@agentclientprotocol/claude-agent-acp` (merged [#15](https://github.com/Andy115951/acp-desktop/pull/15) as `ae0df18`) — detect `claude-agent-acp` **or** `claude`, spawn binary or `npx -y`, Agents list selectable, per-vendor session prefs.

**This PR (M7):** UI language (`en` / `zh-CN`) — header locale toggle, `tauri-plugin-store` key `ui.locale`, chrome strings in `App.tsx` + `PermissionCard.tsx` (no agent transcript / protocol translation).

Plan board: [acp-desktop project](https://github.com/users/Andy115951/projects/2) (issues #2–#6 Done; [#17](https://github.com/Andy115951/acp-desktop/issues/17) M7).

## Develop

Prerequisites: [Node.js](https://nodejs.org/), [Rust](https://rustup.rs/), and OS webview deps ([Tauri prerequisites](https://tauri.app/start/prerequisites/) — on macOS that means Xcode CLT / WebKit).

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

1. **Tauri skeleton + Grok detect** — done (M1 / [#2](https://github.com/Andy115951/acp-desktop/issues/2))
2. **Grok ACP path** — done (M2 / [#3](https://github.com/Andy115951/acp-desktop/issues/3), [#8](https://github.com/Andy115951/acp-desktop/pull/8) + [#9](https://github.com/Andy115951/acp-desktop/pull/9))
3. **AgentBackend** — done (M3 / [#4](https://github.com/Andy115951/acp-desktop/issues/4), [#11](https://github.com/Andy115951/acp-desktop/pull/11))
4. **Multi-agent switch** — done (M4 / [#5](https://github.com/Andy115951/acp-desktop/issues/5), [#12](https://github.com/Andy115951/acp-desktop/pull/12))
5. **macOS packaging** — done (M5 / [#6](https://github.com/Andy115951/acp-desktop/issues/6)); see [docs/PACKAGING.md](docs/PACKAGING.md)
6. **Claude backend** — done (M6 / [#14](https://github.com/Andy115951/acp-desktop/issues/14), [#15](https://github.com/Andy115951/acp-desktop/pull/15))
7. **UI language** — this PR (M7 / [#17](https://github.com/Andy115951/acp-desktop/issues/17)): `en` / `zh-CN` chrome locale

## Tech notes

- Protocol: **ACP v1 (stable)**, local stdio subprocess only
- Shell: **Tauri 2** + **React** (Vite, TypeScript, Tailwind, Zustand)
- ACP client: official Rust crate [`agent-client-protocol`](https://crates.io/crates/agent-client-protocol)
- Layout: single repo (`src/` frontend + `src-tauri/` backend)
- Agents: built-in table + user-defined command/args (no ACP Registry in v1)
- Preferences: `tauri-plugin-store` (last folder / selected agent / `ui.locale`); no local session DB
- First agent: **Grok Build** via `grok agent stdio`

### Still open

- Mac UI E2E for real Codex / Claude Connect / Ask / Resume — **waived** as a merge/dev blocker (headless `smoke:codex-acp` / `smoke:claude-acp` + fake-agent CI remain)
- Packaging notarization / auto-update (needs Apple Developer ID; see [docs/PACKAGING.md](docs/PACKAGING.md))
- UI language (`en` / `zh-CN`) — tracked by [#17](https://github.com/Andy115951/acp-desktop/issues/17) (this PR)

## Non-goals

- Shipping or bundling vendor binaries / official logos
- Default YOLO / auto-approve everything
- PTY-wrapping a TUI that has no ACP
- Forking third-party vendor desktop shells as the mainline
- Unified account or unified cross-vendor session format
- Collecting tokens

## License

MIT. See [LICENSE](LICENSE).

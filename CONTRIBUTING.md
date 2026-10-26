# Contributing

ACP Desktop is an unofficial, vendor-neutral ACP v1 client. Contributions are
welcome under the [MIT license](LICENSE). Keep user-facing documentation and
GitHub issue/PR descriptions in English; the application also has a zh-CN locale.
The [Project](https://github.com/users/Andy115951/projects/2) and linked issues
track scope and acceptance. If the board is inaccessible, use the public issues.
Discuss substantial new scope in an issue before implementing it.

## Set up a checkout

Use Node 22.23.4 for parity with the macOS candidate pipeline and Rust 1.90 from
`rust-toolchain.toml`. Install the [Tauri platform prerequisites](https://v2.tauri.app/start/prerequisites/)
(Xcode Command Line Tools on macOS). Clone the repository, then run:

```bash
npm ci
cargo test -p fake-acp-agent --locked
cargo test -p acp-desktop --locked
npm test
npm run build
```

These checks do not require vendor credentials or activate an application window.
`npm test` runs Vitest and Node script regressions; `npm run build` type-checks
and builds the frontend. Rust tests include production host paths exercised
against deterministic ACP peers. Run Rust tests and Tauri packaging sequentially
when they share the same `target/` directory.

For an interactive local smoke, when you are ready for a test window:

```bash
npm run tauri:fake
```

Select a folder, connect, send a prompt, allow/reject the fixture permission,
disconnect and Resume. The fixture proposes actions but does not execute vendor
tools. Additional flags and prompts are listed in the [README](README.md#fake-acp-agent-permission-smoke).
Use a disposable workspace and keep existing app preferences intact. Automated
UI tools must not activate windows or type into a user's desktop without a
currently approved test window. A background build does not need to activate UI.

## Change and verify

- Keep each PR focused on a concrete behavior or documentation problem. Do not
  include generated bundles, local preferences, vendor binaries or private logs.
- Preserve ACP v1 negotiation and capability-driven fallbacks. Do not assume
  every agent supports Resume, listing, commands, usage or configuration.
- Keep the Rust host responsible for process/protocol operations. Pass custom
  executable, arguments and environment separately; do not add shell parsing.
- Keep permission decisions explicit. Do not add default auto-approval or expand
  trust based on agent-authored text.
- Add meaningful regressions for changed behavior. For documentation-only work,
  verify commands, relative links and claims against the source/evidence instead
  of adding tests that merely mirror prose.
- Update both UI locales for changed chrome. Do not translate agent messages or
  persist transcripts in the app's preference store.
- Never send secrets through fixtures, screenshots, issue bodies or PR output.
  Follow the [diagnostic reporting guide](docs/TROUBLESHOOTING.md#reporting-a-problem).

In the PR description, state the problem, resulting behavior, relevant checks
and any unperformed acceptance. Record the exact commit for CI and the app/CLI
versions for real-agent acceptance. Native interaction changes need native
verification; fake-agent tests and headless vendor smokes are distinct evidence.
Do not mark an environment blocker or a skipped check as a pass. Merge only when
the latest commit's relevant CI passes and valid review findings are resolved.

## Optional real-agent checks

Install and authenticate the CLI separately. The app's npx fallback may download
an adapter; using an explicitly installed adapter makes its version reviewable.
The [compatibility matrix](docs/COMPATIBILITY.md) records tested versions and
limits; it is not a guarantee for the newest vendor release.

```bash
npm run smoke:codex-acp
npm run smoke:claude-acp
npm run smoke:copilot-acp
```

Run only the agent you intend to test. These scripts make real account requests,
can consume quota and create vendor sessions. Their permission handler automatically
selects an advertised Allow option (falling back to the first option); they do not
present the app’s permission cards. Use only a trusted CLI in the script’s
disposable test workspace. They are opt-in and are not part of CI. The `*_ACP_SMOKE_SKIP_PROMPT=1` variants documented in the README still
connect and create/load sessions; they are not an offline check. Inspect output
before sharing: raw provider errors/stderr can include private data. Do not
repeatedly retry a known login/TLS blocker; fix the environment first. Headless
success does not certify desktop installation, focus or permission-card UX.

## Packaging and releases

Follow [PACKAGING.md](docs/PACKAGING.md) for audited arm64 candidates. The workflow
has read-only repository permissions and does not publish Releases. Candidate
builds are ad-hoc signed and not notarized; a fresh-user install remains a separate
gate. Proposed changes to signing, bundle resources, versioning or publication
must update the manifest/audit and documented trust status together.

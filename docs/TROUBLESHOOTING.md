# Troubleshooting and diagnostic reports

Start with the [compatibility matrix](COMPATIBILITY.md). The app uses your local
CLI login; it does not install vendor CLIs or offer a shared account/token store.

## Before the first connection

1. Install and authenticate the intended CLI using its own instructions. Check
   that it works outside ACP Desktop, in a disposable workspace if testing tools.
2. Make its ACP executable available to the app. Grok uses `grok agent stdio`,
   Copilot uses `copilot --acp`, and Codex/Claude use adapters. The latter two may
   download an adapter through npx if only the underlying CLI is detected.
3. Start ACP Desktop, click its window when ready, pick the intended folder and
   select the agent. Connect starts a new session; Resume loads the selected
   saved session when supported. Read each permission request before deciding.
4. Disconnect before changing workspace or agent. Resume and recent workspaces
   use local metadata; vendor storage remains the source of conversation history.

Candidate archives are not yet a verified end-user installation path. See
[PACKAGING.md](PACKAGING.md) for actual trust status and the pending fresh-user
check. A source build is the current developer path.

## Common symptoms

| Symptom | What to check |
| --- | --- |
| Agent grey / executable missing | A desktop-launched app may inherit a different PATH from your shell. Check the executable location; use a custom profile with an absolute executable path when needed. Do not put quotes around a path containing spaces in the executable field. |
| Adapter startup timeout | Ensure Node/npx and the adapter are available in the app environment. Installing a known adapter version avoids the fallback's first-run download. Do not treat detect success as a login test. |
| Authentication, quota or TLS error | Verify the CLI's own login/network/quota state. A usage limit is not fixed by reinstalling the app. Keep TLS verification enabled; fix the trust configuration with the service/proxy administrator. Claude's recorded blocker is [#22](https://github.com/Andy115951/acp-desktop/issues/22). |
| ACP version mismatch | Use a v1-compatible endpoint. Draft v2 is not negotiated. The failed connection returns to idle without deleting the saved session. |
| No commands, context or configuration | The agent may not report them. Unknown is not zero usage, and absent controls do not imply a broken connection. |
| Configuration change fails | Retain the last reported selection, read the notice and retry an advertised value. Disconnect is available while waiting. Raw provider configuration errors are intentionally not exposed. |
| Session list incomplete | Discovery is bounded and filtered to the selected agent/workspace. Existing local entries remain usable. Unsupported listing falls back to the app-known catalog. |
| Resume no longer available | A vendor may have removed/expired a session. Start New if appropriate; other entries and vendor storage are retained. Rename/Archive affect only app metadata. |
| Custom profile cannot launch | Check executable permission, literal JSON argument array, ACP v1 support and non-secret environment names. The app sanitizes custom process diagnostics; inspect the trusted CLI locally rather than putting secrets into a profile. |
| Startup seems unresponsive | Startup intentionally does not request focus. Click the window to interact. Report an unexpected focus change separately, including whether it happened at launch or during automation. |

## Reporting a problem

Use the public bug template with:

- App version/commit and, for a candidate, filename and SHA-256.
- OS version and architecture; CLI and adapter versions separately.
- Source build versus downloaded candidate; built-in or custom profile.
- Small reproduction steps, expected/actual behavior, and the failing phase:
  detect, spawn, initialize, New, prompt, permission, configuration or Resume.
- Whether a deterministic fake-agent check reproduces it. This is useful but
  optional; do not run real-account scripts just to file an issue.
- A short, manually reviewed diagnostic excerpt. Preserve the error category
  and phase while replacing private values with placeholders.

Example of a useful redacted report:

```text
App: <commit>; macOS: <version>, arm64; adapter: <name/version>
Phase: Resume; workspace: <workspace>; session: <session>
Expected: prior messages replay. Actual: session/load failed, returned to idle.
Minimal steps: connect, disconnect, remove fixture session, resume.
```

Collapsed technical details, provider stderr, smoke-script output, screenshots
and agent/tool messages can contain secrets or personal content. The app's safe
custom/configuration diagnostics are not a guarantee that all other content is
sanitized. Remove API keys, bearer tokens, cookies, private URLs, query-string
credentials, home/workspace paths, prompts, source code and real session IDs.
Do not attach entire `prefs.json`, `custom-agents.json`, environment dumps,
credential directories or raw transcripts. Custom profiles are plain text, not
a secret store, even though credential-like environment keys are rejected.

If a secret was posted publicly, remove it and rotate/revoke it with its issuer;
editing the visible text alone does not invalidate it. For a potential security
issue, avoid posting an exploit with private data in a public bug report. Use
GitHub's private vulnerability reporting option if the repository exposes it;
otherwise ask for a private contact without disclosing sensitive details.

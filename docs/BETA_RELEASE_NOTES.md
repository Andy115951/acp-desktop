# 0.1.0-beta.1 — release notes draft

**Unreleased.** This is reviewable release copy, not an announcement or download.
The source declares `0.1.0-beta.1`; the intended tag is `v0.1.0-beta.1`.
No tag or public Release has been created. Do not publish this draft as a completed release while the gates
below are open.

## What is included

- A vendor-neutral local ACP v1 desktop client with built-in Grok, Codex, Claude
  and Copilot launch paths, using each CLI's existing login and conversation store.
- Streaming Markdown, tool/diff presentation, explicit inline permission cards,
  cancellation and recovery. English and Simplified Chinese application chrome.
- Recent workspaces, multiple saved sessions, local rename/archive/restore and
  capability-gated vendor discovery. Agent/workspace metadata stays separate.
- Agent-reported slash commands, context usage and session configuration choices,
  with unknown states when reports are absent and safe handling of rejected edits.
- Custom executable/argument-array/non-secret environment profiles with stable IDs.
- A conversation sidebar, dedicated transcript and fixed composer; System/Light/Dark
  appearance with locally saved preferences and an integrated macOS title bar.
- macOS startup that preserves the existing foreground application's focus.
- Audited arm64 candidate archives with checksums, build manifests and no bundled
  vendor CLIs or credentials.

## Compatibility and limitations

See the [evidence matrix](COMPATIBILITY.md) for exact tested versions. Copilot and
Codex have recorded real Mac Connect/Ask/Resume evidence; Grok's recorded real
verification is headless. Claude can initialize/connect in the tested setup but
Ask/Resume remain externally blocked in [#22](https://github.com/Andy115951/acp-desktop/issues/22).
No universal compatibility claim is made for newer CLI or custom-agent versions.

Candidates are **macOS arm64, ad-hoc signed, not notarized**. Intel macOS, Linux
and Windows desktop distributions are unverified/experimental. The configured
macOS 11.0 minimum is not a tested range. Fresh-user candidate installation has
not yet passed. There is no auto-update, shared credential store, transcript
export/database, draft ACP v2 support or default permission auto-approval.

## Install and upgrade guidance

Until a release is published and its installation acceptance is recorded, use
[the source-build instructions](../CONTRIBUTING.md) or the explicitly labeled
[candidate workflow](PACKAGING.md). Actions candidates expire after 14 days and
are not a permanent release channel. Do not infer notarization from a checksum.

For an existing source-build user, quit ACP Desktop before replacing the app.
Back up the app's private preference/configuration files locally if needed; do
not attach those backups to public issues. Keep the same application identifier
when preserving preferences. Legacy per-workspace session IDs migrate once into
the newer catalogs; existing catalogs remain authoritative. Unknown schemas are
not overwritten. Downgrade compatibility is not certified: preserve a backup
from before upgrading rather than asking an older version to rewrite new data.
Vendor conversation/login storage is independent and must not be deleted as an
upgrade step. Custom profiles keep stable IDs when edited; removing and recreating
a profile assigns a new identity.

## Publication gates still open

- Source version is aligned to `0.1.0-beta.1`; verify the candidate manifest
  and create `v0.1.0-beta.1` only after acceptance and publication authorization.
- Build the final candidate from that versioned source and record its checksum.
- Complete the approved fresh-user Mac installation and first-connection check on
  that exact candidate, including actual Gatekeeper behavior and startup focus.
- Confirm the distribution trust status; signing/notarization requires separate
  credentials and pipeline work if chosen.
- Finalize these notes with the verified artifact links, exact version, install
  evidence and accepted limitations; obtain publication authorization.
- Publish the reviewed assets/manifest/checksums as a GitHub prerelease and verify
  the public download. A successful Actions build alone does not complete M12.

Bug reports should follow [TROUBLESHOOTING.md](TROUBLESHOOTING.md); contributions
start with [CONTRIBUTING.md](../CONTRIBUTING.md).

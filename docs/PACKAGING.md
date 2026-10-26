# macOS build and release candidates

The candidate pipeline builds **Apple Silicon (arm64)** application archives.
It does not publish a GitHub Release or claim a fresh-user install has passed.
Intel macOS, Windows and Linux runtime artifacts remain unverified by this
pipeline. The configured macOS minimum is 11.0; that is a build setting, not a
claim that every supported OS version has been exercised.

## Automated candidates

The **macOS artifacts** workflow runs on pull requests, manual dispatch and
`v*` tags. It uses a native `macos-15` arm64 runner, Rust 1.90, Node 22.23.4,
`npm ci` and Cargo's locked dependency resolution. Action references are pinned
to commits. This makes the inputs reviewable and the build repeatable; it does
**not** promise byte-identical archives across changing runner/SDK images or
code-signing timestamps. The manifest records the actual tools and lock hashes.

Each successful run uploads an Actions artifact (retained for 14 days) containing:

- `acp-desktop-<version>-macos-arm64-<commit>.app.zip`
- A JSON manifest: full source commit, version, architecture, tool versions,
  lockfile hashes, audited bundle files, archive size and SHA-256 digest.
- `SHA256SUMS` for the archive and manifest.

PR artifacts represent the actual checkout commit (normally GitHub's test merge
commit), not necessarily the branch head. A tag must match the versions in
`package.json`, `package-lock.json`, `src-tauri/Cargo.toml` and `tauri.conf.json`.
Build/download access to Actions artifacts follows GitHub repository permissions.
These temporary artifacts are not a permanent public beta download channel.

## Trust status

Candidates use an **ad-hoc signature**, verified with `codesign --verify --deep
--strict`. They are **not Developer ID signed or notarized**. A checksum verifies
that a download matches the recorded artifact; it does not establish Apple trust.
Gatekeeper may block downloaded candidates. Do not describe them as notarized or
ask users to disable system security globally. Until signed distribution is
ready, source builds are the developer path; any candidate-install test must
record its actual quarantine/Gatekeeper behavior and explicit user decisions.

No Apple certificate, password or signing secret is required for this workflow.
Adding Developer ID signing/notarization is a separate reviewed change that must
also update the manifest's trust fields. See [Tauri's signing documentation](https://v2.tauri.app/distribute/sign/macos/).
Auto-update is not implemented.

## Reproduce the arm64 candidate locally

Use a clean committed checkout on an Apple Silicon Mac with Xcode Command Line
Tools, Node 22.23.4 and the project's Rust toolchain. No application window opens
for these steps:

```bash
npm ci
rustup target add aarch64-apple-darwin
CI=true APPLE_SIGNING_IDENTITY=- npm run tauri -- build --target aarch64-apple-darwin --bundles app -- --locked
node scripts/package-macos.mjs
(cd release-artifacts && shasum -a 256 -c SHA256SUMS)
```

The archive command requires an empty `release-artifacts/` directory. Move an
existing candidate elsewhere before producing another. Source/lockfile version
mismatches, non-system dynamic libraries, unexpected bundle files and signature
failures stop packaging. The manifest intentionally starts with
`nativeInstallVerified: false`; building cannot certify an install test.

With an explicit target, the application is under
`target/aarch64-apple-darwin/release/bundle/macos/ACP Desktop.app` at the workspace
root. A normal native build without `--target` uses `target/release/bundle/`.
The old `src-tauri/target/` path does not apply to this Cargo workspace.

For an optional local DMG, `npm run tauri:build:macos` builds `.app` and `.dmg`.
The CI candidate pipeline uses a `.app.zip` to avoid Finder-driven disk-image
layout and preserve the signed bundle with `ditto`. Local DMGs are not covered
by the candidate archive audit or installation claim.

## Bundle boundary

The app identity is `com.andy115951.acp-desktop`, product `ACP Desktop`.
`bundle.resources` and `bundle.externalBin` remain empty. The audit accepts only
Info.plist, the application executable, its icon and code-signature resources;
symlinks and any unexpected files fail. In particular it rejects vendor/fake
agent binaries, preference files, environment files and development journals.
Dynamic libraries must resolve to system framework/library locations.

The frontend is embedded in the executable; it does not require shipping the
checkout, node_modules or vendor CLIs. Users install and authenticate their CLI
separately. A clean hosted runner cannot import the developer's local preferences
or login state. The allowlist must be reviewed if resources or runtime libraries
are deliberately introduced later.

## Candidate installation acceptance (not yet completed)

After a user explicitly allows foreground testing:

1. Download the artifact for the exact intended commit and verify `SHA256SUMS`.
2. Record Mac model/architecture, macOS version and actual signature/quarantine
   status. Extract the zip and copy the app to the chosen Applications location.
3. Launch in a fresh app preference context. Record Gatekeeper behavior without
   silently bypassing a prompt or claiming notarization.
4. Verify first-launch agent detection, folder selection, CLI-authenticated
   connection, permission handling, Disconnect and Resume. Check that startup
   preserves the current app's focus. Record exact CLI/adapter versions.
5. Confirm no credentials, vendor binaries or developer session data came from
   the artifact. Quit the test app and preserve the original user's preferences.

Do not replace this check with a debug build's previous acceptance. Tests of a
candidate must identify its commit and checksum.

## Release handoff

Before publishing a beta, complete Issue #35's acceptance, select and align the
beta version, prepare English release notes and upgrade instructions, and retain
verified artifacts outside the temporary Actions retention window. Record the
supported-agent matrix and accepted limitations (including Claude #22). Confirm
the intended signing/trust status and publication authorization. This workflow
only prepares candidates and has `contents: read`; it cannot publish a Release.

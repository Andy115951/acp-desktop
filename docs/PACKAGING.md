# Packaging (M5)

Goal ([Issue #6](https://github.com/Andy115951/acp-desktop/issues/6)): `tauri build` produces a usable **macOS** `.app` / `.dmg`. Vendor CLIs stay **out** of the bundle — users install `grok` / `codex-acp` themselves.

## Bundle identity

| Key | Value |
| --- | --- |
| Product name | `ACP Desktop` |
| Bundle id | `com.andy115951.acp-desktop` |
| Category | DeveloperTool |
| Min macOS | 11.0 |
| Icons | `src-tauri/icons/` (`.icns` for macOS) |
| Entitlements | `src-tauri/Entitlements.plist` (hardened-runtime placeholders) |
| Extra Info.plist | `src-tauri/Info.plist` (merged by Tauri) |

`bundle.resources` and `bundle.externalBin` are intentionally **empty** so agent binaries are never embedded.

## Build on a Mac

```bash
npm install
# .app + .dmg only (configured default targets)
npm run tauri:build:macos
# or:
npx tauri build --bundles app,dmg
```

Artifacts land under `src-tauri/target/release/bundle/` (`macos/*.app`, `dmg/*.dmg`).

### Signing / notarization (deferred)

Out of scope for the first M5 slice and earlier milestones:

- Developer ID Application certificate
- Notarization / stapling
- Auto-update

When you have a cert in Keychain:

```bash
export APPLE_SIGNING_IDENTITY="Developer ID Application: Your Name (TEAMID)"
# optional notarization env: APPLE_ID, APPLE_PASSWORD, APPLE_TEAM_ID
npm run tauri:build:macos
```

Or set `bundle.macOS.signingIdentity` in `tauri.conf.json`. Ad-hoc local builds work without it (Gatekeeper will warn for unsigned apps).

### Linux / CI note

This box can validate config + unit tests. A full `.app`/`.dmg` requires macOS (Xcode CLT). CI continues to run `cargo test` / `tsc` / `vitest` without packaging.

## Verify “no vendor CLIs”

After building on Mac:

```bash
# should NOT contain grok / codex / claude agent binaries
find src-tauri/target/release/bundle/macos -type f -perm +111 | head
```

Connect still probes `PATH` at runtime (`detect_agents`).

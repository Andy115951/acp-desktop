# Compatibility and verification evidence

Evidence snapshot: **2026-10-26**. ACP Desktop uses **ACP v1 over local stdio**.
A successful feature implementation is not proof that every vendor implements
it. Rows below distinguish real-account evidence, deterministic fixtures and
unperformed checks. Exact versions describe the tested setup, not minimum or
maximum supported versions. Later vendor updates require fresh verification.

## Agent matrix

| Agent / tested version | Recorded verification | Limits and evidence |
| --- | --- | --- |
| Grok Build **1.0.34** (`grok agent stdio`) | macOS headless initialize, streaming New and Resume on 2026-09-21 | Permission UI at that milestone used the Linux fake agent, not a real Grok tool request. No current candidate-install claim. [#3](https://github.com/Andy115951/acp-desktop/issues/3) |
| Codex adapter **codex-acp 2.2.2** | Real protocol smoke and packaged Mac Connect/Ask/Resume; replay verified again on 2026-10-23 | Underlying Codex CLI version was not recorded in that acceptance. Quota/stale-session recovery was injected with the fake agent, not a real exhausted account. [#24](https://github.com/Andy115951/acp-desktop/issues/24) |
| Copilot CLI **1.0.103** (`copilot --acp`) | Real Mac Connect/Ask/Resume, permission Allow/Deny, relaunch and agent switching on 2026-10-23; session listing, command/configuration reports in M10/M11 | 32 reported commands rendered; usage stayed unknown. Configuration values were inspected without changing real-agent model/permission settings. Accepted/rejected configuration writes were fixture-tested. [#23](https://github.com/Andy115951/acp-desktop/issues/23), [#33](https://github.com/Andy115951/acp-desktop/issues/33), [#34](https://github.com/Andy115951/acp-desktop/issues/34) |
| Claude adapter **claude-agent-acp 0.94.0** | Real detection, initialize and session/new on 2026-10-23 | **Blocked, not fully verified.** Ask failed with `UNABLE_TO_GET_ISSUER_CERT`; direct CLI also returned `API Key disabled`. Ask/Resume/permissions remain open. Underlying CLI version was not recorded. [#22](https://github.com/Andy115951/acp-desktop/issues/22) |
| Custom ACP v1 profiles | In-repo fixture at M11 merge `73dc55b`: native paths with spaces, literal argv, separate environment, stable IDs, persistence and isolated app catalogs | No arbitrary third-party custom agent is certified. Two profiles may still share vendor storage. [#34](https://github.com/Andy115951/acp-desktop/issues/34) |

Codex and Claude prefer installed adapter executables. Their fallback is an
unpinned `npx -y` package invocation, which can resolve a different version later.
Install an explicit adapter version or use a custom executable profile when
reproducing a report. Detection only proves an executable is available, not that
login, network, quota or the ACP handshake will succeed.

## Protocol and feature boundaries

| Feature | Behavior when absent or unsupported | Verification boundary |
| --- | --- | --- |
| Protocol version | Reject any negotiated version other than v1 before discovery/New/Resume; retain saved metadata | In-memory peers and stdio/native fixture cover invalid versions and recovery; no draft v2 support |
| Resume and discovery | Capability-gated; app-known catalogs remain available if listing is unsupported or fails | Fixtures cover pagination, errors, foreign workspaces and preservation of local titles/archives; real Copilot listing also checked |
| Commands and context | Use only explicit reports; missing stays unknown; empty command list revokes previous commands | Native fixtures cover live replacement/reset. No estimated token counts or normalized prices |
| Configuration | Agent-reported select/grouped choices; wait for authoritative accepted response; retain reported value on failure | Native fixtures cover success, rejection, live replacement and Disconnect. Unsupported controls are read-only; boolean support is not advertised |
| Unknown capabilities | Ignore unknown object keys and default missing supported flags off | Arbitrary unknown wire enum variants still depend on the pinned SDK schema; not universally supported |
| Client tools | No filesystem/terminal client capabilities advertised | Agents may perform their own tools and request permission; ACP Desktop is not a sandbox for a trusted executable |

## Platform and artifact matrix

| Target | Evidence | Distribution claim |
| --- | --- | --- |
| macOS arm64 | Native app checks through M11; clean hosted release build on **macOS 15.7.9**, Rust **1.90.0**, Node **22.23.4**, Tauri CLI **2.12.4** in [run 40297374388](https://github.com/Andy115951/acp-desktop/actions/runs/40297374388); downloaded archive/signature/hash/architecture checks passed | Candidate only: ad-hoc signed, not notarized; fresh-user install/first connection pending |
| macOS Intel | No candidate artifact or native acceptance in this pipeline | Unverified / experimental |
| Linux | Rust/frontend/script CI, plus historical fake-agent UI evidence | No published desktop artifact or current fresh-user install acceptance; experimental runtime |
| Windows | No recorded artifact or native acceptance | Unverified / experimental |

The configured macOS minimum **11.0** is a build setting, not a tested OS range.
Historical real-agent Mac checks did not consistently record the OS version, so
they must not be presented as an exact-version platform certification.

The audited candidate was built from PR merge checkout
`019e2e5167c2c806bce700b69f9549ac1cb593da` (PR #47 head `51ac47f`). Its app zip SHA-256
is `a251b299460aeac617f06ae833699f947bc7a1b82d8a4fb0d5c3b65b38f0b0b9`.
Its manifest deliberately records `nativeInstallVerified: false`. Later release
candidates need their own checksum and installation evidence; neither a CI build
nor previous debug-app UI acceptance substitutes for that check.

## Updating this matrix

Record app commit and artifact checksum, macOS/architecture, exact CLI **and**
adapter versions, negotiated protocol, advertised capabilities, the operations
actually performed and remaining blockers. Link the issue/PR evidence. Do not
include credentials, private paths or raw session IDs. Keep skipped real checks
separate from fixture coverage and avoid changing a blocked row to passed based
only on an unrelated CI run.

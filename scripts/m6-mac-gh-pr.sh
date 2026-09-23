#!/usr/bin/env bash
# Run on Mac (machineId 981c58e9-…) where `gh` can create Issues/PRs.
set -euo pipefail
REPO="${REPO:-Andy115951/acp-desktop}"
BRANCH="${BRANCH:-feat/claude-backend}"
cd "${ACPDESKTOP_DIR:-$HOME/Documents/code/other/acp-desktop}"

git fetch origin
git checkout "$BRANCH"
git pull --ff-only origin "$BRANCH"

ISSUE_URL=$(gh issue create --repo "$REPO" --title "M6: Claude backend" --body "$(cat <<'MD'
## Goal
Ship Claude Code as the third AgentBackend (deferred from M4).

## Research
Official ACP adapter: `@agentclientprotocol/claude-agent-acp` (bin `claude-agent-acp`).

## Scope
- [x] ClaudeBackend + detect/spawn (claude-agent-acp or claude / npx)
- [x] Agents list selectable; per-vendor session prefs; enriched Connect errors
- [x] Unit/vitest/docs + smoke:claude-acp
- [ ] Mac UI Connect / Ask / Resume (manual)

Branch: `feat/claude-backend`
MD
)")
echo "issue: $ISSUE_URL"
ISSUE_NUM="${ISSUE_URL##*/}"

PR_URL=$(gh pr create --repo "$REPO" --base main --head "$BRANCH" --title "M6: ClaudeBackend via claude-agent-acp" --body "$(cat <<MD
Closes #$ISSUE_NUM

## Summary
- Official adapter: \`@agentclientprotocol/claude-agent-acp\` (bin \`claude-agent-acp\`).
- \`ClaudeBackend\`: detect \`claude-agent-acp\` **or** \`claude\`; spawn binary or \`npx -y\`.
- Agents list selectable (no more “later”); per-vendor session prefs; enriched Connect errors.
- Docs + \`npm run smoke:claude-acp\`.

## Test plan
- [x] \`cargo test -p acp-desktop --lib\` (53)
- [x] \`cargo test -p fake-acp-agent\`
- [x] \`npm test\` (68) + \`tsc\`
- [ ] Mac Claude Connect → Ask → Resume
- [ ] Optional: \`npm run smoke:claude-acp\`

## Manual
Mac Claude Connect (login / \`ANTHROPIC_API_KEY\` + adapter on PATH or npx).
MD
)")
echo "pr: $PR_URL"

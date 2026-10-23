import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, delimiter } from "node:path";
import { fileURLToPath } from "node:url";

// Exercise the actual CLI entry point with a local stdio fixture. No vendor
// credentials, installed adapter or network access are needed in CI.
const fixture = `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const root = process.env.ACP_SMOKE_FIXTURE_DIR;
fs.appendFileSync(path.join(root, "started"), process.pid + "\\n");
process.on("SIGTERM", () => {
  fs.appendFileSync(path.join(root, "stopped"), process.pid + "\\n");
  process.exit(0);
});
function send(message) { process.stdout.write(JSON.stringify(message) + "\\n"); }
function update(kind) {
  send({ jsonrpc: "2.0", method: "session/update", params: {
    sessionId: "fixture-session", update: { sessionUpdate: kind, content: { type: "text", text: "pong" } }
  } });
}
require("node:readline").createInterface({ input: process.stdin }).on("line", line => {
  const request = JSON.parse(line);
  let result = {};
  if (request.method === "initialize") {
    result = { protocolVersion: 1, agentCapabilities: { loadSession: true },
      authMethods: process.env.ACP_SMOKE_FIXTURE_MODE === "invalid-auth" ? "invalid" : [] };
  } else if (request.method === "session/new") {
    if (process.env.ACP_SMOKE_FIXTURE_MODE === "new-fails") {
      send({ jsonrpc: "2.0", id: request.id, error: { code: -32603, message: "fixture session failure" } });
      return;
    }
    result = { sessionId: "fixture-session" };
  } else if (request.method === "session/prompt") {
    update("agent_message_chunk");
    result = { stopReason: "end_turn" };
  } else if (request.method === "session/load") {
    update("user_message_chunk");
    update("agent_message_chunk");
  }
  send({ jsonrpc: "2.0", id: request.id, result });
});
`;

function runSmoke(mode, check) {
  const root = mkdtempSync(join(tmpdir(), "claude-smoke-test-"));
  try {
    writeFileSync(join(root, "claude-agent-acp"), fixture, { mode: 0o755 });
    const result = spawnSync(process.execPath, [fileURLToPath(new URL("./smoke-claude-acp.mjs", import.meta.url))], {
      env: {
        ...process.env,
        PATH: `${root}${delimiter}${process.env.PATH}`,
        TMPDIR: root,
        ACP_SMOKE_FIXTURE_DIR: root,
        ACP_SMOKE_FIXTURE_MODE: mode,
        CLAUDE_ACP_SMOKE_TIMEOUT_MS: "2000",
        CLAUDE_ACP_SMOKE_SKIP_PROMPT: "0",
      },
      encoding: "utf8",
      timeout: 10000,
    });
    assert.ifError(result.error);
    check(result);
    // Failure must run finally too: every adapter exits and the temporary
    // conversation directory is removed before the smoke process returns.
    const pids = readFileSync(join(root, "started"), "utf8").trim().split("\n").sort();
    const stopped = readFileSync(join(root, "stopped"), "utf8").trim().split("\n").sort();
    assert.deepEqual(stopped, pids);
    assert.equal(readdirSync(root).some(name => name.startsWith("acp-desktop-claude-smoke-")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("Claude with empty authMethods completes Connect, Ask and fresh-process Resume", () => {
  runSmoke("success", result => {
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /PASS \(initialize \+ session\/new \+ session\/prompt \+ session\/load\)/);
  });
});

test("invalid authMethods fails and cleans up the adapter and temporary cwd", () => {
  runSmoke("invalid-auth", result => {
    assert.equal(result.status, 1);
    assert.match(result.stderr, /authMethods must be an array/);
  });
});

test("session creation failure cleans up after a valid Claude handshake", () => {
  runSmoke("new-fails", result => {
    assert.equal(result.status, 1);
    assert.match(result.stderr, /fixture session failure/);
  });
});

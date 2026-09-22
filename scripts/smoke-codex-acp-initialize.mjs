#!/usr/bin/env node
/**
 * Headless Mac/Linux smoke: spawn Codex ACP the same way CodexBackend does
 * (`codex-acp` on PATH, else `npx -y @agentclientprotocol/codex-acp`), send
 * ACP `initialize` over stdio NDJSON, assert protocolVersion 1 + capabilities.
 *
 * Mirrors pure helpers in src-tauri/src/agent_backend.rs:
 *   codex_is_detectable / codex_spawn_argv
 *
 * Not run in CI (needs network/npx cache or a local binary). Local:
 *   npm run smoke:codex-acp
 */
import { spawn, spawnSync } from "node:child_process";
import { createInterface } from "node:readline";

const TIMEOUT_MS = Number(process.env.CODEX_ACP_SMOKE_TIMEOUT_MS || 90_000);

function onPath(bin) {
  const r = spawnSync(process.platform === "win32" ? "where" : "which", [bin], {
    encoding: "utf8",
  });
  return r.status === 0;
}

/** Same rule as `codex_is_detectable` / `codex_spawn_argv` in agent_backend.rs */
function resolveCodexSpawn() {
  const hasCodexAcp = onPath("codex-acp");
  const hasCodex = onPath("codex");
  const detectable = hasCodexAcp || hasCodex;
  const argv = hasCodexAcp
    ? ["codex-acp"]
    : ["npx", "-y", "@agentclientprotocol/codex-acp"];
  return { hasCodexAcp, hasCodex, detectable, argv };
}

function fail(msg) {
  console.error(`smoke-codex-acp-initialize: FAIL — ${msg}`);
  process.exit(1);
}

function ok(msg) {
  console.log(`smoke-codex-acp-initialize: ok — ${msg}`);
}

async function main() {
  const resolved = resolveCodexSpawn();
  console.log(
    `detect: codex-acp=${resolved.hasCodexAcp} codex=${resolved.hasCodex} → spawn ${JSON.stringify(resolved.argv)}`,
  );

  if (!resolved.detectable) {
    fail(
      "neither `codex-acp` nor `codex` on PATH (CodexBackend.detect would be false)",
    );
  }

  // Pure argv contracts (same as Rust unit tests).
  if (resolved.hasCodexAcp) {
    if (JSON.stringify(resolved.argv) !== JSON.stringify(["codex-acp"])) {
      fail("codex_spawn_argv(true) mismatch");
    }
  } else {
    const expected = ["npx", "-y", "@agentclientprotocol/codex-acp"];
    if (JSON.stringify(resolved.argv) !== JSON.stringify(expected)) {
      fail(`codex_spawn_argv(false) mismatch: got ${JSON.stringify(resolved.argv)}`);
    }
    ok("Mac-common path: only `codex` present → npx fallback argv");
  }

  const [cmd, ...args] = resolved.argv;
  const child = spawn(cmd, args, {
    stdio: ["pipe", "pipe", "pipe"],
    env: process.env,
  });

  let stderrBuf = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    stderrBuf += chunk;
    if (stderrBuf.length > 8000) stderrBuf = stderrBuf.slice(-8000);
  });

  const rl = createInterface({ input: child.stdout, crlfDelay: Infinity });

  const initReq = {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: 1,
      clientCapabilities: {},
      clientInfo: { name: "acp-desktop-smoke", version: "0.0.0" },
    },
  };

  const resultPromise = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`timed out after ${TIMEOUT_MS}ms waiting for initialize result`));
    }, TIMEOUT_MS);

    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("exit", (code, signal) => {
      clearTimeout(timer);
      reject(
        new Error(
          `agent exited before initialize result (code=${code} signal=${signal})\nstderr:\n${stderrBuf}`,
        ),
      );
    });

    rl.on("line", (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      let msg;
      try {
        msg = JSON.parse(trimmed);
      } catch {
        return; // ignore non-JSON stdout noise
      }
      if (msg.id === 1 && (msg.result || msg.error)) {
        clearTimeout(timer);
        child.removeAllListeners("exit");
        resolve(msg);
      }
    });
  });

  child.stdin.write(JSON.stringify(initReq) + "\n");

  let msg;
  try {
    msg = await resultPromise;
  } catch (err) {
    try {
      child.kill("SIGKILL");
    } catch {
      /* ignore */
    }
    fail(String(err?.message || err));
  }

  try {
    child.kill("SIGTERM");
  } catch {
    /* ignore */
  }

  if (msg.error) {
    fail(`initialize error: ${JSON.stringify(msg.error)}`);
  }

  const result = msg.result;
  if (!result || typeof result !== "object") {
    fail(`missing result: ${JSON.stringify(msg)}`);
  }

  if (result.protocolVersion !== 1) {
    fail(`protocolVersion want 1 got ${JSON.stringify(result.protocolVersion)}`);
  }
  ok(`protocolVersion ${result.protocolVersion}`);

  const caps = result.agentCapabilities || {};
  if (caps.loadSession !== true) {
    fail(`agentCapabilities.loadSession want true got ${JSON.stringify(caps.loadSession)}`);
  }
  ok("advertises loadSession");

  const methods = Array.isArray(result.authMethods) ? result.authMethods : [];
  const ids = methods.map((m) => m && m.id).filter(Boolean);
  for (const need of ["api-key", "chat-gpt"]) {
    if (!ids.includes(need)) {
      fail(`authMethods missing ${need}; got ${JSON.stringify(ids)}`);
    }
  }
  ok(`authMethods include api-key + chat-gpt (${ids.join(", ")})`);

  const info = result.agentInfo || {};
  if (info.name) {
    ok(`agentInfo.name=${info.name} version=${info.version || "?"}`);
  }

  console.log("smoke-codex-acp-initialize: PASS");
  process.exit(0);
}

main().catch((err) => fail(String(err?.stack || err)));

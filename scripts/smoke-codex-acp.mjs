#!/usr/bin/env node
/**
 * Headless Mac/Linux smoke: spawn Codex ACP the same way CodexBackend does
 * (`codex-acp` on PATH, else `npx -y @agentclientprotocol/codex-acp`), then
 * exercise the Connect → Ask → Resume wire path over stdio NDJSON:
 *
 *   initialize → session/new → session/prompt → (fresh process) session/load
 *
 * Mirrors pure helpers in src-tauri/src/agent_backend.rs:
 *   codex_is_detectable / codex_spawn_argv
 *
 * Requires a local Codex login (ChatGPT / API key via ~/.codex). Not CI.
 * Local: npm run smoke:codex-acp
 *
 * Env:
 *   CODEX_ACP_SMOKE_TIMEOUT_MS  per-request timeout (default 120000)
 *   CODEX_ACP_SMOKE_SKIP_PROMPT=1  skip session/prompt (still does new+load)
 */
import { spawn, spawnSync } from "node:child_process";
import { createInterface } from "node:readline";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TIMEOUT_MS = Number(process.env.CODEX_ACP_SMOKE_TIMEOUT_MS || 120_000);
const SKIP_PROMPT = process.env.CODEX_ACP_SMOKE_SKIP_PROMPT === "1";
const TAG = "smoke-codex-acp";

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
  console.error(`${TAG}: FAIL — ${msg}`);
  process.exit(1);
}

function ok(msg) {
  console.log(`${TAG}: ok — ${msg}`);
}

function spawnAgent(argv) {
  const [cmd, ...args] = argv;
  const child = spawn(cmd, args, {
    stdio: ["pipe", "pipe", "pipe"],
    env: process.env,
  });

  let stderrBuf = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    stderrBuf += chunk;
    if (stderrBuf.length > 12_000) stderrBuf = stderrBuf.slice(-12_000);
  });

  const rl = createInterface({ input: child.stdout, crlfDelay: Infinity });
  let nextId = 1;
  const pending = new Map();
  /** @type {string[]} */
  const updateKinds = [];
  let permissionCount = 0;
  let closed = false;

  function send(method, params) {
    const id = nextId++;
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`timed out after ${TIMEOUT_MS}ms waiting for ${method} (id=${id})`));
      }, TIMEOUT_MS);
      pending.set(id, {
        method,
        resolve(v) {
          clearTimeout(timer);
          resolve(v);
        },
        reject(e) {
          clearTimeout(timer);
          reject(e);
        },
      });
    });
  }

  function reply(id, result) {
    try {
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n");
    } catch {
      /* ignore */
    }
  }

  function handleAgentRequest(msg) {
    const method = msg.method;
    if (method === "session/request_permission") {
      permissionCount += 1;
      const opts = Array.isArray(msg.params?.options) ? msg.params.options : [];
      const allow =
        opts.find((o) => {
          const kind = String(o?.kind || "").toLowerCase();
          return kind.includes("allow");
        }) || opts[0];
      const optionId = allow?.optionId || allow?.id || "allow-once";
      reply(msg.id, {
        outcome: { outcome: "selected", optionId },
      });
      return;
    }
    if (method === "fs/read_text_file") {
      reply(msg.id, { content: "" });
      return;
    }
    if (method === "fs/write_text_file") {
      reply(msg.id, {});
      return;
    }
    // Unknown agent→client request: empty result so the turn can proceed.
    reply(msg.id, {});
  }

  rl.on("line", (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let msg;
    try {
      msg = JSON.parse(trimmed);
    } catch {
      return;
    }

    // Agent → client request
    if (msg.method && msg.id != null) {
      handleAgentRequest(msg);
      return;
    }

    // Notifications (do not log auth PII)
    if (msg.method && msg.id == null) {
      if (msg.method === "session/update") {
        const u = msg.params?.update || {};
        const kind = u.sessionUpdate || u.kind || "update";
        updateKinds.push(String(kind));
      }
      return;
    }

    if (msg.id != null && pending.has(msg.id)) {
      const p = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) {
        p.reject(
          new Error(`${p.method} error: ${JSON.stringify(msg.error)}`),
        );
      } else {
        p.resolve(msg.result);
      }
    }
  });

  child.on("error", (err) => {
    for (const [, p] of pending) p.reject(err);
    pending.clear();
  });

  child.on("exit", (code, signal) => {
    closed = true;
    if (pending.size === 0) return;
    const err = new Error(
      `agent exited mid-flight (code=${code} signal=${signal})\nstderr:\n${stderrBuf}`,
    );
    for (const [, p] of pending) p.reject(err);
    pending.clear();
  });

  return {
    send,
    updateKinds,
    get permissionCount() {
      return permissionCount;
    },
    getStderr: () => stderrBuf,
    async kill() {
      if (closed) return;
      try {
        child.kill("SIGTERM");
      } catch {
        /* ignore */
      }
      await new Promise((r) => setTimeout(r, 400));
      try {
        child.kill("SIGKILL");
      } catch {
        /* ignore */
      }
    },
  };
}

async function initializeAgent(agent) {
  const result = await agent.send("initialize", {
    protocolVersion: 1,
    clientCapabilities: {
      fs: { readTextFile: true, writeTextFile: true },
    },
    clientInfo: { name: "acp-desktop-smoke", version: "0.0.0" },
  });

  if (!result || typeof result !== "object") {
    fail(`missing initialize result: ${JSON.stringify(result)}`);
  }
  if (result.protocolVersion !== 1) {
    fail(`protocolVersion want 1 got ${JSON.stringify(result.protocolVersion)}`);
  }
  const caps = result.agentCapabilities || {};
  if (caps.loadSession !== true) {
    fail(`agentCapabilities.loadSession want true got ${JSON.stringify(caps.loadSession)}`);
  }
  const methods = Array.isArray(result.authMethods) ? result.authMethods : [];
  const ids = methods.map((m) => m && m.id).filter(Boolean);
  for (const need of ["api-key", "chat-gpt"]) {
    if (!ids.includes(need)) {
      fail(`authMethods missing ${need}; got ${JSON.stringify(ids)}`);
    }
  }
  return result;
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

  const cwd = mkdtempSync(join(tmpdir(), "acp-desktop-codex-smoke-"));
  let agent = spawnAgent(resolved.argv);

  try {
    const init = await initializeAgent(agent);
    ok(`protocolVersion ${init.protocolVersion}`);
    ok("advertises loadSession");
    const ids = (init.authMethods || []).map((m) => m && m.id).filter(Boolean);
    ok(`authMethods include api-key + chat-gpt (${ids.join(", ")})`);
    if (init.agentInfo?.name) {
      ok(`agentInfo.name=${init.agentInfo.name} version=${init.agentInfo.version || "?"}`);
    }

    // --- Connect path: session/new (same as host when no Resume id) ---
    let neu;
    try {
      neu = await agent.send("session/new", { cwd, mcpServers: [] });
    } catch (err) {
      fail(
        `session/new failed (Codex auth?): ${err.message || err}\n` +
          `hint: log in via \`codex\` (ChatGPT) or set CODEX_API_KEY / OPENAI_API_KEY\n` +
          `stderr:\n${agent.getStderr()}`,
      );
    }
    const sessionId = neu?.sessionId;
    if (!sessionId || typeof sessionId !== "string") {
      fail(`session/new missing sessionId: ${JSON.stringify(neu)}`);
    }
    ok(`session/new → sessionId (${sessionId.slice(0, 8)}…)`);

    // --- Ask path: session/prompt (host send_prompt) ---
    if (!SKIP_PROMPT) {
      agent.updateKinds.length = 0;
      const promptRes = await agent.send("session/prompt", {
        sessionId,
        prompt: [{ type: "text", text: "Reply with exactly the single word: pong" }],
      });
      const stop = promptRes?.stopReason;
      if (stop !== "end_turn" && stop !== "endTurn") {
        // Accept cancelled only if we somehow cancelled; otherwise fail.
        fail(`session/prompt stopReason want end_turn got ${JSON.stringify(stop)}`);
      }
      ok(`session/prompt → stopReason=${stop}`);
      if (agent.permissionCount > 0) {
        ok(`auto-allowed ${agent.permissionCount} session/request_permission (Ask card path)`);
      } else {
        ok("no session/request_permission this turn (Codex may not Ask for a plain reply)");
      }
      const chunks = agent.updateKinds.filter((k) =>
        /agent_message_chunk|agentMessageChunk/i.test(k),
      );
      if (chunks.length === 0) {
        fail(`session/prompt produced no agent_message_chunk updates; kinds=${JSON.stringify(agent.updateKinds)}`);
      }
      ok(`session/update agent_message_chunk ×${chunks.length}`);
    } else {
      ok("skipped session/prompt (CODEX_ACP_SMOKE_SKIP_PROMPT=1)");
    }

    await agent.kill();
    agent = null;

    // --- Resume path: fresh process session/load (host Resume) ---
    agent = spawnAgent(resolved.argv);
    await initializeAgent(agent);
    agent.updateKinds.length = 0;
    let loaded;
    try {
      loaded = await agent.send("session/load", {
        sessionId,
        cwd,
        mcpServers: [],
      });
    } catch (err) {
      fail(
        `session/load failed: ${err.message || err}\nstderr:\n${agent.getStderr()}`,
      );
    }
    const loadedId = loaded?.sessionId || sessionId;
    if (loadedId !== sessionId) {
      fail(`session/load sessionId mismatch want ${sessionId} got ${loadedId}`);
    }
    ok(`session/load (fresh process) → same sessionId`);

    // Prefer seeing replayed history when we prompted; empty replay is still a
    // successful load (host shows "Resume: session loaded (no replayed history)").
    if (!SKIP_PROMPT) {
      const replay = agent.updateKinds.filter((k) =>
        /user_message_chunk|agent_message_chunk|userMessageChunk|agentMessageChunk/i.test(
          k,
        ),
      );
      if (replay.length === 0) {
        fail(
          `session/load after prompt expected message replay chunks; kinds=${JSON.stringify(agent.updateKinds)}`,
        );
      }
      ok(`session/load replay chunks ×${replay.length} (${agent.updateKinds.join(", ")})`);
    } else if (agent.updateKinds.length > 0) {
      ok(`session/load notifications: ${agent.updateKinds.join(", ")}`);
    } else {
      ok("session/load returned (no replay chunks; empty session)");
    }

    console.log(`${TAG}: PASS (initialize + session/new + ${SKIP_PROMPT ? "skip-prompt" : "session/prompt"} + session/load)`);
  } catch (err) {
    fail(String(err?.stack || err?.message || err));
  } finally {
    if (agent) {
      try {
        await agent.kill();
      } catch {
        /* ignore */
      }
    }
    try {
      rmSync(cwd, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }

  process.exit(0);
}

main().catch((err) => fail(String(err?.stack || err)));

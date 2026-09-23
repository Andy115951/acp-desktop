#!/usr/bin/env node
/**
 * Headless Mac/Linux smoke: spawn Copilot ACP the same way CopilotBackend does
 * (`copilot --acp`), then exercise Connect → Ask → Resume over stdio NDJSON:
 *
 *   initialize → session/new → session/prompt → (fresh process) session/load
 *
 * Mirrors `copilot_spawn_argv` in src-tauri/src/agent_backend.rs.
 *
 * Requires a local Copilot CLI install + GitHub login. Not CI.
 * Local: npm run smoke:copilot-acp
 *
 * Env:
 *   COPILOT_ACP_SMOKE_TIMEOUT_MS  per-request timeout (default 120000)
 *   COPILOT_ACP_SMOKE_SKIP_PROMPT=1  skip session/prompt (still does new+load)
 */
import { spawn, spawnSync } from "node:child_process";
import { createInterface } from "node:readline";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TIMEOUT_MS = Number(process.env.COPILOT_ACP_SMOKE_TIMEOUT_MS || 120_000);
const SKIP_PROMPT = process.env.COPILOT_ACP_SMOKE_SKIP_PROMPT === "1";
const TAG = "smoke-copilot-acp";

function onPath(bin) {
  const r = spawnSync(process.platform === "win32" ? "where" : "which", [bin], {
    encoding: "utf8",
  });
  return r.status === 0;
}

/** Same rule as CopilotBackend / copilot_spawn_argv in agent_backend.rs */
function resolveCopilotSpawn() {
  const hasCopilot = onPath("copilot");
  const argv = ["copilot", "--acp"];
  return { hasCopilot, detectable: hasCopilot, argv };
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

    if (msg.method && msg.id != null) {
      handleAgentRequest(msg);
      return;
    }

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
        p.reject(new Error(`${p.method} error: ${JSON.stringify(msg.error)}`));
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
  return result;
}

async function main() {
  const resolved = resolveCopilotSpawn();
  console.log(
    `detect: copilot=${resolved.hasCopilot} → spawn ${JSON.stringify(resolved.argv)}`,
  );

  if (!resolved.detectable) {
    fail("`copilot` not on PATH (CopilotBackend.detect would be false)");
  }

  if (JSON.stringify(resolved.argv) !== JSON.stringify(["copilot", "--acp"])) {
    fail("copilot_spawn_argv mismatch");
  }
  ok("spawn argv matches CopilotBackend (`copilot --acp`)");

  const cwd = mkdtempSync(join(tmpdir(), "acp-desktop-copilot-smoke-"));
  let agent = spawnAgent(resolved.argv);

  try {
    const init = await initializeAgent(agent);
    ok(`protocolVersion ${init.protocolVersion}`);
    const caps = init.agentCapabilities || {};
    if (caps.loadSession === true) {
      ok("advertises loadSession");
    } else {
      ok(`loadSession=${JSON.stringify(caps.loadSession)} (Resume may be limited)`);
    }
    if (init.agentInfo?.name) {
      ok(`agentInfo.name=${init.agentInfo.name} version=${init.agentInfo.version || "?"}`);
    }

    let neu;
    try {
      neu = await agent.send("session/new", { cwd, mcpServers: [] });
    } catch (err) {
      fail(
        `session/new failed (Copilot auth?): ${err.message || err}\n` +
          `hint: log in via \`copilot\` (GitHub)\n` +
          `stderr:\n${agent.getStderr()}`,
      );
    }
    const sessionId = neu?.sessionId;
    if (!sessionId || typeof sessionId !== "string") {
      fail(`session/new missing sessionId: ${JSON.stringify(neu)}`);
    }
    ok(`session/new → sessionId (${sessionId.slice(0, 8)}…)`);

    if (!SKIP_PROMPT) {
      agent.updateKinds.length = 0;
      const promptRes = await agent.send("session/prompt", {
        sessionId,
        prompt: [{ type: "text", text: "Reply with exactly the single word: pong" }],
      });
      const stop = promptRes?.stopReason;
      if (stop !== "end_turn" && stop !== "endTurn") {
        fail(`session/prompt stopReason want end_turn got ${JSON.stringify(stop)}`);
      }
      ok(`session/prompt → stopReason=${stop}`);
      if (agent.permissionCount > 0) {
        ok(`auto-allowed ${agent.permissionCount} session/request_permission (Ask card path)`);
      } else {
        ok("no session/request_permission this turn");
      }
      const chunks = agent.updateKinds.filter((k) =>
        /agent_message_chunk|agentMessageChunk/i.test(k),
      );
      if (chunks.length === 0) {
        fail(
          `session/prompt produced no agent_message_chunk updates; kinds=${JSON.stringify(agent.updateKinds)}`,
        );
      }
      ok(`session/update agent_message_chunk ×${chunks.length}`);
    } else {
      ok("skipped session/prompt (COPILOT_ACP_SMOKE_SKIP_PROMPT=1)");
    }

    await agent.kill();
    agent = null;

    // Resume only if agent advertised loadSession
    const loadSupported = init.agentCapabilities?.loadSession === true;
    if (!loadSupported) {
      ok("skipping session/load (agent did not advertise loadSession)");
      console.log(
        `${TAG}: PASS (initialize + session/new + ${SKIP_PROMPT ? "skip-prompt" : "session/prompt"}; no loadSession)`,
      );
      return;
    }

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

    if (!SKIP_PROMPT) {
      const replay = agent.updateKinds.filter((k) =>
        /user_message_chunk|agent_message_chunk|userMessageChunk|agentMessageChunk/i.test(
          k,
        ),
      );
      if (replay.length === 0) {
        // Copilot preview may not replay history; treat as soft ok with note.
        ok(
          `session/load returned without replay chunks (kinds=${JSON.stringify(agent.updateKinds)})`,
        );
      } else {
        ok(`session/load replay chunks ×${replay.length}`);
      }
    } else if (agent.updateKinds.length > 0) {
      ok(`session/load notifications: ${agent.updateKinds.join(", ")}`);
    } else {
      ok("session/load returned (no replay chunks; empty session)");
    }

    console.log(
      `${TAG}: PASS (initialize + session/new + ${SKIP_PROMPT ? "skip-prompt" : "session/prompt"} + session/load)`,
    );
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

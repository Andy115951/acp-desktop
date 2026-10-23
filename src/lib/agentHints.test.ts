import { describe, expect, it } from "vitest";
import {
  agentAuthHint,
  agentDetailHint,
  agentCodexNpxFallbackHint,
  agentNpxFallbackHint,
} from "./agentHints";

describe("agentDetailHint", () => {
  it.each([
    ["codex", "codex-acp"],
    ["claude", "claude-agent-acp"],
  ])("localizes the %s fallback note while preserving install commands", (id, adapter) => {
    const agent = { id, detailCode: "npx_fallback" as const, detail: "host note" };
    const english = agentDetailHint(agent, "en")!;
    const chinese = agentDetailHint(agent, "zh-CN")!;
    expect(english).toContain("Connect spawns via npx");
    expect(chinese).toContain("连接时通过 npx 启动");
    for (const hint of [english, chinese]) {
      expect(hint).toContain(`@agentclientprotocol/${adapter}`);
      expect(hint).toContain(`\`${adapter}\``);
      expect(hint).not.toMatch(/\{(?:cli|adapter)\}/);
    }
  });

  it("preserves uncategorized diagnostics instead of translating vendor text", () => {
    expect(agentDetailHint({ id: "codex", detail: "Vendor diagnostic: npx" }, "zh-CN"))
      .toBe("Vendor diagnostic: npx");
    expect(agentDetailHint({ id: "other", detailCode: "npx_fallback", detail: "Unknown adapter" }, "zh-CN"))
      .toBe("Unknown adapter");
    expect(agentDetailHint({ id: "grok" }, "zh-CN")).toBeNull();
  });
});

describe("agentAuthHint", () => {
  it("returns Codex auth/install note", () => {
    const hint = agentAuthHint("codex", false);
    expect(hint).toBeTruthy();
    expect(hint!).toMatch(/ChatGPT|CODEX_API_KEY|OPENAI_API_KEY/);
    expect(hint!).toMatch(/codex-acp|npx/);
  });

  it("returns Claude auth/install note", () => {
    const hint = agentAuthHint("claude", false);
    expect(hint).toBeTruthy();
    expect(hint!).toMatch(/ANTHROPIC_API_KEY|Pro\/Max|Claude Code/);
    expect(hint!).toMatch(/claude-agent-acp|npx/);
  });

  it("returns Copilot auth/install note", () => {
    const hint = agentAuthHint("copilot", false);
    expect(hint).toBeTruthy();
    expect(hint!).toMatch(/GitHub|copilot --acp|Copilot CLI/);
  });

  it("hides hint when fake agent is on", () => {
    expect(agentAuthHint("codex", true)).toBeNull();
    expect(agentAuthHint("claude", true)).toBeNull();
    expect(agentAuthHint("copilot", true)).toBeNull();
  });

  it("no hint for grok by default", () => {
    expect(agentAuthHint("grok", false)).toBeNull();
  });
});

describe("agentNpxFallbackHint", () => {
  it("echoes host detail when it mentions npx + codex", () => {
    const d =
      "codex on PATH; Connect spawns via npx (@agentclientprotocol/codex-acp).";
    expect(agentNpxFallbackHint(d)).toBe(d);
    expect(agentCodexNpxFallbackHint(d)).toBe(d);
  });

  it("echoes host detail when it mentions npx + claude", () => {
    const d =
      "claude on PATH; Connect spawns via npx (@agentclientprotocol/claude-agent-acp).";
    expect(agentNpxFallbackHint(d)).toBe(d);
  });

  it("returns null for empty / unrelated", () => {
    expect(agentNpxFallbackHint(null)).toBeNull();
    expect(agentNpxFallbackHint(undefined)).toBeNull();
    expect(agentNpxFallbackHint("something else")).toBeNull();
  });
});

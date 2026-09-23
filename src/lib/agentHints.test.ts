import { describe, expect, it } from "vitest";
import {
  agentAuthHint,
  agentCodexNpxFallbackHint,
  agentNpxFallbackHint,
} from "./agentHints";

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

  it("hides hint when fake agent is on", () => {
    expect(agentAuthHint("codex", true)).toBeNull();
    expect(agentAuthHint("claude", true)).toBeNull();
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

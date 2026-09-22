import { describe, expect, it } from "vitest";
import { agentAuthHint, agentCodexNpxFallbackHint } from "./agentHints";

describe("agentAuthHint", () => {
  it("returns Codex auth/install note", () => {
    const hint = agentAuthHint("codex", false);
    expect(hint).toBeTruthy();
    expect(hint!).toMatch(/ChatGPT|CODEX_API_KEY/);
    expect(hint!).toMatch(/codex-acp|npx/);
  });

  it("hides hint when fake agent is on", () => {
    expect(agentAuthHint("codex", true)).toBeNull();
  });

  it("no hint for grok by default", () => {
    expect(agentAuthHint("grok", false)).toBeNull();
  });
});

describe("agentCodexNpxFallbackHint", () => {
  it("echoes host detail when it mentions npx + codex", () => {
    const d =
      "codex on PATH; Connect spawns via npx (@agentclientprotocol/codex-acp).";
    expect(agentCodexNpxFallbackHint(d)).toBe(d);
  });

  it("returns null for empty / unrelated", () => {
    expect(agentCodexNpxFallbackHint(null)).toBeNull();
    expect(agentCodexNpxFallbackHint(undefined)).toBeNull();
    expect(agentCodexNpxFallbackHint("something else")).toBeNull();
  });
});


import { describe, expect, it } from "vitest";
import {
  canSelectAgentId,
  pickConnectableAgentId,
  resumeIdAfterAgentMayHaveFlipped,
  resumeIdForAgent,
  sessionPatchAfterAgentSwitch,
  shouldDisconnectOnAgentSwitch,
} from "./agentSwitch";
import type { SessionByCwd } from "./sessionPrefs";

const agents = [
  { id: "grok", connectable: true },
  { id: "codex", connectable: true },
  { id: "claude", connectable: true },
  { id: "copilot", connectable: true },
];

describe("shouldDisconnectOnAgentSwitch", () => {
  it("disconnects when connected or busy", () => {
    expect(shouldDisconnectOnAgentSwitch(true, false)).toBe(true);
    expect(shouldDisconnectOnAgentSwitch(false, true)).toBe(true);
    expect(shouldDisconnectOnAgentSwitch(true, true)).toBe(true);
  });

  it("skips disconnect when idle", () => {
    expect(shouldDisconnectOnAgentSwitch(false, false)).toBe(false);
  });
});

describe("sessionPatchAfterAgentSwitch", () => {
  it("clears transcript, live session, Ask, and errors", () => {
    const patch = sessionPatchAfterAgentSwitch("codex-sess-1");
    expect(patch.savedSessionId).toBe("codex-sess-1");
    expect(patch.sessionId).toBeNull();
    expect(patch.loadSessionSupported).toBeNull();
    expect(patch.lines).toEqual([]);
    expect(patch.error).toBeNull();
    expect(patch.permission).toBeNull();
  });

  it("allows null Resume when vendor has no saved id", () => {
    expect(sessionPatchAfterAgentSwitch(null).savedSessionId).toBeNull();
  });
});

describe("resumeIdForAgent — no cross-vendor bleed", () => {
  const cwd = "/work/proj";
  const maps: Record<string, SessionByCwd> = {
    "grok.sessionByCwd": { [cwd]: "grok-sess" },
    "codex.sessionByCwd": { [cwd]: "codex-sess" },
  };
  const getMap = (key: string) => maps[key];

  it("loads only that vendor’s Resume id for the same cwd", () => {
    expect(resumeIdForAgent("grok", cwd, getMap)).toBe("grok-sess");
    expect(resumeIdForAgent("codex", cwd, getMap)).toBe("codex-sess");
  });

  it("does not return the other vendor’s id", () => {
    expect(resumeIdForAgent("codex", cwd, getMap)).not.toBe("grok-sess");
    expect(resumeIdForAgent("grok", cwd, getMap)).not.toBe("codex-sess");
  });

  it("returns null when vendor map lacks this cwd", () => {
    expect(resumeIdForAgent("codex", "/other", getMap)).toBeNull();
  });

  it("empty maps / missing keys yield null (incl. fake+Codex with no prefs)", () => {
    const empty = (key: string) =>
      key === "codex.sessionByCwd" ? {} : undefined;
    expect(resumeIdForAgent("codex", cwd, empty)).toBeNull();
    expect(resumeIdForAgent("grok", cwd, () => null)).toBeNull();
    expect(resumeIdForAgent("grok", cwd, () => undefined)).toBeNull();
  });

  it("grok and codex never share a map even when only grok has an entry", () => {
    const grokOnly: Record<string, SessionByCwd> = {
      "grok.sessionByCwd": { [cwd]: "legacy-grok" },
    };
    const get = (key: string) => grokOnly[key];
    expect(resumeIdForAgent("grok", cwd, get)).toBe("legacy-grok");
    expect(resumeIdForAgent("codex", cwd, get)).toBeNull();
  });

  it("claude Resume stays isolated from grok/codex maps", () => {
    const maps: Record<string, SessionByCwd> = {
      "grok.sessionByCwd": { [cwd]: "grok-sess" },
      "codex.sessionByCwd": { [cwd]: "codex-sess" },
      "claude.sessionByCwd": { [cwd]: "claude-sess" },
    };
    const get = (key: string) => maps[key];
    expect(resumeIdForAgent("claude", cwd, get)).toBe("claude-sess");
    expect(resumeIdForAgent("claude", cwd, get)).not.toBe("grok-sess");
    expect(resumeIdForAgent("claude", cwd, get)).not.toBe("codex-sess");
    expect(resumeIdForAgent("grok", cwd, get)).not.toBe("claude-sess");
  });

  it("copilot Resume stays isolated from other vendor maps", () => {
    const maps: Record<string, SessionByCwd> = {
      "grok.sessionByCwd": { [cwd]: "grok-sess" },
      "codex.sessionByCwd": { [cwd]: "codex-sess" },
      "claude.sessionByCwd": { [cwd]: "claude-sess" },
      "copilot.sessionByCwd": { [cwd]: "copilot-sess" },
    };
    const get = (key: string) => maps[key];
    expect(resumeIdForAgent("copilot", cwd, get)).toBe("copilot-sess");
    expect(resumeIdForAgent("copilot", cwd, get)).not.toBe("grok-sess");
    expect(resumeIdForAgent("copilot", cwd, get)).not.toBe("claude-sess");
    expect(resumeIdForAgent("claude", cwd, get)).not.toBe("copilot-sess");
  });
});

describe("resumeIdAfterAgentMayHaveFlipped (hydrate vs detect race)", () => {
  it("keeps loaded id when agent unchanged", () => {
    expect(
      resumeIdAfterAgentMayHaveFlipped("codex", "codex", "codex-sess"),
    ).toEqual({ stale: false, savedSessionId: "codex-sess" });
    expect(resumeIdAfterAgentMayHaveFlipped("grok", "grok", null)).toEqual({
      stale: false,
      savedSessionId: null,
    });
  });

  it("marks stale and drops id when detect flipped selected agent", () => {
    // Launch default grok → detect restores selectedAgentId=codex mid-hydrate.
    expect(
      resumeIdAfterAgentMayHaveFlipped("grok", "codex", "grok-sess"),
    ).toEqual({ stale: true, savedSessionId: null });
  });
});

describe("pickConnectableAgentId (selectedAgentId hydrate)", () => {
  it("keeps saved connectable id", () => {
    expect(pickConnectableAgentId(agents, "codex")).toBe("codex");
  });

  it("keeps saved claude id when connectable", () => {
    expect(pickConnectableAgentId(agents, "claude")).toBe("claude");
  });

  it("keeps saved copilot id when connectable", () => {
    expect(pickConnectableAgentId(agents, "copilot")).toBe("copilot");
  });

  it("falls back when saved id is not connectable", () => {
    expect(
      pickConnectableAgentId(
        [
          { id: "grok", connectable: true },
          { id: "placeholder", connectable: false },
        ],
        "placeholder",
      ),
    ).toBe("grok");
  });

  it("falls back when saved id is unknown", () => {
    expect(pickConnectableAgentId(agents, "missing")).toBe("grok");
  });

  it("uses default grok when preferred empty", () => {
    expect(pickConnectableAgentId(agents, null)).toBe("grok");
    expect(pickConnectableAgentId(agents, "  ")).toBe("grok");
  });

  it("returns fallback when no agents are connectable", () => {
    expect(
      pickConnectableAgentId(
        [{ id: "placeholder", connectable: false }],
        "placeholder",
      ),
    ).toBe("grok");
  });
});

describe("canSelectAgentId (persist gate)", () => {
  it("allows connectable agents", () => {
    expect(canSelectAgentId(agents, "grok")).toBe(true);
    expect(canSelectAgentId(agents, "codex")).toBe(true);
    expect(canSelectAgentId(agents, "claude")).toBe(true);
    expect(canSelectAgentId(agents, "copilot")).toBe(true);
  });

  it("blocks non-connectable placeholders", () => {
    expect(
      canSelectAgentId([{ id: "placeholder", connectable: false }], "placeholder"),
    ).toBe(false);
  });

  it("allows unknown id when list empty or id absent", () => {
    expect(canSelectAgentId([], "codex")).toBe(true);
    expect(canSelectAgentId(agents, "future")).toBe(true);
  });
});

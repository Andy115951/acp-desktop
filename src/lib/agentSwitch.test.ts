import { describe, expect, it } from "vitest";
import {
  canSelectAgentId,
  pickConnectableAgentId,
  resumeIdForAgent,
  sessionPatchAfterAgentSwitch,
  shouldDisconnectOnAgentSwitch,
} from "./agentSwitch";
import type { SessionByCwd } from "./sessionPrefs";

const agents = [
  { id: "grok", connectable: true },
  { id: "codex", connectable: true },
  { id: "claude", connectable: false },
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

  it("grok reads grok.sessionByCwd; codex never reads the grok map", () => {
    const legacyOnly: Record<string, SessionByCwd> = {
      "grok.sessionByCwd": { [cwd]: "legacy-grok" },
    };
    const get = (key: string) => legacyOnly[key];
    expect(resumeIdForAgent("grok", cwd, get)).toBe("legacy-grok");
    expect(resumeIdForAgent("codex", cwd, get)).toBeNull();
  });
});

describe("pickConnectableAgentId (selectedAgentId hydrate)", () => {
  it("keeps saved connectable id", () => {
    expect(pickConnectableAgentId(agents, "codex")).toBe("codex");
  });

  it("falls back when saved id is not connectable", () => {
    expect(pickConnectableAgentId(agents, "claude")).toBe("grok");
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
      pickConnectableAgentId([{ id: "claude", connectable: false }], "claude"),
    ).toBe("grok");
  });
});

describe("canSelectAgentId (persist gate)", () => {
  it("allows connectable agents", () => {
    expect(canSelectAgentId(agents, "grok")).toBe(true);
    expect(canSelectAgentId(agents, "codex")).toBe(true);
  });

  it("blocks non-connectable placeholders", () => {
    expect(canSelectAgentId(agents, "claude")).toBe(false);
  });

  it("allows unknown id when list empty or id absent", () => {
    expect(canSelectAgentId([], "codex")).toBe(true);
    expect(canSelectAgentId(agents, "future")).toBe(true);
  });
});

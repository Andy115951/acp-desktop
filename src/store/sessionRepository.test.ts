import { beforeEach, describe, expect, it, vi } from "vitest";
const prefs = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn(), save: vi.fn() }));
vi.mock("@tauri-apps/plugin-store", () => ({ Store: { load: vi.fn(async () => prefs) } }));
import { loadSessionCatalog, markSessionUnavailable, saveKnownSession } from "./sessionRepository";

let data: Map<string, unknown>;
beforeEach(() => {
  data = new Map();
  prefs.get.mockImplementation(async (key) => structuredClone(data.get(key)));
  prefs.set.mockImplementation(async (key, value) => { data.set(key, structuredClone(value)); });
  prefs.save.mockReset().mockResolvedValue(undefined);
});

describe("serialized session persistence", () => {
  it("does not lose sessions when statuses arrive during legacy migration", async () => {
    data.set("codex.sessionByCwd", { "/workspace": "legacy" });
    await Promise.all([
      saveKnownSession("codex", "/workspace", "new-one"),
      saveKnownSession("codex", "/workspace", "new-two"),
      loadSessionCatalog("codex"),
    ]);
    expect((await loadSessionCatalog("codex")).sessions.map((entry) => entry.sessionId).sort()).toEqual(["legacy", "new-one", "new-two"]);
    expect(data.get("codex.sessionByCwd")).toEqual({ "/workspace": "legacy" });
  });
  it("keeps vendor IDs separate and never resurrects stale legacy entries", async () => {
    data.set("codex.sessionByCwd", { "/same": "old-codex" });
    data.set("copilot.sessionByCwd", { "/same": "old-copilot" });
    await Promise.all([loadSessionCatalog("codex"), loadSessionCatalog("copilot")]);
    await markSessionUnavailable("codex", "/same", "old-codex");
    expect((await loadSessionCatalog("codex")).sessions[0].unavailable).toBe(true);
    expect((await loadSessionCatalog("copilot")).sessions[0].sessionId).toBe("old-copilot");
  });
  it("continues after a failed disk save and exposes the failure to the caller", async () => {
    prefs.save.mockRejectedValueOnce(new Error("disk full"));
    await expect(saveKnownSession("codex", "/one", "one")).rejects.toThrow("disk full");
    await saveKnownSession("codex", "/one", "two");
    expect((await loadSessionCatalog("codex")).sessions[0].sessionId).toBe("two");
  });
  it("does not overwrite newer or damaged catalogs", async () => {
    const future = { version: 2, sessions: ["future metadata"] };
    data.set("codex.sessions.v1", future);
    await expect(saveKnownSession("codex", "/one", "one")).rejects.toThrow();
    expect(data.get("codex.sessions.v1")).toEqual(future);
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
const prefs = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn(), save: vi.fn() }));
vi.mock("@tauri-apps/plugin-store", () => ({ Store: { load: vi.fn(async () => prefs) } }));
import { editKnownSession, loadSessionCatalog, loadWorkspaceHistory, markSessionUnavailable, saveKnownSession, saveWorkspaceVisit } from "./sessionRepository";

let data: Map<string, unknown>;
beforeEach(() => {
  data = new Map();
  prefs.get.mockImplementation(async (key) => structuredClone(data.get(key)));
  prefs.set.mockImplementation(async (key, value) => { data.set(key, structuredClone(value)); });
  prefs.save.mockReset().mockResolvedValue(undefined);
});

describe("workspace visits and explicit metadata edits", () => {
  it("serializes visits without losing either workspace or the legacy folder", async () => {
    data.set("lastCwd", "/legacy");
    await Promise.all([saveWorkspaceVisit("/first"), saveWorkspaceVisit("/second")]);
    expect((await loadWorkspaceHistory()).workspaces.map((entry) => entry.cwd)).toEqual(["/second", "/first", "/legacy"]);
    expect(data.get("lastCwd")).toBe("/second");
  });
  it("retains names and archive state after subsequent successful session statuses", async () => {
    await saveKnownSession("codex", "/one", "one");
    await editKnownSession("codex", "/one", "one", { title: "Named session" });
    await editKnownSession("codex", "/one", "one", { archivedAt: 4 });
    await saveKnownSession("codex", "/one", "one");
    expect((await loadSessionCatalog("codex")).sessions[0]).toMatchObject({ title: "Named session", archivedAt: 4 });
  });
  it("rolls back an explicit archive in the shared store if disk save fails", async () => {
    await saveKnownSession("codex", "/one", "one");
    prefs.save.mockRejectedValueOnce(new Error("disk full"));
    await expect(editKnownSession("codex", "/one", "one", { archivedAt: 5 })).rejects.toThrow();
    expect((await loadSessionCatalog("codex")).sessions[0].archivedAt).toBeUndefined();
  });
  it("rolls back both workspace keys if a visit cannot be saved", async () => {
    await saveWorkspaceVisit("/first");
    const previous = structuredClone(data.get("recentWorkspaces.v1"));
    prefs.save.mockRejectedValueOnce(new Error("disk full"));
    await expect(saveWorkspaceVisit("/second")).rejects.toThrow();
    expect(data.get("lastCwd")).toBe("/first");
    expect(data.get("recentWorkspaces.v1")).toEqual(previous);
  });
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

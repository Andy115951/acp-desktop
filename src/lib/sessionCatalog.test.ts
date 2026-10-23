import { describe, expect, it } from "vitest";
import { editSession, invalidateSession, readSessionCatalog, rememberSession, sessionCatalogKey, sessionsForWorkspace, validSessionTitle } from "./sessionCatalog";

describe("session catalog migration and isolation", () => {
  it("migrates every valid legacy workspace without inventing titles or timestamps", () => {
    const catalog = readSessionCatalog(null, { "/one": "s1", "/two": "s2", relative: "bad", "/empty": "", "/bad": 1 });
    expect(catalog.sessions).toEqual([
      { cwd: "/one", sessionId: "s1", title: null, createdAt: 0, updatedAt: 0, unavailable: false },
      { cwd: "/two", sessionId: "s2", title: null, createdAt: 0, updatedAt: 0, unavailable: false },
    ]);
  });
  it("retains multiple conversations and their creation times in the same workspace", () => {
    let catalog = readSessionCatalog(null, {});
    catalog = rememberSession(catalog, "/one", "first", 10);
    catalog = rememberSession(catalog, "/one", "second", 20);
    catalog = rememberSession(catalog, "/two", "first", 30);
    catalog = rememberSession(catalog, "/one", "first", 40);
    expect(sessionsForWorkspace(catalog, "/one").map((entry) => entry.sessionId)).toEqual(["first", "second"]);
    expect(catalog.sessions[0].createdAt).toBe(10);
    expect(sessionsForWorkspace(catalog, "/two")).toHaveLength(1);
  });
  it("invalidates only the failed ID and does not reimport it from the old map", () => {
    let catalog = rememberSession(readSessionCatalog(null, { "/one": "old" }), "/one", "good", 1);
    catalog = invalidateSession(catalog, "/one", "old");
    catalog = readSessionCatalog(JSON.parse(JSON.stringify(catalog)), { "/one": "old", "/other": "obsolete" });
    expect(sessionsForWorkspace(catalog, "/one").map((entry) => entry.sessionId)).toEqual(["good"]);
    expect(catalog.sessions.find((entry) => entry.sessionId === "old")?.unavailable).toBe(true);
    expect(catalog.sessions).toHaveLength(2);
  });
  it("recovers an unavailable ID after a successful agent connection", () => {
    const catalog = invalidateSession(readSessionCatalog(null, { "/one": "old" }), "/one", "old");
    expect(sessionsForWorkspace(rememberSession(catalog, "/one", "old", 9), "/one")).toHaveLength(1);
  });
  it("rejects unknown schemas rather than silently replacing them", () => {
    for (const value of [false, "broken", [], { version: 2, sessions: [] }, { version: 1 }]) {
      expect(() => readSessionCatalog(value, {})).toThrow();
    }
  });
  it("filters malformed entries and excludes transcript fields from metadata", () => {
    const entry = readSessionCatalog(null, { "/one": "id" }).sessions[0];
    const catalog = readSessionCatalog({ version: 1, sessions: [null, 4, { ...entry, cwd: "relative" }, { ...entry, updatedAt: "now" }, { ...entry, transcript: "private text" }, entry] }, {});
    expect(catalog.sessions).toEqual([entry]);
    expect(JSON.stringify(catalog)).not.toContain("private text");
  });
  it("uses separate namespaces even for identical folders and IDs across agents", () => {
    expect(sessionCatalogKey("codex")).not.toBe(sessionCatalogKey("copilot"));
    expect(sessionCatalogKey("my-custom-agent")).toBe("my-custom-agent.sessions.v1");
  });
});

describe("session names and archive tombstones", () => {
  const initial = rememberSession(readSessionCatalog(null, { "/one": "first" }), "/one", "second", 10);
  it("renames only the requested entry without changing its last-used time", () => {
    const renamed = editSession(initial, "/one", "first", { title: "  中文 title  " });
    expect(renamed.sessions.find((entry) => entry.sessionId === "first")).toMatchObject({ title: "中文 title", updatedAt: 0 });
    expect(initial.sessions.find((entry) => entry.sessionId === "first")?.title).toBeNull();
  });
  it("keeps archived IDs hidden across persistence, legacy migration and later agent statuses", () => {
    const archived = editSession(initial, "/one", "first", { archivedAt: 0 });
    const reloaded = readSessionCatalog(JSON.parse(JSON.stringify(archived)), { "/one": "first" });
    const remembered = rememberSession(reloaded, "/one", "first", 20);
    expect(sessionsForWorkspace(remembered, "/one").map((entry) => entry.sessionId)).toEqual(["second"]);
    const restored = editSession(remembered, "/one", "first", { archivedAt: null });
    expect(sessionsForWorkspace(restored, "/one").map((entry) => entry.sessionId)).toEqual(["first", "second"]);
  });
  it("does not revive an unavailable ID when restoring an archive", () => {
    const archived = editSession(invalidateSession(initial, "/one", "first"), "/one", "first", { archivedAt: 20 });
    expect(sessionsForWorkspace(editSession(archived, "/one", "first", { archivedAt: null }), "/one")).toHaveLength(1);
  });
  it("validates titles and rejects unknown entry edits", () => {
    for (const title of ["", "   ", "line\nbreak", "bad\0title", "a".repeat(121)]) expect(validSessionTitle(title)).toBe(false);
    expect(validSessionTitle("a".repeat(120))).toBe(true);
    expect(() => editSession(initial, "/wrong", "first", { title: "ok" })).toThrow();
    expect(() => editSession(initial, "/one", "first", { title: " " })).toThrow();
  });
});

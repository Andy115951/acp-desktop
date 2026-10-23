import { describe, expect, it } from "vitest";
import { invalidateSession, readSessionCatalog, rememberSession, sessionCatalogKey, sessionsForWorkspace } from "./sessionCatalog";

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

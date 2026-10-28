import { describe, expect, it } from "vitest";
import { searchSavedSessions, sessionDisplayTitle } from "./sessionSearch";
import type { SessionCatalog } from "./sessionCatalog";

const entry = (sessionId: string, title: string | null, updatedAt = 1) => ({
  sessionId, title, cwd: "/workspace", updatedAt, createdAt: 0, unavailable: false,
});
const catalog: SessionCatalog = { version: 1, sessions: [
  entry("uuid-alpha", "Review   release", 3),
  entry("uuid-beta", "中文 对话", 2),
  entry("Literal.[id]", null),
  { ...entry("archived", "Review archived"), archivedAt: 1 },
  { ...entry("expired", "Review expired"), unavailable: true },
  { ...entry("foreign", "Review foreign"), cwd: "/other" },
] };
const ids = (query: string, cwd: string | null = "/workspace") => searchSavedSessions(catalog, cwd, query).matches.map(entry => entry.sessionId);

describe("scoped local conversation search", () => {
  it("matches case-insensitive titles and IDs with trimmed/collapsed whitespace", () => {
    expect(ids("  REVIEW release  ")).toEqual(["uuid-alpha"]);
    expect(ids("  UUID-BeTa ")).toEqual(["uuid-beta"]);
    expect(ids("中文\t对话")).toEqual(["uuid-beta"]);
  });
  it("treats punctuation as literal text and supports untitled IDs", () => {
    expect(ids(".[ID]")).toEqual(["Literal.[id]"]);
    expect(ids(".*")).toEqual([]);
  });
  it("keeps only available/unarchived entries for the selected workspace", () => {
    expect(ids("review")).toEqual(["uuid-alpha"]);
    expect(ids("review", "/other")).toEqual(["foreign"]);
    expect(ids("", null)).toEqual([]);
    expect(ids("", "/empty")).toEqual([]);
  });
  it("uses the full scoped total, retains recent order and does not mutate metadata", () => {
    const before = JSON.stringify(catalog);
    const result = searchSavedSessions(catalog, "/workspace", "review");
    expect(result.entries).toHaveLength(3);
    expect(result.matches).toHaveLength(1);
    expect(result.filtering).toBe(true);
    expect(ids(" \n\t ")).toEqual(["uuid-alpha", "uuid-beta", "Literal.[id]"]);
    expect(searchSavedSessions(catalog, "/workspace", " \n").filtering).toBe(false);
    expect(JSON.stringify(catalog)).toBe(before);
  });
  it("updates matching metadata when discovery or a local name changes", () => {
    const next = { ...catalog, sessions: [...catalog.sessions, entry("new", "Review discovered", 9)] };
    expect(searchSavedSessions(next, "/workspace", "review").matches.map(entry => entry.sessionId)).toEqual(["new", "uuid-alpha"]);
  });
});

describe("conversation heading identity", () => {
  it("keeps a named conversation's title and a full ID for an untitled one", () => {
    expect(sessionDisplayTitle("full-vendor-uuid", "  My conversation  ")).toBe("My conversation");
    for (const title of [undefined, null, "", "   "]) expect(sessionDisplayTitle("full-vendor-uuid", title)).toBe("full-vendor-uuid");
  });
});

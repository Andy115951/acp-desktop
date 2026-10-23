import { isPlausibleCwd } from "./sessionPrefs";

/** Metadata only: transcripts and tool results remain in vendor storage. */
export type SessionEntry = {
  cwd: string;
  sessionId: string;
  title: string | null;
  createdAt: number;
  updatedAt: number;
  unavailable: boolean;
  archivedAt?: number | null;
};

export type SessionCatalog = { version: 1; sessions: SessionEntry[] };

/** The containing key supplies the agent identity, including for custom agents. */
export function sessionCatalogKey(agentId: string): string {
  return `${agentId.trim() || "grok"}.sessions.v1`;
}

const validId = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;
const validTime = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;

/** Import the old map only when no catalog exists. Never resurrect a stale entry. */
export function readSessionCatalog(value: unknown, legacy: unknown): SessionCatalog {
  if (value == null) {
    const sessions: SessionEntry[] = [];
    if (legacy && typeof legacy === "object" && !Array.isArray(legacy)) {
      for (const [cwd, sessionId] of Object.entries(legacy)) {
        if (isPlausibleCwd(cwd) && validId(sessionId)) {
          sessions.push({ cwd, sessionId, title: null, createdAt: 0, updatedAt: 0, unavailable: false });
        }
      }
    }
    return { version: 1, sessions };
  }
  // Do not overwrite a newer schema or silently erase unreadable metadata.
  if (typeof value !== "object" || !("version" in value) || value.version !== 1 ||
      !("sessions" in value) || !Array.isArray(value.sessions)) {
    throw new Error("Unsupported or damaged session catalog");
  }
  const sessions: SessionEntry[] = [];
  for (const item of value.sessions) {
    if (!item || !isPlausibleCwd(item.cwd) || !validId(item.sessionId) ||
        !validTime(item.createdAt) || !validTime(item.updatedAt) ||
        !(item.title === null || typeof item.title === "string") ||
        (item.archivedAt != null && !validTime(item.archivedAt)) ||
        typeof item.unavailable !== "boolean") continue;
    if (sessions.some((entry) => entry.cwd === item.cwd && entry.sessionId === item.sessionId)) continue;
    sessions.push({ cwd: item.cwd, sessionId: item.sessionId, title: item.title,
      createdAt: item.createdAt, updatedAt: item.updatedAt, unavailable: item.unavailable,
      ...(validTime(item.archivedAt) ? { archivedAt: item.archivedAt } : {}) });
  }
  return { version: 1, sessions };
}

export function sessionsForWorkspace(catalog: SessionCatalog, cwd: string): SessionEntry[] {
  return catalog.sessions.filter((entry) => entry.cwd === cwd && !entry.unavailable && entry.archivedAt == null)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export function rememberSession(catalog: SessionCatalog, cwd: string, sessionId: string, now: number): SessionCatalog {
  const old = catalog.sessions.find((entry) => entry.cwd === cwd && entry.sessionId === sessionId);
  const entry: SessionEntry = old ? { ...old, updatedAt: now, unavailable: false }
    : { cwd, sessionId, title: null, createdAt: now, updatedAt: now, unavailable: false };
  return { version: 1, sessions: [entry, ...catalog.sessions.filter((item) => item !== old)] };
}

/** A failed Resume invalidates that ID only, preserving the other conversations. */
export function invalidateSession(catalog: SessionCatalog, cwd: string, sessionId: string): SessionCatalog {
  return { version: 1, sessions: catalog.sessions.map((entry) =>
    entry.cwd === cwd && entry.sessionId === sessionId ? { ...entry, unavailable: true } : entry) };
}

export const SESSION_TITLE_LIMIT = 120;

export function validSessionTitle(title: string): boolean {
  return title.trim().length > 0 && title.trim().length <= SESSION_TITLE_LIMIT && !/[\x00-\x1f]/.test(title);
}

/** Metadata edits never change last-used time or revive an unavailable ID. */
export function editSession(catalog: SessionCatalog, cwd: string, sessionId: string,
  change: { title: string } | { archivedAt: number | null }): SessionCatalog {
  if (!catalog.sessions.some((entry) => entry.cwd === cwd && entry.sessionId === sessionId)) {
    throw new Error("Unknown app session");
  }
  if ("title" in change && !validSessionTitle(change.title)) throw new Error("Invalid session title");
  const patch = "title" in change ? { title: change.title.trim() } : change;
  return { version: 1, sessions: catalog.sessions.map((entry) =>
    entry.cwd === cwd && entry.sessionId === sessionId ? { ...entry, ...patch } : entry) };
}

export type DiscoveredSession = { sessionId: string; cwd: string; title?: string | null; updatedAt?: string | null };

/** Listing supplements metadata; local names, archives and stale-ID decisions win. */
export function mergeDiscoveredSessions(catalog: SessionCatalog, cwd: string, entries: DiscoveredSession[]): SessionCatalog {
  const sessions = [...catalog.sessions];
  for (const entry of entries) {
    if (entry.cwd !== cwd || !isPlausibleCwd(entry.cwd) || !validId(entry.sessionId)) continue;
    const index = sessions.findIndex((item) => item.cwd === cwd && item.sessionId === entry.sessionId);
    const parsed = typeof entry.updatedAt === "string" ? Date.parse(entry.updatedAt) : NaN;
    const updatedAt = Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
    const title = typeof entry.title === "string" && validSessionTitle(entry.title) ? entry.title.trim() : null;
    if (index < 0) {
      sessions.push({ cwd, sessionId: entry.sessionId, title, createdAt: 0, updatedAt, unavailable: false });
    } else {
      const old = sessions[index];
      sessions[index] = { ...old, title: old.title ?? title, updatedAt: Math.max(old.updatedAt, updatedAt) };
    }
  }
  return { version: 1, sessions };
}

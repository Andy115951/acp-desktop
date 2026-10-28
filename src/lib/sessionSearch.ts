import { sessionsForWorkspace, type SessionCatalog } from "./sessionCatalog";

const normalized = (text: string) => text.trim().replace(/\s+/gu, " ").toLowerCase();

/** Local metadata search; never loads transcripts or changes selection. */
export function searchSavedSessions(catalog: SessionCatalog, cwd: string | null, query: string) {
  const entries = cwd ? sessionsForWorkspace(catalog, cwd) : [];
  const needle = normalized(query);
  return {
    entries,
    filtering: !!needle,
    matches: needle ? entries.filter(entry =>
      [entry.title ?? "", entry.sessionId].some(value => normalized(value).includes(needle))) : entries,
  };
}

/** Untitled saved/live conversations retain their full vendor identity. */
export function sessionDisplayTitle(sessionId: string, title?: string | null): string {
  return title?.trim() || sessionId;
}

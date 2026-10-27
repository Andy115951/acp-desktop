/** Unsent text is scoped to an in-memory conversation identity, never persisted. */
export type DraftTarget = { agentId: string; cwd: string | null; sessionId: string | null };
export type ConversationDrafts = Record<string, string>;
const key = (target: DraftTarget) => JSON.stringify([target.agentId, target.cwd, target.sessionId]);
export function rememberDraft(drafts: ConversationDrafts, target: DraftTarget, text: string): ConversationDrafts {
  const next = { ...drafts, [JSON.stringify([target.agentId, target.cwd])]: JSON.stringify(target.sessionId) };
  if (text) next[key(target)] = text;
  else delete next[key(target)];
  return next;
}
export function readDraft(drafts: ConversationDrafts, target: DraftTarget): string {
  return drafts[key(target)] ?? "";
}
export function bindDraft(drafts: ConversationDrafts, previous: DraftTarget, ready: DraftTarget, text: string): ConversationDrafts {
  // A local New draft becomes the created vendor conversation; it must not
  // reappear as an unsent New draft after the first message is sent.
  const next = rememberDraft(drafts, previous, previous.sessionId === null ? "" : text);
  return rememberDraft(next, ready, text);
}

/** Last selected target per agent/workspace, also held only in memory. */
export function lastConversation(drafts: ConversationDrafts, agentId: string, cwd: string | null, fallback: string | null, available: string[]): string | null {
  const value = drafts[JSON.stringify([agentId, cwd])];
  if (value === undefined) return fallback;
  try {
    const selected: unknown = JSON.parse(value);
    return selected === null ? null : typeof selected === "string" && available.includes(selected) ? selected : fallback;
  } catch { return fallback; }
}

export type AgentCommand = { name: string; description: string; inputHint: string | null };
export type ContextUsage = { used: string; size: string };
export type SessionMetadata = {
  agentId: string; cwd: string; sessionId: string;
  commands?: AgentCommand[]; usage?: ContextUsage;
};

/** Replace reported fields; an absent field retains the other report for this session. */
export function mergeSessionMetadata(previous: SessionMetadata | null, update: SessionMetadata): SessionMetadata {
  const same = previous?.agentId === update.agentId && previous.cwd === update.cwd && previous.sessionId === update.sessionId;
  return { ...(same ? previous : {}), ...update };
}

export type ToolContent =
  | { type: "content"; content: { type: string; text?: string } }
  | { type: "diff"; path: string; oldText?: string | null; newText: string }
  | { type: "terminal"; terminalId: string };

export type ToolData = {
  id: string;
  title?: string;
  kind?: string;
  status?: string;
  rawInput?: unknown;
  rawOutput?: unknown;
  content?: ToolContent[];
  locations?: { path: string; line?: number | null }[];
  decision?: "allowed" | "rejected" | "cancelled";
};

export type StreamLine = {
  id: string;
  kind: string;
  text: string;
  /** Only the last open chunk may receive continuation text. */
  streaming?: boolean;
  tool?: ToolData;
};

const chunkKinds = new Set(["agent_message", "agent_thought", "user_message"]);

/** Close a chunk at a permission, disconnect or other non-text boundary. */
export function sealTranscript(lines: StreamLine[]): StreamLine[] {
  const last = lines[lines.length - 1];
  return last?.streaming
    ? [...lines.slice(0, -1), { ...last, streaming: false }]
    : lines;
}

/** ACP text chunks are continuations, not individual chat messages. */
export function appendStreamLine(lines: StreamLine[], next: StreamLine): StreamLine[] {
  if (next.tool) {
    const sealed = sealTranscript(lines);
    // Null/absent fields in ACP updates leave previous fields unchanged;
    // supplied collections replace the old collection, including empty arrays.
    const patch = Object.fromEntries(Object.entries(next.tool).filter(([, value]) => value != null)) as ToolData;
    for (let i = sealed.length - 1; i >= 0; i--) {
      const previous = sealed[i];
      if (["user", "user_message", "stop"].includes(previous.kind)) break;
      if (previous.tool?.id === patch.id) {
        const tool = { ...previous.tool, ...patch };
        return sealed.map((line, index) => index === i ? { ...line, text: tool.title ?? line.text, tool } : line);
      }
    }
    return [...sealed, { ...next, kind: "tool_call", tool: patch, streaming: false }];
  }
  const last = lines[lines.length - 1];
  const isChunk = chunkKinds.has(next.kind);
  if (isChunk && last?.streaming && last.kind === next.kind) {
    return [...lines.slice(0, -1), { ...last, text: last.text + next.text }];
  }
  return [...sealTranscript(lines), { ...next, streaming: isChunk }];
}

/** Record the user's permission decision even if no vendor update follows. */
export function recordToolDecision(lines: StreamLine[], id: string | undefined, decision: ToolData["decision"]): StreamLine[] {
  if (!id) return sealTranscript(lines);
  const next = sealTranscript(lines);
  for (let i = next.length - 1; i >= 0; i--) {
    if (next[i].tool?.id === id) {
      return next.map((line, index) => index === i ? { ...line, tool: { ...line.tool!, decision } } : line);
    }
  }
  return next;
}

export function isNearTranscriptBottom(scrollTop: number, scrollHeight: number, clientHeight: number): boolean {
  return scrollHeight - clientHeight - scrollTop <= 40;
}

export function followsAfterScroll(wasFollowing: boolean, previousTop: number, scrollTop: number, scrollHeight: number, clientHeight: number): boolean {
  if (isNearTranscriptBottom(scrollTop, scrollHeight, clientHeight)) return true;
  // Growing/deferred Markdown can increase the gap without a user scroll.
  // Only moving upward should disengage an existing follow position.
  return scrollTop < previousTop - 1 ? false : wasFollowing;
}

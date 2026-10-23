export type StreamLine = {
  id: string;
  kind: string;
  text: string;
  /** Only the last open chunk may receive continuation text. */
  streaming?: boolean;
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
  const last = lines[lines.length - 1];
  const isChunk = chunkKinds.has(next.kind);
  if (isChunk && last?.streaming && last.kind === next.kind) {
    return [...lines.slice(0, -1), { ...last, text: last.text + next.text }];
  }
  return [...sealTranscript(lines), { ...next, streaming: isChunk }];
}

export function isNearTranscriptBottom(scrollTop: number, scrollHeight: number, clientHeight: number): boolean {
  return scrollHeight - clientHeight - scrollTop <= 40;
}

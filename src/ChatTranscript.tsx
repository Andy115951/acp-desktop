import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { isNearTranscriptBottom, type StreamLine } from "./lib/transcript";
import { t, type Locale, type MessageKey } from "./lib/i18n";

function lineLabel(kind: string): MessageKey {
  if (kind === "user" || kind === "user_message") return "chat.you";
  if (kind === "agent_message") return "chat.agent";
  if (kind === "agent_thought") return "chat.thinking";
  if (kind === "tool_call" || kind === "tool_call_update") return "chat.tool";
  if (kind === "plan") return "chat.plan";
  return "chat.status";
}

function lineText(line: StreamLine, locale: Locale): string {
  if (line.kind === "status") {
    if (line.text === "New session…") return t(locale, "chat.newSession");
    if (line.text === "Resuming session…") return t(locale, "chat.resuming");
    if (line.text === "Resume: session loaded") return t(locale, "chat.resumed");
  }
  if (line.kind === "stop") return t(locale, "chat.turnEnded", { reason: line.text.replace(/^stop: /, "") });
  return line.text;
}

export function ChatTranscript({ lines, locale, resetKey, children }: {
  lines: StreamLine[];
  locale: Locale;
  resetKey: string;
  children?: ReactNode;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const followingRef = useRef(true);
  const [following, setFollowing] = useState(true);

  useLayoutEffect(() => {
    followingRef.current = true;
    setFollowing(true);
  }, [resetKey]);

  useLayoutEffect(() => {
    if (lines.length === 0) {
      followingRef.current = true;
      setFollowing(true);
    }
    if (followingRef.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [lines, children, resetKey]);

  return (
    <div className="relative">
      <div
        ref={scrollRef}
        role="log"
        aria-label={t(locale, "chat.transcript")}
        aria-live="off"
        tabIndex={0}
        onScroll={(event) => {
          const el = event.currentTarget;
          followingRef.current = isNearTranscriptBottom(el.scrollTop, el.scrollHeight, el.clientHeight);
          setFollowing(followingRef.current);
        }}
        className="h-[min(55vh,36rem)] min-h-72 overflow-y-auto overscroll-contain rounded-lg border border-slate-800 bg-black/20 p-4 space-y-4 [overflow-anchor:none]"
      >
        {lines.length === 0 && !children ? (
          <p className="text-sm text-slate-500">{t(locale, "session.transcriptEmpty")}</p>
        ) : lines.map((line) => {
          const isUser = line.kind === "user" || line.kind === "user_message";
          const isNote = line.kind === "status" || line.kind === "stop";
          const content = lineText(line, locale);
          if (line.kind === "agent_thought") {
            return (
              <details key={line.id} className="rounded-lg border border-violet-900/40 px-3 py-2 text-sm text-violet-200/80">
                <summary className="cursor-pointer text-xs">{t(locale, "chat.thinking")}</summary>
                <div className="mt-2 whitespace-pre-wrap break-words">{content}</div>
              </details>
            );
          }
          return (
            <article key={line.id} data-message-kind={line.kind} className={
              isNote ? "text-xs text-slate-500" :
              isUser ? "ml-8 rounded-xl border border-sky-900/50 bg-sky-950/30 p-3 text-sky-100" :
              "mr-4 rounded-xl border border-slate-800 bg-slate-900/50 p-3 text-slate-100"
            }>
              {!isNote && <p className="mb-2 text-xs font-medium text-slate-400">{t(locale, lineLabel(line.kind))}</p>}
              <div className="whitespace-pre-wrap break-words text-sm leading-6">{content}</div>
            </article>
          );
        })}
        {children}
      </div>
      {!following && (
        <button type="button" className="absolute bottom-3 right-3 rounded-full border border-sky-700 bg-slate-900 px-3 py-1.5 text-xs text-sky-200 shadow-lg" onClick={() => {
          followingRef.current = true;
          setFollowing(true);
          if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }}>{t(locale, "chat.latest")}</button>
      )}
    </div>
  );
}

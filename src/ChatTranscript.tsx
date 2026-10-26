import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { followsAfterScroll, type StreamLine } from "./lib/transcript";
import { t, type Locale, type MessageKey } from "./lib/i18n";
import { MarkdownMessage } from "./MarkdownMessage";
import { CopyButton } from "./CopyButton";
import { ToolCard } from "./ToolCard";

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

export function ChatTranscript({ lines, locale, resetKey, children, fill = false, emptyState, agentName }: {
  fill?: boolean;
  emptyState?: ReactNode;
  agentName?: string;
  lines: StreamLine[];
  locale: Locale;
  resetKey: string;
  children?: ReactNode;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const lastScrollTopRef = useRef(0);
  const followingRef = useRef(true);
  const [following, setFollowing] = useState(true);

  const followLatest = () => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    lastScrollTopRef.current = scrollRef.current.scrollTop;
  };

  useLayoutEffect(() => {
    const observer = new ResizeObserver(() => {
      if (followingRef.current) followLatest();
    });
    if (contentRef.current) observer.observe(contentRef.current);
    if (scrollRef.current) observer.observe(scrollRef.current);
    return () => observer.disconnect();
  }, []);

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
      followLatest();
    }
  }, [lines, children, resetKey]);

  return (
    <div className={fill ? "transcript-frame" : "relative"}>
      <div
        ref={scrollRef}
        role="log"
        aria-label={t(locale, "chat.transcript")}
        aria-live="off"
        tabIndex={0}
        onScroll={(event) => {
          const el = event.currentTarget;
          followingRef.current = followsAfterScroll(followingRef.current, lastScrollTopRef.current, el.scrollTop, el.scrollHeight, el.clientHeight);
          lastScrollTopRef.current = el.scrollTop;
          setFollowing(followingRef.current);
        }}
        className={fill ? "transcript-scroll" : "h-[min(55vh,36rem)] min-h-72 overflow-y-auto overscroll-contain rounded-lg border border-slate-800 bg-black/20 p-4 [overflow-anchor:none]"}
      >
        <div ref={contentRef} className={fill ? `transcript-content ${lines.length === 0 && !children ? "is-empty" : ""}` : "space-y-4"}>
        {lines.length === 0 && !children ? (
          emptyState ?? <p className="text-sm text-slate-500">{t(locale, "session.transcriptEmpty")}</p>
        ) : lines.map((line) => {
          const isUser = line.kind === "user" || line.kind === "user_message";
          const isNote = line.kind === "status" || line.kind === "stop";
          const content = lineText(line, locale);
          if (line.tool) return <ToolCard key={line.id} tool={line.tool} locale={locale} />;
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
              isNote ? "message-note" : isUser ? "message-user" : "message-agent"
            }>
              {!isNote && <p className="mb-2 text-xs font-medium text-slate-400">{line.kind === "agent_message" && agentName ? agentName : t(locale, lineLabel(line.kind))}</p>}
              {line.kind === "agent_message" ? <MarkdownMessage text={content} locale={locale} /> :
                <div className="whitespace-pre-wrap break-words text-sm leading-6">{content}</div>}
              {!isNote && <div className="mt-2 flex justify-end"><CopyButton text={line.text} locale={locale} /></div>}
            </article>
          );
        })}
        {children}
        </div>
      </div>
      {!following && (
        <button type="button" className="absolute bottom-3 right-3 rounded-full border border-sky-700 bg-slate-900 px-3 py-1.5 text-xs text-sky-200 shadow-lg" onClick={() => {
          followingRef.current = true;
          setFollowing(true);
          followLatest();
        }}>{t(locale, "chat.latest")}</button>
      )}
    </div>
  );
}

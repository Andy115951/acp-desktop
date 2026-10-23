import { t, type Locale, type MessageKey } from "./lib/i18n";
import type { ToolData } from "./lib/transcript";

export function toolValue(value: unknown): string {
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2) ?? "";
}

function statusKey(status: string | undefined): MessageKey {
  if (status === "Completed") return "tool.completed";
  if (status === "Failed") return "tool.failed";
  if (status === "InProgress") return "tool.running";
  return "tool.pending";
}

export function ToolDetails({ tool, locale }: { tool: ToolData; locale: Locale }) {
  return (
    <div className="space-y-2 text-xs text-slate-300">
      {!!tool.locations?.length && <ul className="space-y-1 font-mono text-sky-200/80">{tool.locations.map((location, i) => (
        <li key={i} className="break-all">{location.path}{location.line != null ? `:${location.line}` : ""}</li>
      ))}</ul>}
      {tool.rawInput != null && <details open><summary className="cursor-pointer text-slate-400">{t(locale, "tool.input")}</summary>
        <pre className="mt-1 max-h-60 overflow-auto whitespace-pre-wrap break-all rounded bg-black/30 p-2">{toolValue(tool.rawInput)}</pre>
      </details>}
      {tool.content?.map((content, i) => {
        if (content.type === "diff") return <details key={i}><summary className="cursor-pointer break-all">{t(locale, "tool.diff")}: {content.path}</summary>
          <p className="mt-2 text-slate-500">{t(locale, "tool.before")}</p>
          <pre className="max-h-60 overflow-auto whitespace-pre-wrap break-all text-red-200/80">{content.oldText ?? ""}</pre>
          <p className="mt-2 text-slate-500">{t(locale, "tool.after")}</p>
          <pre className="max-h-60 overflow-auto whitespace-pre-wrap break-all text-emerald-200/80">{content.newText}</pre>
        </details>;
        if (content.type === "terminal") return <p key={i}>{t(locale, "tool.terminal")}: {content.terminalId}</p>;
        if (content.type === "content") return <pre key={i} className="max-h-60 overflow-auto whitespace-pre-wrap break-all rounded bg-black/30 p-2">{content.content.type === "text" ? content.content.text : `[${content.content.type}]`}</pre>;
        return null;
      })}
      {tool.rawOutput != null && <details><summary className="cursor-pointer text-slate-400">{t(locale, "tool.output")}</summary>
        <pre className="mt-1 max-h-60 overflow-auto whitespace-pre-wrap break-all rounded bg-black/30 p-2">{toolValue(tool.rawOutput)}</pre>
      </details>}
    </div>
  );
}

export function ToolCard({ tool, locale }: { tool: ToolData; locale: Locale }) {
  const cancelled = tool.decision === "cancelled" && !["Completed", "Failed"].includes(tool.status ?? "");
  return (
    <article data-tool-id={tool.id} className="rounded-lg border border-slate-700 bg-slate-900/70 p-3 space-y-2">
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-sm font-medium text-slate-200">{tool.title || t(locale, "chat.tool")}</h3>
        <span className="shrink-0 text-xs text-slate-400">{t(locale, cancelled ? "tool.cancelled" : statusKey(tool.status))}</span>
      </div>
      {tool.decision && <p className="text-xs text-amber-200/80">{t(locale, `tool.${tool.decision}` as MessageKey)}</p>}
      <ToolDetails tool={tool} locale={locale} />
      <details className="text-xs text-slate-500"><summary className="cursor-pointer">{t(locale, "error.details")}</summary>
        <p className="break-all">{tool.id}{tool.kind ? ` · ${tool.kind}` : ""}</p>
      </details>
    </article>
  );
}

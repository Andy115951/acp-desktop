import { Children, isValidElement, memo, useDeferredValue, type ReactNode } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { openUrl } from "@tauri-apps/plugin-opener";
import { CopyButton } from "./CopyButton";
import { t, type Locale } from "./lib/i18n";

/** Agent output can link to web pages, never local/custom executable schemes. */
export function safeWebUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password ? url.href : undefined;
  } catch {
    return undefined;
  }
}

function CodeBlock({ children, locale }: { children?: ReactNode; locale: Locale }) {
  const child = Children.toArray(children)[0];
  const props = isValidElement<{ children?: ReactNode; className?: string }>(child) ? child.props : {};
  const text = String(props.children ?? "").replace(/\n$/, "");
  const language = /language-([^\s]+)/.exec(props.className ?? "")?.[1];
  return (
    <div className="my-3 overflow-hidden rounded-lg border border-slate-700 bg-slate-950">
      <div className="flex items-center justify-between gap-2 border-b border-slate-800 px-3 py-1.5">
        <span className="text-xs text-slate-500">{language ?? t(locale, "chat.code")}</span>
        <CopyButton text={text} locale={locale} label="chat.copyCode" />
      </div>
      <pre className="overflow-x-auto p-3 text-xs leading-6"><code>{text}</code></pre>
    </div>
  );
}

export const MarkdownMessage = memo(function MarkdownMessage({ text, locale }: { text: string; locale: Locale }) {
  const deferred = useDeferredValue(text);
  return (
    <div className="markdown break-words text-sm leading-6">
      <Markdown remarkPlugins={[remarkGfm]} skipHtml urlTransform={(url) => safeWebUrl(url) ?? ""} components={{
        pre: ({ children }) => <CodeBlock locale={locale}>{children}</CodeBlock>,
        // Never fetch remote image URLs just because an agent printed one.
        img: ({ alt }) => <span className="text-slate-400">[{t(locale, "chat.image")}{alt ? `: ${alt}` : ""}]</span>,
        a: ({ href, children }) => {
          const url = href ? safeWebUrl(href) : undefined;
          return url ? <a href={url} rel="noreferrer" onClick={(event) => {
            event.preventDefault();
            void openUrl(url).catch(() => undefined);
          }}>{children}</a> : <span>{children}</span>;
        },
      }}>{deferred}</Markdown>
    </div>
  );
});

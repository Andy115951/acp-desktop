import { useState } from "react";
import { t, type Locale } from "./lib/i18n";

export async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    // WKWebView can deny the async Clipboard API on custom URL schemes.
    const focused = document.activeElement as HTMLElement | null;
    const field = document.createElement("textarea");
    field.value = text;
    field.style.cssText = "position:fixed;left:-9999px;top:0";
    document.body.append(field);
    field.select();
    try {
      if (!document.execCommand("copy")) throw new Error("Clipboard unavailable");
    } finally {
      field.remove();
      focused?.focus({ preventScroll: true });
    }
  }
}

export function CopyButton({ text, locale, label = "chat.copy" }: { text: string; locale: Locale; label?: "chat.copy" | "chat.copyCode" }) {
  const [result, setResult] = useState<{ text: string; ok: boolean } | null>(null);
  return (
    <button type="button" className="rounded border border-slate-700 px-2 py-1 text-xs text-slate-400 hover:text-white" onClick={() => {
      void copyText(text).then(() => setResult({ text, ok: true }), () => setResult({ text, ok: false }));
    }} aria-label={t(locale, label)}>
      <span role="status">{t(locale, result?.text === text ? result.ok ? "chat.copied" : "chat.copyFailed" : label)}</span>
    </button>
  );
}

import { sessionsForWorkspace, type SessionCatalog } from "./lib/sessionCatalog";
import { t, type Locale } from "./lib/i18n";

export function SessionHistory({ catalog, cwd, savedSessionId, disabled, failed, locale, onSelect }: {
  catalog: SessionCatalog;
  cwd: string | null;
  savedSessionId: string | null;
  disabled: boolean;
  failed: boolean;
  locale: Locale;
  onSelect: (sessionId: string) => void;
}) {
  const entries = cwd ? sessionsForWorkspace(catalog, cwd) : [];
  return (
    <div className="space-y-1.5">
      <label className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
        {t(locale, "history.label")}
        <select
          aria-label={t(locale, "history.label")}
          value={entries.some((entry) => entry.sessionId === savedSessionId) ? savedSessionId! : ""}
          disabled={disabled || entries.length === 0}
          onChange={(event) => onSelect(event.target.value)}
          className="min-w-0 max-w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-200 disabled:opacity-50"
        >
          <option value="" disabled>{t(locale, entries.length ? "history.choose" : "history.empty")}</option>
          {entries.map((entry) => (
            <option key={entry.sessionId} value={entry.sessionId}>
              {entry.title ?? entry.sessionId}
              {entry.updatedAt > 0 ? ` · ${new Date(entry.updatedAt).toLocaleString(locale)}` : ""}
            </option>
          ))}
        </select>
      </label>
      <p className="text-xs text-slate-500">{t(locale, "history.appKnown")}</p>
      {disabled ? <p className="text-xs text-slate-400">{t(locale, "history.disconnect")}</p> : null}
      {failed ? <p role="alert" className="text-xs text-amber-200">{t(locale, "history.failed")}</p> : null}
    </div>
  );
}

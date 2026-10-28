import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { SESSION_TITLE_LIMIT, type SessionCatalog, type SessionEntry } from "./lib/sessionCatalog";
import { searchSavedSessions, sessionDisplayTitle } from "./lib/sessionSearch";
import { t, type Locale } from "./lib/i18n";

export function SessionHistory({ catalog, cwd, savedSessionId, disabled, editingDisabled = disabled, failed, locale, onSelect, onRename, onArchive, onRestore, listSupported, listIncomplete, variant = "select", searchFocusToken = 0, searchTitle }: {
  searchFocusToken?: number;
  searchTitle?: string;
  variant?: "select" | "list";
  catalog: SessionCatalog;
  cwd: string | null;
  savedSessionId: string | null;
  disabled: boolean;
  editingDisabled?: boolean;
  failed: boolean;
  locale: Locale;
  onSelect: (sessionId: string) => void;
  onRename?: (title: string) => Promise<boolean>;
  onArchive?: () => Promise<boolean>;
  onRestore?: (sessionId: string) => Promise<boolean>;
  listSupported?: boolean | null;
  listIncomplete?: boolean;
}) {
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const focusedSearchToken = useRef(searchFocusToken);
  useLayoutEffect(() => {
    if (searchFocusToken === focusedSearchToken.current) return;
    focusedSearchToken.current = searchFocusToken;
    if (searchFocusToken && cwd && document.hasFocus()) searchRef.current?.focus();
  }, [searchFocusToken, cwd]);
  const countId = useId();
  const { entries, matches, filtering } = searchSavedSessions(catalog, cwd, query);
  const selected = entries.find((entry) => entry.sessionId === savedSessionId);
  const selectedOutsideResults = selected && !matches.includes(selected);
  const archived = catalog.sessions.filter((entry) => entry.cwd === cwd && entry.archivedAt != null);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState("");
  useEffect(() => { setEditing(false); setTitle(""); }, [cwd, savedSessionId]);
  const clearSearch = () => { setQuery(""); searchRef.current?.focus(); };
  const row = (entry: SessionEntry) => <li key={entry.sessionId}><button type="button" disabled={disabled || editing}
    aria-current={entry.sessionId === savedSessionId ? "true" : undefined}
    onClick={() => onSelect(entry.sessionId)} title={sessionDisplayTitle(entry.sessionId, entry.title)}>
    <span className="session-row-title">{sessionDisplayTitle(entry.sessionId, entry.title)}</span>
    {entry.updatedAt > 0 && <time dateTime={new Date(entry.updatedAt).toISOString()}>{new Date(entry.updatedAt).toLocaleDateString(locale, { month: "short", day: "numeric" })}</time>}
  </button></li>;
  return (
    <div className="space-y-1.5">
      {variant === "list" ? <>
        <h2 className="sidebar-section-heading">{t(locale, "history.label")}<span id={countId} className="session-count" role="status" aria-live="polite"
          aria-label={t(locale, "history.matches", { count: String(matches.length), total: String(entries.length) })}>{filtering ? `${matches.length}/${entries.length}` : entries.length}</span></h2>
        <div className="history-search" onKeyDown={(event) => {
          // Search/clear own their keys, including a/r/Enter/Escape while a
          // permission card is pending. Filtering must never authorize a tool.
          event.stopPropagation();
          if (event.key === "Escape" && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) {
            event.preventDefault(); clearSearch();
          }
        }}>
          <input ref={searchRef} title={searchTitle} type="search" value={query} disabled={!cwd}
            onChange={(event) => setQuery(event.target.value)} aria-label={t(locale, "history.search")}
            aria-describedby={countId} placeholder={t(locale, "history.searchPlaceholder")} />
          {query && <button type="button" onClick={clearSearch} aria-label={t(locale, "history.clearSearch")} title={t(locale, "history.clearSearch")}><span aria-hidden="true">×</span></button>}
        </div>
        {selectedOutsideResults && <>
          <p className="history-selected-label">{t(locale, "history.selected")}</p>
          <ul className="session-list" aria-label={t(locale, "history.selected")}>{row(selected)}</ul>
        </>}
        {entries.length === 0 ? <p className="history-empty">{t(locale, "history.empty")}</p>
          : matches.length === 0 ? <p className="history-empty">{t(locale, "history.noMatches")}</p>
          : <ul className="session-list" aria-label={t(locale, "history.results")}>{matches.map(row)}</ul>}
      </> : <>
      <label className="flex flex-wrap items-center gap-2 text-xs text-ui-muted">
        {t(locale, "history.label")}
        <select
          aria-label={t(locale, "history.label")}
          value={entries.some((entry) => entry.sessionId === savedSessionId) ? savedSessionId! : ""}
          disabled={disabled || entries.length === 0}
          onChange={(event) => onSelect(event.target.value)}
          className="min-w-0 max-w-full rounded-md border border-ui-border bg-ui-code px-2 py-1 text-xs text-ui-primary disabled:opacity-50"
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
      </>}
      {(onRename || onArchive || onRestore) && <details className="history-management">
        <summary>{t(locale, "history.manage")}</summary>
      {onRename && onArchive ? (
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={editingDisabled || !selected || editing}
            onClick={() => { setTitle(selected?.title ?? ""); setEditing(true); }}
            className="rounded-md border border-ui-border px-2 py-1 text-xs text-ui-secondary disabled:opacity-40">
            {t(locale, "history.rename")}
          </button>
          <button type="button" disabled={editingDisabled || !selected || editing} onClick={() => void onArchive()}
            title={t(locale, "history.archiveHelp")}
            className="rounded-md border border-ui-border px-2 py-1 text-xs text-ui-secondary disabled:opacity-40">
            {t(locale, "history.archive")}
          </button>
        </div>
      ) : null}
      {editing ? (
        <form className="flex flex-wrap items-center gap-2" onSubmit={(event) => {
          event.preventDefault();
          if (!editingDisabled && title.trim()) void onRename?.(title).then((saved) => { if (saved) setEditing(false); });
        }}>
          <label className="text-xs text-ui-muted">
            {t(locale, "history.title")}
            <input autoFocus required maxLength={SESSION_TITLE_LIMIT} value={title} disabled={editingDisabled}
              onChange={(event) => setTitle(event.target.value)}
              className="mt-1 w-full min-w-0 rounded-md border border-ui-border bg-ui-code px-2 py-1 text-sm text-ui-primary" />
          </label>
          <button type="submit" disabled={editingDisabled || !title.trim()}
            className="rounded-md bg-sky-700 px-2 py-1 text-xs text-white disabled:opacity-40">{t(locale, "history.save")}</button>
          <button type="button" disabled={editingDisabled} onClick={() => setEditing(false)}
            className="text-xs text-ui-muted">{t(locale, "history.cancel")}</button>
        </form>
      ) : null}
      {onRestore && archived.length > 0 ? (
        <details className="space-y-2 text-xs text-ui-muted">
          <summary className="cursor-pointer">{t(locale, "history.archived", { count: String(archived.length) })}</summary>
          <p>{t(locale, "history.archiveHelp")}</p>
          <ul className="space-y-2">
            {archived.map((entry) => (
              <li key={entry.sessionId} className="flex items-center justify-between gap-2">
                <span className="min-w-0 break-all">{entry.title ?? entry.sessionId}{entry.unavailable ? ` · ${t(locale, "history.unavailable")}` : ""}</span>
                <button type="button" disabled={editingDisabled || editing} onClick={() => void onRestore(entry.sessionId)}
                  aria-label={t(locale, "history.restoreNamed", { name: entry.title ?? entry.sessionId })}
                  className="shrink-0 rounded-md border border-ui-border px-2 py-1 disabled:opacity-40">{t(locale, "history.restore")}</button>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      </details>}
      {variant === "list" ? <details className="history-help"><summary>{t(locale, "layout.historyHelp")}</summary>
        <p>{t(locale, listSupported === true ? "history.discovered" : listSupported === false ? "history.listUnsupported" : "history.appKnown")}</p>
      </details> : <p className="text-xs text-ui-faint">{t(locale, listSupported === true ? "history.discovered" : listSupported === false ? "history.listUnsupported" : "history.appKnown")}</p>}
      {listIncomplete ? <p role="status" className="text-xs text-ui-warning">{t(locale, "history.listIncomplete")}</p> : null}
      {disabled ? <p className="text-xs text-ui-muted">{t(locale, "history.disconnect")}</p> : null}
      {failed ? <p role="alert" className="text-xs text-ui-warning">{t(locale, "history.failed")}</p> : null}

    </div>
  );
}

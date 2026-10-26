import { t, type Locale } from "./lib/i18n";
import type { RecentWorkspace } from "./lib/workspaceHistory";

export function WorkspacePicker({ cwd, workspaces, disabled, failed, locale, onSelect }: {
  cwd: string | null;
  workspaces: RecentWorkspace[];
  disabled: boolean;
  failed: boolean;
  locale: Locale;
  onSelect: (cwd: string) => void;
}) {
  const paths = [...new Set([...(cwd ? [cwd] : []), ...workspaces.map((entry) => entry.cwd)])];
  return (
    <div className="space-y-1">
      <label className="flex flex-wrap items-center gap-2 text-xs text-ui-muted">
        {t(locale, "workspace.recent")}
        <select value={cwd ?? ""} disabled={disabled || paths.length === 0}
          aria-label={t(locale, "workspace.recent")} onChange={(event) => onSelect(event.target.value)}
          className="min-w-0 max-w-full rounded-md border border-ui-border bg-ui-code px-2 py-1 text-xs text-ui-primary disabled:opacity-50">
          <option value="" disabled>{t(locale, paths.length ? "workspace.choose" : "workspace.empty")}</option>
          {paths.map((path) => <option key={path} value={path}>{path}</option>)}
        </select>
      </label>
      {failed ? <p role="alert" className="text-xs text-ui-warning">{t(locale, "workspace.failed")}</p> : null}
    </div>
  );
}

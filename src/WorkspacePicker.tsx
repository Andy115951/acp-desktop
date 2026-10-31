import { t, type Locale } from "./lib/i18n";
import type { RecentWorkspace } from "./lib/workspaceHistory";

export function WorkspacePicker({ cwd, workspaces, disabled, failed, locale, onSelect, onBrowse }: {
  cwd: string | null;
  workspaces: RecentWorkspace[];
  disabled: boolean;
  failed: boolean;
  locale: Locale;
  onSelect: (cwd: string) => void;
  onBrowse: () => void;
}) {
  const paths = [...new Set([...(cwd ? [cwd] : []), ...workspaces.map((entry) => entry.cwd)])];
  const folderName = (path: string) => path.split(/[\\/]/).filter(Boolean).slice(-1)[0] ?? path;
  return (
    <div className="workspace-picker">
      {cwd ? <div className="workspace-current" title={cwd}>
        <strong>{folderName(cwd)}</strong>
        <span>{cwd}</span>
      </div> : <p className="workspace-empty">{t(locale, "workspace.choose")}</p>}
      <button type="button" className="workspace-browse" onClick={onBrowse} disabled={disabled}>
        {t(locale, "session.pickFolder")}
      </button>
      <label className="workspace-recent-label">
        <span>{t(locale, "workspace.recent")}</span>
        <select value={cwd ?? ""} disabled={disabled || paths.length === 0}
          aria-label={t(locale, "workspace.recent")} onChange={(event) => {
            if (event.target.value !== cwd) onSelect(event.target.value);
          }}>
          <option value="" disabled>{t(locale, paths.length ? "workspace.choose" : "workspace.empty")}</option>
          {paths.map((path) => <option key={path} value={path}>{folderName(path)} — {path}</option>)}
        </select>
      </label>
      {failed ? <p role="alert" className="text-xs text-ui-warning">{t(locale, "workspace.failed")}</p> : null}
    </div>
  );
}

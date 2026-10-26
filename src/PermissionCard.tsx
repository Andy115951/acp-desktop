import type { RefObject } from "react";
import { permissionFocusOptionIndex } from "./lib/permissionHotkey";
import { t, type Locale } from "./lib/i18n";
import type { PermissionRequest } from "./store/session";
import { ToolDetails } from "./ToolCard";

type Props = {
  permission: PermissionRequest;
  allowButtonRef: RefObject<HTMLButtonElement | null>;
  onRespond: (optionId: string | null) => void;
  locale?: Locale;
};

/**
 * Inline Ask permission card rendered in the chat transcript (not a
 * full-viewport modal). Keep hotkeys/focus wired from App.
 * Option names / title / detail come from the agent — not translated.
 */
export function PermissionCard({
  permission,
  allowButtonRef,
  onRespond,
  locale = "en",
}: Props) {
  const focusIdx = permissionFocusOptionIndex(permission.options);

  return (
    <div
      data-testid="permission-card"
      className="rounded-lg border border-ui-warning/70 bg-ui-panel/95 p-3 shadow-lg shadow-black/20 space-y-2 ring-1 ring-ui-warning/40"
      role="group"
      aria-label={t(locale, "permission.ariaLabel")}
    >
      <h3 className="text-sm font-semibold text-ui-warning">
        {permission.title}
      </h3>
      {permission.tool ? <ToolDetails tool={permission.tool} locale={locale} /> :
        <p className="text-xs text-ui-muted break-all">{permission.detail}</p>}
      <div className="flex flex-wrap gap-2 pt-1">
        {permission.options.map((opt, idx) => {
          const isAllow = opt.kind.startsWith("Allow");
          return (
            <button
              key={opt.id}
              type="button"
              ref={idx === focusIdx ? allowButtonRef : undefined}
              onClick={() => onRespond(opt.id)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium ${
                isAllow
                  ? "bg-emerald-700 text-white"
                  : opt.kind.startsWith("Reject")
                    ? "bg-red-800 text-white"
                    : "border border-ui-border-strong text-ui-primary"
              }`}
            >
              {opt.name}
            </button>
          );
        })}
        <button
          type="button"
          onClick={() => onRespond(null)}
          className="rounded-md border border-ui-border-strong px-3 py-1.5 text-xs text-ui-secondary"
        >
          {t(locale, "permission.cancel")}
        </button>
      </div>
      <p className="text-[10px] text-ui-faint pt-0.5">
        {t(locale, "permission.hotkeys")}
      </p>
    </div>
  );
}

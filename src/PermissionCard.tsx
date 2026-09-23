import type { RefObject } from "react";
import { permissionFocusOptionIndex } from "./lib/permissionHotkey";
import type { PermissionRequest } from "./store/session";

type Props = {
  permission: PermissionRequest;
  allowButtonRef: RefObject<HTMLButtonElement | null>;
  onRespond: (optionId: string | null) => void;
};

/**
 * Inline Ask permission card rendered in the chat transcript (not a
 * full-viewport modal). Keep hotkeys/focus wired from App.
 */
export function PermissionCard({
  permission,
  allowButtonRef,
  onRespond,
}: Props) {
  const focusIdx = permissionFocusOptionIndex(permission.options);

  return (
    <div
      data-testid="permission-card"
      className="rounded-lg border border-amber-700/70 bg-slate-900/95 p-3 shadow-lg shadow-black/20 space-y-2 ring-1 ring-amber-900/40"
      role="group"
      aria-label="Permission request"
    >
      <h3 className="text-sm font-semibold text-amber-50">
        {permission.title}
      </h3>
      <p className="text-xs text-slate-400 break-all">{permission.detail}</p>
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
                    : "border border-slate-600 text-slate-200"
              }`}
            >
              {opt.name}
            </button>
          );
        })}
        <button
          type="button"
          onClick={() => onRespond(null)}
          className="rounded-md border border-slate-600 px-3 py-1.5 text-xs text-slate-300"
        >
          Cancel
        </button>
      </div>
      <p className="text-[10px] text-slate-500 pt-0.5">
        Keys:{" "}
        <kbd className="text-slate-400">a</kbd>/
        <kbd className="text-slate-400">Enter</kbd> Allow ·{" "}
        <kbd className="text-slate-400">r</kbd> Reject ·{" "}
        <kbd className="text-slate-400">Esc</kbd> Cancel
      </p>
    </div>
  );
}

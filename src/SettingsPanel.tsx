import { useLayoutEffect, useRef, type ReactNode, type RefObject } from "react";
import { t, type Locale } from "./lib/i18n";

/** Kept mounted so closing settings never discards an unfinished profile form. */
export function SettingsPanel({ open, locale, onClose, closeRef, children, macOS }: {
  macOS: boolean; open: boolean; locale: Locale; onClose: () => void;
  closeRef: RefObject<HTMLButtonElement | null>; children: ReactNode;
}) {
  const panelRef = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    if (!open || !panelRef.current) return;
    const panel = panelRef.current;
    const keepFocus = () => {
      // Editing/saving can replace the focused button. Keep keyboard input in
      // the open modal, without activating a background application.
      if (document.hasFocus() && !panel.contains(document.activeElement)) closeRef.current?.focus();
    };
    const observer = new MutationObserver(keepFocus);
    observer.observe(panel, { childList: true, subtree: true, attributes: true, attributeFilter: ["disabled", "hidden", "open"] });
    keepFocus();
    return () => observer.disconnect();
  }, [open, closeRef]);
  return <div className="settings-layer" hidden={!open} onKeyDown={(event) => {
    // Settings owns its keys; a/r/Enter/Escape must not decide a background Ask.
    event.stopPropagation();
    if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
    if (event.key === "Escape") { event.preventDefault(); onClose(); }
    if (event.key === "Tab") {
      const controls = Array.from(panelRef.current?.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary, a[href], [tabindex="0"]',
      ) ?? []).filter(element => {
        if (!element.getClientRects().length) return false;
        // Closed details can still expose layout rects for skipped content.
        // Only their own summary participates in the keyboard cycle.
        for (let parent = element.parentElement; parent; parent = parent.parentElement) {
          if (parent instanceof HTMLDetailsElement && !parent.open &&
            !parent.querySelector(":scope > summary")?.contains(element)) return false;
        }
        return true;
      });
      if (!controls.length) return;
      event.preventDefault();
      const index = controls.indexOf(document.activeElement as HTMLElement);
      const next = index < 0 ? event.shiftKey ? controls.length - 1 : 0
        : (index + (event.shiftKey ? -1 : 1) + controls.length) % controls.length;
      controls[next].focus();
    }
  }}>
    <div className="settings-backdrop" onClick={onClose} aria-hidden="true" />
    <section ref={panelRef} id="app-settings" className="settings-panel" role="dialog" aria-modal="true" aria-labelledby="settings-title">
      <header className="settings-header" data-tauri-drag-region={macOS ? "deep" : undefined}><h2 id="settings-title">{t(locale, "settings.title")}</h2>
        <button ref={closeRef} type="button" className="icon-button" onClick={onClose} aria-label={t(locale, "settings.close")}><span aria-hidden="true">×</span></button>
      </header>
      <div className="settings-scroll">{children}</div>
    </section>
  </div>;
}

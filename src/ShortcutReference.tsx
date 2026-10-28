import { forwardRef } from "react";
import { APP_SHORTCUTS, shortcutLabel, type AppShortcut } from "./lib/appShortcuts";
import { t, type Locale, type MessageKey } from "./lib/i18n";
export const shortcutMessage: Record<AppShortcut, MessageKey> = {
  new: "navigation.newConversation", composer: "shortcuts.composer", search: "history.search", settings: "settings.title",
};
export const ShortcutReference = forwardRef<HTMLDetailsElement, { locale: Locale; macOS: boolean }>(function ShortcutReference({ locale, macOS }, ref) {
  return <details ref={ref} className="shortcut-reference sidebar-details">
    <summary>{t(locale, "shortcuts.title")}</summary>
    <dl>{APP_SHORTCUTS.map(action => <div key={action}><dt>{t(locale, shortcutMessage[action])}</dt><dd><kbd>{shortcutLabel(action, macOS)}</kbd></dd></div>)}</dl>
    <p>{t(locale, "shortcuts.help")}</p>
  </details>;
});

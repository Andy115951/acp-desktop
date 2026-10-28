/** App-local shortcuts only; never registers a system-wide accelerator. */
export type AppShortcut = "new" | "composer" | "search" | "settings";
export type ShortcutEvent = Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey" | "repeat" | "isComposing" | "keyCode">;
export const APP_SHORTCUTS: readonly AppShortcut[] = ["new", "composer", "search", "settings"];
const keys = { new: "O", composer: "L", search: "F", settings: "," } as const;
export function appShortcut(event: ShortcutEvent, macOS: boolean): AppShortcut | null {
  if (event.isComposing || event.keyCode === 229 || event.repeat || event.altKey ||
    (macOS ? !event.metaKey || event.ctrlKey : !event.ctrlKey || event.metaKey)) return null;
  if (event.key === "," && !event.shiftKey) return "settings";
  if (!event.shiftKey) return null;
  return APP_SHORTCUTS.find(action => action !== "settings" && keys[action] === event.key.toUpperCase()) ?? null;
}
export function shortcutLabel(action: AppShortcut, macOS: boolean): string {
  return macOS ? `⌘${action === "settings" ? "" : "⇧"}${keys[action]}`
    : `Ctrl+${action === "settings" ? "" : "Shift+"}${keys[action]}`;
}
export function shortcutAria(action: AppShortcut, macOS: boolean): string {
  return `${macOS ? "Meta" : "Control"}+${action === "settings" ? "" : "Shift+"}${keys[action]}`;
}
export function canRunShortcut(action: AppShortcut, state: {
  permission: boolean; settings: boolean; customEditing: boolean; localEditor: boolean;
  canNavigate: boolean; contextChanging: boolean; cwd: boolean;
}): boolean {
  if (state.permission || state.settings || state.localEditor) return false;
  if (action === "settings") return true;
  if (state.customEditing || state.contextChanging) return false;
  if (action === "new") return state.canNavigate;
  if (action === "search") return state.cwd;
  return true;
}

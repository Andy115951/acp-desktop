export const AUTO_CONNECT_KEY = "acp-desktop.startup.auto-connect";
export function loadAutoConnect(): boolean {
  try { return localStorage.getItem(AUTO_CONNECT_KEY) !== "false"; }
  catch { return false; }
}
export function saveAutoConnect(value: boolean): void {
  try { localStorage.setItem(AUTO_CONNECT_KEY, String(value)); } catch { /* Best effort. */ }
}

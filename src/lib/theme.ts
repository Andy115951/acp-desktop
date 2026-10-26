export type Theme = "system" | "light" | "dark";
export const THEME_KEY = "acp-desktop.ui.theme";

export function parseTheme(value: unknown): Theme {
  return value === "light" || value === "dark" ? value : "system";
}

export function loadTheme(): Theme {
  try { return parseTheme(localStorage.getItem(THEME_KEY)); }
  catch { return "system"; }
}

export function saveTheme(theme: Theme): void {
  try { localStorage.setItem(THEME_KEY, theme); }
  catch { /* Appearance remains usable when storage is unavailable. */ }
}

export function applyTheme(theme: Theme, systemDark: boolean): void {
  document.documentElement.dataset.theme = theme === "system" ? (systemDark ? "dark" : "light") : theme;
}

/** Install before React renders, and keep system changes live without moving focus. */
export function watchTheme(getTheme: () => Theme): () => void {
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const update = () => applyTheme(getTheme(), media.matches);
  update();
  media.addEventListener("change", update);
  return () => media.removeEventListener("change", update);
}

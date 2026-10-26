import { applyTheme, loadTheme, saveTheme, type Theme } from "../lib/theme";
import { create } from "zustand";
import { Store } from "@tauri-apps/plugin-store";
import {
  DEFAULT_LOCALE,
  PREFS_KEY_UI_LOCALE,
  parseLocale,
  type Locale,
} from "../lib/i18n";

const PREFS_FILE = "prefs.json";
let prefsStore: Store | null = null;

async function getPrefsStore(): Promise<Store> {
  if (!prefsStore) {
    prefsStore = await Store.load(PREFS_FILE);
  }
  return prefsStore;
}

async function loadLocale(): Promise<Locale> {
  try {
    const store = await getPrefsStore();
    const value = await store.get<unknown>(PREFS_KEY_UI_LOCALE);
    return parseLocale(value);
  } catch {
    return DEFAULT_LOCALE;
  }
}

async function saveLocale(locale: Locale): Promise<void> {
  try {
    const store = await getPrefsStore();
    await store.set(PREFS_KEY_UI_LOCALE, locale);
    await store.save();
  } catch {
    // Prefs are best-effort.
  }
}

type UiState = {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  locale: Locale;
  hydrateLocale: () => Promise<void>;
  setLocale: (locale: Locale) => void;
};

export const useUiStore = create<UiState>((set, get) => ({
  theme: loadTheme(),
  setTheme: (theme) => {
    set({ theme });
    applyTheme(theme, window.matchMedia("(prefers-color-scheme: dark)").matches);
    saveTheme(theme);
  },
  locale: DEFAULT_LOCALE,
  hydrateLocale: async () => {
    const locale = await loadLocale();
    if (get().locale !== locale) set({ locale });
  },
  setLocale: (locale) => {
    if (get().locale === locale) return;
    set({ locale });
    void saveLocale(locale);
  },
}));

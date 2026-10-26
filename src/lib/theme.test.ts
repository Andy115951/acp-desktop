import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyTheme, loadTheme, parseTheme, saveTheme, THEME_KEY, watchTheme, type Theme } from "./theme";

afterEach(() => vi.unstubAllGlobals());

describe("appearance preference", () => {
  beforeEach(() => {
    const values = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    });
    vi.stubGlobal("document", { documentElement: { dataset: {} } });
  });

  it("defaults missing or invalid preferences to the system theme", () => {
    expect(loadTheme()).toBe("system");
    localStorage.setItem(THEME_KEY, "sepia");
    expect(loadTheme()).toBe("system");
    expect(parseTheme({ theme: "dark" })).toBe("system");
  });

  it("restores all three choices from persistent storage", () => {
    for (const theme of ["light", "dark", "system"] as const) {
      saveTheme(theme);
      expect(loadTheme()).toBe(theme);
    }
  });

  it("keeps appearance usable when storage access fails", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => { throw new Error("unavailable"); },
      setItem: () => { throw new Error("unavailable"); },
    });
    expect(loadTheme()).toBe("system");
    expect(() => saveTheme("light")).not.toThrow();
    applyTheme("light", true);
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("follows live system changes only while system is selected and removes its listener", () => {
    let theme: Theme = "system";
    const media = { matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() };
    vi.stubGlobal("window", { matchMedia: () => media });
    const stop = watchTheme(() => theme);
    const update = media.addEventListener.mock.calls[0][1];
    expect(document.documentElement.dataset.theme).toBe("dark");
    media.matches = false;
    update();
    expect(document.documentElement.dataset.theme).toBe("light");
    theme = "dark";
    update();
    expect(document.documentElement.dataset.theme).toBe("dark");
    theme = "light";
    media.matches = true;
    update();
    expect(document.documentElement.dataset.theme).toBe("light");
    stop();
    expect(media.removeEventListener).toHaveBeenCalledWith("change", update);
  });
});

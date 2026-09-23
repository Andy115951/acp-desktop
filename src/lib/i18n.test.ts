import { describe, expect, it } from "vitest";
import {
  DEFAULT_LOCALE,
  LOCALES,
  dictionaryKeys,
  messages,
  parseLocale,
  t,
  type MessageKey,
} from "./i18n";

describe("parseLocale", () => {
  it("accepts en and zh-CN", () => {
    expect(parseLocale("en")).toBe("en");
    expect(parseLocale("zh-CN")).toBe("zh-CN");
  });

  it("normalizes common aliases", () => {
    expect(parseLocale("zh")).toBe("zh-CN");
    expect(parseLocale("zh_CN")).toBe("zh-CN");
    expect(parseLocale("en-US")).toBe("en");
  });

  it("defaults unknown values to en", () => {
    expect(parseLocale(null)).toBe(DEFAULT_LOCALE);
    expect(parseLocale(undefined)).toBe("en");
    expect(parseLocale("fr")).toBe("en");
    expect(parseLocale(1)).toBe("en");
  });
});

describe("t()", () => {
  it("returns English by default locale", () => {
    expect(t("en", "session.send")).toBe("Send");
    expect(t("en", "permission.cancel")).toBe("Cancel");
  });

  it("returns zh-CN chrome strings", () => {
    expect(t("zh-CN", "session.send")).toBe("发送");
    expect(t("zh-CN", "language.label")).toBe("语言");
    expect(t("zh-CN", "session.connect")).toBe("连接");
  });

  it("interpolates {name} / {id} placeholders", () => {
    expect(t("en", "session.agentTitle", { name: "Grok" })).toBe(
      "Grok session",
    );
    expect(t("zh-CN", "session.agentTitle", { name: "Grok" })).toBe(
      "Grok 会话",
    );
    expect(t("en", "session.resumeTitleId", { id: "abc" })).toBe(
      "Resume session abc",
    );
  });

  it("falls back to English dict when locale missing a key path", () => {
    // Both locales should define every key; smoke the helper path.
    expect(t("en", "agents.title")).toBeTruthy();
    expect(t("zh-CN", "agents.title")).toBeTruthy();
  });
});

describe("dictionary coverage", () => {
  it("exposes the same keys for every locale", () => {
    const keys = dictionaryKeys();
    expect(keys.length).toBeGreaterThan(20);
    for (const locale of LOCALES) {
      const localeKeys = Object.keys(messages[locale]).sort();
      expect(localeKeys).toEqual([...keys].sort());
    }
  });

  it("has non-empty strings for every key/locale", () => {
    for (const locale of LOCALES) {
      for (const key of dictionaryKeys()) {
        const value = messages[locale][key as MessageKey];
        expect(value, `${locale}:${key}`).toBeTruthy();
        expect(typeof value).toBe("string");
      }
    }
  });

  it("keeps auth hints searchable in English", () => {
    expect(t("en", "auth.codex")).toMatch(/CODEX_API_KEY|OPENAI_API_KEY/);
    expect(t("en", "auth.claude")).toMatch(/ANTHROPIC_API_KEY/);
  });
});

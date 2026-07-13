import type { InitOptions } from "i18next";
import de from "./locales/de.json";
import en from "./locales/en.json";
import es from "./locales/es.json";
import ja from "./locales/ja.json";
import zhTW from "./locales/zh-TW.json";

export const resources = {
  en: {
    translation: en,
  },
  de: {
    translation: de,
  },
  es: {
    translation: es,
  },
  ja: {
    translation: ja,
  },
  "zh-TW": {
    translation: zhTW,
  },
} as const;

export const supportedLocales = ["en", "de", "es", "ja", "zh-TW"] as const;
export type SupportedLocale = (typeof supportedLocales)[number];
export const defaultLocale: SupportedLocale = "en";

export const matchSupportedLocale = (
  locale?: string | null,
): SupportedLocale | undefined => {
  if (!locale) {
    return undefined;
  }

  const normalized = locale.trim().replace(/_/g, "-");
  if (!normalized) {
    return undefined;
  }

  if (supportedLocales.includes(normalized as SupportedLocale)) {
    return normalized as SupportedLocale;
  }

  const base = normalized.split("-")[0];
  if (supportedLocales.includes(base as SupportedLocale)) {
    return base as SupportedLocale;
  }

  if (
    normalized === "zh" ||
    normalized === "zh-HK" ||
    normalized === "zh-MO" ||
    normalized.startsWith("zh-Hant")
  ) {
    return "zh-TW";
  }

  return undefined;
};

export const resolveLocale = (locale?: string | null): SupportedLocale =>
  matchSupportedLocale(locale) ?? defaultLocale;

export const getI18nOptions = (locale?: string | null): InitOptions => ({
  resources,
  lng: resolveLocale(locale),
  fallbackLng: defaultLocale,
  interpolation: {
    escapeValue: false,
  },
  returnNull: false,
});

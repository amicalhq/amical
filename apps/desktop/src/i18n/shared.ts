import type { InitOptions } from "i18next";
import en from "./locales/en.json";
import es from "./locales/es.json";
import ja from "./locales/ja.json";
import zhTW from "./locales/zh-TW.json";

export const resources = {
  en: {
    translation: en,
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

export const supportedLocales = ["en", "es", "ja", "zh-TW"] as const;
export type SupportedLocale = (typeof supportedLocales)[number];
export const defaultLocale: SupportedLocale = "en";

export const resolveLocale = (locale?: string | null): SupportedLocale => {
  if (!locale) {
    return defaultLocale;
  }

  const normalized = locale.replace("_", "-");

  if (supportedLocales.includes(normalized as SupportedLocale)) {
    return normalized as SupportedLocale;
  }

  const base = normalized.split("-")[0];
  if (supportedLocales.includes(base as SupportedLocale)) {
    return base as SupportedLocale;
  }

  if (base === "zh") {
    return "zh-TW";
  }

  return defaultLocale;
};

export const getI18nOptions = (locale?: string | null): InitOptions => ({
  resources,
  lng: resolveLocale(locale),
  fallbackLng: defaultLocale,
  interpolation: {
    escapeValue: false,
  },
  returnNull: false,
});

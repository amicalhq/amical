import type { InitOptions } from "i18next";
import en from "./locales/en.json";
import ja from "./locales/ja.json";

export const resources = {
  en: {
    translation: en,
  },
  ja: {
    translation: ja,
  },
} as const;

export const supportedLocales = ["en", "ja"] as const;
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

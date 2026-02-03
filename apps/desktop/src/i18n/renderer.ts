import { createInstance } from "i18next";
import { initReactI18next } from "react-i18next";
import { getI18nOptions } from "./shared";

export const getSystemLocale = (): string | undefined => {
  if (typeof navigator === "undefined") {
    return undefined;
  }

  return (
    navigator.languages?.[0] ||
    navigator.language ||
    Intl.DateTimeFormat().resolvedOptions().locale
  );
};

export const initRendererI18n = async (locale?: string | null) => {
  const instance = createInstance();
  instance.use(initReactI18next);
  await instance.init(getI18nOptions(locale));
  return instance;
};

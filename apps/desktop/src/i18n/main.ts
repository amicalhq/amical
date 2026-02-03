import { createInstance } from "i18next";
import { getI18nOptions } from "./shared";

export const initMainI18n = async (locale?: string | null) => {
  const instance = createInstance();
  await instance.init(getI18nOptions(locale));
  return instance;
};

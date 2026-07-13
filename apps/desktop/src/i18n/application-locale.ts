import { app } from "electron";
import {
  defaultLocale,
  matchSupportedLocale,
  type SupportedLocale,
} from "./shared";

let applicationLocale: SupportedLocale | undefined;

const getElectronApplicationLocale = (): SupportedLocale => {
  try {
    return matchSupportedLocale(app.getLocale()) ?? defaultLocale;
  } catch {
    return defaultLocale;
  }
};

export const setApplicationLocale = (
  locale?: string | null,
): SupportedLocale => {
  applicationLocale =
    matchSupportedLocale(locale) ?? getElectronApplicationLocale();
  return applicationLocale;
};

export const getApplicationLocale = (): SupportedLocale =>
  applicationLocale ?? getElectronApplicationLocale();

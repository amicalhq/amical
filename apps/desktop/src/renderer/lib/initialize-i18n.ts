import { trpcClient } from "@/trpc/react";
import { getSystemLocale, initRendererI18n } from "@/i18n/renderer";

export const initializeRendererI18n = async () => {
  const systemLocale = getSystemLocale();
  let preferredLocale: string | null | undefined;

  try {
    const settings = await trpcClient.settings.getSettings.query();
    preferredLocale = settings?.ui?.locale;
  } catch (error) {
    console.warn(
      "Failed to load locale from settings, using system locale",
      error,
    );
  }

  const resolvedLocale = preferredLocale ?? systemLocale;
  try {
    return await initRendererI18n(resolvedLocale);
  } catch (error) {
    console.warn("Failed to initialize i18n, falling back to default", error);
    return await initRendererI18n();
  }
};

import type { ParseKeys } from "i18next";
import {
  IconSettings,
  IconMicrophone,
  IconBook,
  IconBrain,
  IconScissors,
  IconHistory,
  IconInfoCircle,
  IconKeyboard,
  IconAdjustments,
  IconFlask,
  IconNotes,
  type Icon,
} from "@tabler/icons-react";
import { APP_PAGE_ROUTES, type AppPageRoute } from "@/shared/app-routes";

export interface SettingsNavItem {
  titleKey: ParseKeys;
  url: AppPageRoute;
  descriptionKey: ParseKeys;
  icon: Icon | string;
  type: "app" | "settings";
}

export const APP_NAV_ITEMS: SettingsNavItem[] = [
  {
    titleKey: "settings.nav.notes.title",
    url: APP_PAGE_ROUTES.notes,
    descriptionKey: "settings.nav.notes.description",
    icon: IconNotes,
    type: "app",
  },
  {
    titleKey: "settings.nav.history.title",
    url: APP_PAGE_ROUTES.history,
    descriptionKey: "settings.nav.history.description",
    icon: IconHistory,
    type: "app",
  },
];

export const SETTINGS_NAV_ITEMS: SettingsNavItem[] = [
  {
    titleKey: "settings.nav.preferences.title",
    url: APP_PAGE_ROUTES.preferences,
    descriptionKey: "settings.nav.preferences.description",
    icon: IconSettings,
    type: "settings",
  },
  {
    titleKey: "settings.nav.dictation.title",
    url: APP_PAGE_ROUTES.dictation,
    descriptionKey: "settings.nav.dictation.description",
    icon: IconMicrophone,
    type: "settings",
  },
  {
    titleKey: "settings.nav.shortcuts.title",
    url: APP_PAGE_ROUTES.shortcuts,
    descriptionKey: "settings.nav.shortcuts.description",
    icon: IconKeyboard,
    type: "settings",
  },
  {
    titleKey: "settings.nav.vocabulary.title",
    url: APP_PAGE_ROUTES.vocabulary,
    descriptionKey: "settings.nav.vocabulary.description",
    icon: IconBook,
    type: "settings",
  },
  {
    titleKey: "settings.nav.snippets.title",
    url: APP_PAGE_ROUTES.snippets,
    descriptionKey: "settings.nav.snippets.description",
    icon: IconScissors,
    type: "settings",
  },
  {
    titleKey: "settings.nav.aiModels.title",
    url: APP_PAGE_ROUTES.aiModels,
    descriptionKey: "settings.nav.aiModels.description",
    icon: IconBrain,
    type: "settings",
  },
  {
    titleKey: "settings.nav.labs.title",
    url: APP_PAGE_ROUTES.labs,
    descriptionKey: "settings.nav.labs.description",
    icon: IconFlask,
    type: "settings",
  },
  {
    titleKey: "settings.nav.advanced.title",
    url: APP_PAGE_ROUTES.advanced,
    descriptionKey: "settings.nav.advanced.description",
    icon: IconAdjustments,
    type: "settings",
  },
  {
    titleKey: "settings.nav.about.title",
    url: APP_PAGE_ROUTES.about,
    descriptionKey: "settings.nav.about.description",
    icon: IconInfoCircle,
    type: "settings",
  },
];

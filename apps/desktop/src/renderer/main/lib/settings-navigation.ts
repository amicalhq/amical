import {
  IconSettings,
  IconMicrophone,
  IconBook,
  IconBrain,
  IconHistory,
  IconInfoCircle,
  IconKeyboard,
  IconAdjustments,
  IconNotes,
  type Icon,
} from "@tabler/icons-react";

export interface SettingsNavItem {
  titleKey: string;
  url: string;
  descriptionKey: string;
  icon: Icon | string;
  type: "settings";
}

export const SETTINGS_NAV_ITEMS: SettingsNavItem[] = [
  {
    titleKey: "settings.nav.notes.title",
    url: "/settings/notes",
    descriptionKey: "settings.nav.notes.description",
    icon: IconNotes,
    type: "settings",
  },
  {
    titleKey: "settings.nav.preferences.title",
    url: "/settings/preferences",
    descriptionKey: "settings.nav.preferences.description",
    icon: IconSettings,
    type: "settings",
  },
  {
    titleKey: "settings.nav.dictation.title",
    url: "/settings/dictation",
    descriptionKey: "settings.nav.dictation.description",
    icon: IconMicrophone,
    type: "settings",
  },
  {
    titleKey: "settings.nav.shortcuts.title",
    url: "/settings/shortcuts",
    descriptionKey: "settings.nav.shortcuts.description",
    icon: IconKeyboard,
    type: "settings",
  },
  {
    titleKey: "settings.nav.vocabulary.title",
    url: "/settings/vocabulary",
    descriptionKey: "settings.nav.vocabulary.description",
    icon: IconBook,
    type: "settings",
  },
  {
    titleKey: "settings.nav.aiModels.title",
    url: "/settings/ai-models",
    descriptionKey: "settings.nav.aiModels.description",
    icon: IconBrain,
    type: "settings",
  },
  {
    titleKey: "settings.nav.history.title",
    url: "/settings/history",
    descriptionKey: "settings.nav.history.description",
    icon: IconHistory,
    type: "settings",
  },
  {
    titleKey: "settings.nav.advanced.title",
    url: "/settings/advanced",
    descriptionKey: "settings.nav.advanced.description",
    icon: IconAdjustments,
    type: "settings",
  },
  {
    titleKey: "settings.nav.about.title",
    url: "/settings/about",
    descriptionKey: "settings.nav.about.description",
    icon: IconInfoCircle,
    type: "settings",
  },
];

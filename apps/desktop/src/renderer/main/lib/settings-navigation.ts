import {
  IconSettings,
  IconSparkles,
  IconBook,
  IconBrain,
  IconHistory,
  type Icon,
} from "@tabler/icons-react";

export interface SettingsNavItem {
  title: string;
  url: string;
  description: string;
  icon: Icon | string;
  type: "settings";
}

export const SETTINGS_NAV_ITEMS: SettingsNavItem[] = [
  {
    title: "Modes",
    url: "/settings/modes",
    description: "Create and manage transcription modes",
    icon: IconSparkles,
    type: "settings",
  },
  {
    title: "Vocabulary",
    url: "/settings/vocabulary",
    description: "Manage custom vocabulary and word recognition",
    icon: IconBook,
    type: "settings",
  },
  {
    title: "AI Models",
    url: "/settings/ai-models",
    description: "Configure AI models and providers",
    icon: IconBrain,
    type: "settings",
  },
  {
    title: "History",
    url: "/settings/history",
    description: "View and manage transcription history",
    icon: IconHistory,
    type: "settings",
  },
  {
    title: "Settings",
    url: "/settings/preferences",
    description: "Configure general application preferences and behavior",
    icon: IconSettings,
    type: "settings",
  },
];

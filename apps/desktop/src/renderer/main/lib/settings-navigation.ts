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
  title: string;
  url: string;
  description: string;
  icon: Icon | string;
  type: "settings";
}

export const SETTINGS_NAV_ITEMS: SettingsNavItem[] = [
  {
    title: "Notes",
    url: "/settings/notes",
    description: "Manage your notes",
    icon: IconNotes,
    type: "settings",
  },
  {
    title: "Preferences",
    url: "/settings/preferences",
    description: "Configure general application preferences and behavior",
    icon: IconSettings,
    type: "settings",
  },
  {
    title: "Dictation",
    url: "/settings/dictation",
    description: "Configure speech recognition and dictation settings",
    icon: IconMicrophone,
    type: "settings",
  },
  {
    title: "Shortcuts",
    url: "/settings/shortcuts",
    description: "Customize keyboard shortcuts and hotkeys",
    icon: IconKeyboard,
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
    title: "Advanced",
    url: "/settings/advanced",
    description: "Advanced configuration options",
    icon: IconAdjustments,
    type: "settings",
  },
  {
    title: "About",
    url: "/settings/about",
    description: "About Vox and version information",
    icon: IconInfoCircle,
    type: "settings",
  },
];

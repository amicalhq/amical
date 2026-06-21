// Presets exposed in the dropdown today. Server defines the canonical
// set; this list is just what we surface in the v1 desktop UI. New
// values added server-side won't appear here until we ship a release —
// that's intentional, the editor's preset list is curated.
export type Preset = string;

export const PRESET_OPTIONS: { value: string; label: string }[] = [
  { value: "default", label: "Default" },
  { value: "personal_messages", label: "Personal messages" },
  { value: "work_messages", label: "Work messages" },
  { value: "email", label: "Email" },
];

// Presentation axis (matches axis ToneId). Most presets expose formal /
// excited / casual; the casual-messaging preset (personal_messages) swaps
// excited for very_casual.
export type Tone = "formal" | "casual" | "excited" | "very_casual";

export const TONE_META: Record<Tone, { label: string; description: string }> = {
  formal: { label: "Formal", description: "Professional (default)" },
  excited: { label: "Excited", description: "More exclamation marks" },
  casual: { label: "Casual", description: "Less punctuation" },
  very_casual: {
    label: "Very casual",
    description: "Less punctuation & no caps",
  },
};

// Per-preset sample content shown inside the tone preview cards. The
// `surface` picks the mock chrome (email window / Slack / iMessage bubble);
// `samples` holds the per-tone output. Presets without an entry render the
// tone cards with no preview surface (label + description only).
// Surface ids mirror preset ids so the picker dispatcher and preview
// component names stay consistent with the rest of the system.
export type TonePreviewSurface =
  | "email"
  | "work_messages"
  | "personal_messages"
  | "default";

export interface TonePreviewSpec {
  surface: TonePreviewSurface;
  sender: string;
  samples: Partial<Record<Tone, string>>;
}

export const TONE_PREVIEW: Record<string, TonePreviewSpec> = {
  email: {
    surface: "email",
    sender: "Mark Watson",
    samples: {
      formal:
        "Hi Mark,\n\nHope you're doing well. I wanted to update you here. Let me know your thoughts.\n\nBest,\nAlex",
      excited:
        "Hi Mark,\n\nHope you're doing well! I wanted to update you here. Let me know your thoughts!\n\nBest,\nAlex",
      casual:
        "Hi Mark – hope you're doing well. I wanted to update you here, let me know your thoughts.\n\nBest,\nAlex",
    },
  },
  work_messages: {
    surface: "work_messages",
    sender: "Jason Kim",
    samples: {
      formal: "Hey, how's it going? Just checking in.",
      excited: "Hey! How's it going? Just checking in!",
      casual: "Hey how's it going? Just checking in",
    },
  },
  personal_messages: {
    surface: "personal_messages",
    sender: "",
    samples: {
      formal:
        "Hey, are we still on for dinner? Thinking 7 works, unless you need to change it.",
      casual:
        "Hey are we still on for dinner later? Thinking 7 works unless you need to change it",
      very_casual:
        "hey are we still on for dinner later? thinking 7 works unless u need to change it",
    },
  },
  // Catch-all "Others" preset — generic notes-style card.
  default: {
    surface: "default",
    sender: "",
    samples: {
      formal:
        "In all honesty, super excited to talk to you tomorrow. Let me know when works.",
      excited:
        "In all honesty, super excited to talk to you tomorrow. Let me know when works!",
      casual:
        "In all honesty super excited to talk to you tomorrow. Let me know when works",
    },
  },
};

export const DEFAULT_TONE: Tone = "formal";

// Tones offered for a given preset. Mirrors the per-preset tone one-shots
// defined server-side (personal_messages → formal/casual/very_casual;
// all other presets → formal/excited/casual).
export const tonesForPreset = (preset: string | null | undefined): Tone[] =>
  preset === "personal_messages"
    ? ["formal", "casual", "very_casual"]
    : ["formal", "excited", "casual"];

// The app/site catalog (constants, lookups, app->preset resolution) lives in
// @/shared/app-catalog. Re-exported here so existing settings-UI imports keep
// resolving through ./catalog.
export {
  APP_CATALOG,
  SITE_CATALOG,
  targetById,
  normalizeHostname,
} from "@/shared/app-catalog";
export type { TargetMeta } from "@/shared/app-catalog";

export type SkillMode = "preset" | "custom";

// Structural shape consumed by the row component. The DB-backed
// ResolvedSkill from db/skills.ts satisfies this without casts: nulls
// in the list columns are resolved to app-defined defaults, and the
// isUsingDefault* flags surface whether the user has customized.
export type SkillSnapshot = {
  id: string;
  name: string;
  mode: SkillMode;
  preset: string | null;
  prompt: string | null;
  tone: string | null;
  includedApps: string[];
  includedSites: string[];
  isUsingDefaultApps: boolean;
  isUsingDefaultSites: boolean;
  isDefault: boolean;
  isBuiltIn: boolean;
};

// Body the editor emits on save — strips read-only metadata so the
// page can hand it straight to the create/update mutations. Mirrors
// the DB CHECK constraint at the type level: only one of preset/prompt
// is set, based on mode.
export type SkillEdit = {
  id: string;
  name: string;
  mode: SkillMode;
  preset: string | null;
  prompt: string | null;
  tone: Tone | null;
  includedApps: string[];
  includedSites: string[];
};

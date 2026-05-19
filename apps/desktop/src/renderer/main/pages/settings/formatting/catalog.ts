// Presets exposed in the dropdown today. Server defines the canonical
// set; this list is just what we surface in the v1 desktop UI. New
// values added server-side won't appear here until we ship a release —
// that's intentional, the editor's preset list is curated.
export type Preset = string;

export const PRESET_OPTIONS: { value: string; label: string }[] = [
  { value: "default", label: "Default" },
  { value: "personal_chat", label: "Personal chat" },
  { value: "work_chat", label: "Work chat" },
  { value: "email", label: "Email" },
];

export type Polishing = "none" | "low" | "normal" | "high";

export const POLISHING_OPTIONS: { value: Polishing; label: string }[] = [
  { value: "none", label: "None" },
  { value: "low", label: "Low" },
  { value: "normal", label: "Normal" },
  { value: "high", label: "High" },
];

export type Tone = "casual" | "formal";

export const TONE_OPTIONS: { value: Tone; label: string }[] = [
  { value: "casual", label: "Casual" },
  { value: "formal", label: "Formal" },
];

// IDs stored on skills. Open-ended string — the catalogs below are
// just the curated picker lists, but users can have any id stored
// (manually-added bundle/AUMID/exe values for apps, or any hostname
// for sites).
export type AppId = string;

export type TargetMeta = { id: string; name: string; emoji: string };

// Curated list of native apps for the picker. The id is the value we
// store on the skill — eventually this becomes a real bundle id /
// AUMID once enumeration ships; for now we use short slugs.
export const APP_CATALOG: TargetMeta[] = [
  { id: "slack", name: "Slack", emoji: "💬" },
  { id: "linear", name: "Linear", emoji: "📋" },
  { id: "cursor", name: "Cursor", emoji: "🧠" },
  { id: "notion", name: "Notion", emoji: "📝" },
  { id: "imessage", name: "iMessage", emoji: "💭" },
  { id: "apple-mail", name: "Apple Mail", emoji: "📮" },
  { id: "outlook", name: "Outlook", emoji: "📧" },
  { id: "spark", name: "Spark", emoji: "⚡" },
  { id: "whatsapp", name: "WhatsApp", emoji: "🟢" },
  { id: "discord", name: "Discord", emoji: "🎮" },
  { id: "superhuman", name: "Superhuman", emoji: "🦸" },
];

// Curated list of websites for the picker. The id is the hostname we
// match against the browser tab URL at dictation time. v1: exact
// hostname match.
export const SITE_CATALOG: TargetMeta[] = [
  { id: "mail.google.com", name: "Gmail (web)", emoji: "✉️" },
  { id: "outlook.live.com", name: "Outlook (web)", emoji: "📧" },
  { id: "outlook.office.com", name: "Outlook 365 (web)", emoji: "📧" },
  { id: "app.slack.com", name: "Slack (web)", emoji: "💬" },
  { id: "linear.app", name: "Linear (web)", emoji: "📋" },
  { id: "www.notion.so", name: "Notion (web)", emoji: "📝" },
  { id: "web.whatsapp.com", name: "WhatsApp (web)", emoji: "🟢" },
  { id: "discord.com", name: "Discord (web)", emoji: "🎮" },
  { id: "x.com", name: "X / Twitter", emoji: "🐦" },
  { id: "github.com", name: "GitHub", emoji: "🐙" },
];

export const appById = (id: string): TargetMeta | undefined =>
  APP_CATALOG.find((a) => a.id === id);

export const siteById = (id: string): TargetMeta | undefined =>
  SITE_CATALOG.find((s) => s.id === id);

// Look up an id in either catalog; falls back to a synthetic entry so
// unknown / manually-added ids still render with a sane label. The
// fallback heuristic: an id that looks like a hostname (contains a dot,
// no spaces) renders with a globe emoji; everything else gets a box.
export const targetById = (id: string): TargetMeta => {
  const known = appById(id) ?? siteById(id);
  if (known) return known;
  const looksLikeHostname = id.includes(".") && !/\s/.test(id);
  return { id, name: id, emoji: looksLikeHostname ? "🌐" : "📦" };
};

// Normalize user-typed website input. Returns null if the input
// doesn't look like a hostname; otherwise the canonical form we'll
// store (lowercase, no protocol, no path/query/fragment).
export const normalizeHostname = (raw: string): string | null => {
  let v = raw.trim().toLowerCase();
  if (!v) return null;
  v = v.replace(/^https?:\/\//, "");
  v = v.split("/")[0] ?? v;
  v = v.split("?")[0] ?? v;
  v = v.split("#")[0] ?? v;
  if (!v.includes(".") || /\s/.test(v)) return null;
  return v;
};

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
  polishing: string | null;
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
  polishing: Polishing | null;
  tone: Tone | null;
  includedApps: string[];
  includedSites: string[];
};

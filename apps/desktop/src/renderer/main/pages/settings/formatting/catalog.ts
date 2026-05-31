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

// IDs stored on skills. Open-ended string — the catalogs below are
// just the curated picker lists, but users can have any id stored
// (manually-added bundle/AUMID/exe values for apps, or any hostname
// for sites).
export type AppId = string;

// `bundleIds` holds the real reverse-DNS Apple bundle identifiers a skill
// matches against the foreground app's `appBundleId` (macOS today; iOS
// shares the same scheme). An app can have several (store vs. direct
// build, app variants), so it's a list. Sites match by hostname instead,
// so SITE_CATALOG entries leave this unset. Sourced from production
// telemetry (zeus/amical/references/dictation-context-apps-and-domains.md)
// and an external app-mappings reference.
export type TargetMeta = {
  id: string;
  name: string;
  emoji?: string;
  bundleIds?: string[];
};

// Curated list of native apps for the picker. `id` is the stable slug we
// store on the skill (and reference from SEED_APP_DEFAULTS); `bundleIds`
// are the real Apple bundle identifiers we match the foreground app
// against. Windows EXE matching (AUMID / basename) is a separate channel
// added later — these are the Apple-side identifiers only.
export const APP_CATALOG: TargetMeta[] = [
  {
    id: "slack",
    name: "Slack",
    emoji: "💬",
    bundleIds: ["com.tinyspeck.slackmacgap"],
  },
  { id: "linear", name: "Linear", emoji: "📋", bundleIds: ["com.linear"] },
  { id: "cursor", name: "Cursor", emoji: "🧠", bundleIds: ["com.todesktop.230313mzl4w4u92"] },
  { id: "notion", name: "Notion", emoji: "📝", bundleIds: ["notion.id"] },
  { id: "imessage", name: "iMessage", emoji: "💭", bundleIds: ["com.apple.MobileSMS"] },
  { id: "apple-mail", name: "Apple Mail", emoji: "📮", bundleIds: ["com.apple.mail"] },
  { id: "outlook", name: "Outlook", emoji: "📧", bundleIds: ["com.microsoft.Outlook"] },
  {
    id: "spark",
    name: "Spark",
    emoji: "⚡",
    bundleIds: [
      "com.readdle.smartemail-Mac",
      "com.readdle.SparkDesktop",
      "com.readdle.SparkDesktop.appstore",
    ],
  },
  { id: "whatsapp", name: "WhatsApp", emoji: "🟢", bundleIds: ["net.whatsapp.WhatsApp"] },
  {
    id: "discord",
    name: "Discord",
    emoji: "🎮",
    bundleIds: ["com.hnc.Discord"],
  },
  { id: "superhuman", name: "Superhuman", emoji: "🦸", bundleIds: ["com.superhuman.electron"] },
  // --- Imported from an external app-mappings reference, bundle IDs
  // verbatim; slugs derived from the app name; emoji omitted (the picker
  // falls back via targetById). ---
  { id: "google-chrome", name: "Google Chrome", bundleIds: ["com.google.Chrome"] },
  { id: "chatgpt", name: "ChatGPT", bundleIds: ["com.openai.chat", "com.google.Chrome.app.cadlkienfkclaiaibeoongdcgmdikeeg", "com.microsoft.edgemac.app.cadlkienfkclaiaibeoongdcgmdikeeg", "com.google.Chrome.app.ganbajppaokgbfcobnjemmjhmmlfccig"] },
  { id: "arc", name: "Arc", bundleIds: ["company.thebrowser.Browser"] },
  { id: "claude", name: "Claude", bundleIds: ["com.anthropic.claudefordesktop", "com.google.Chrome.app.fmpnliohjhemenmnlpbfagaolkdacoja"] },
  { id: "safari", name: "Safari", bundleIds: ["com.apple.Safari"] },
  { id: "windsurf", name: "Windsurf", bundleIds: ["com.exafunction.windsurf"] },
  { id: "brave-browser", name: "Brave Browser", bundleIds: ["com.brave.Browser"] },
  { id: "apple-notes", name: "Apple Notes", bundleIds: ["com.apple.Notes"] },
  { id: "telegram", name: "Telegram", bundleIds: ["ru.keepcoder.Telegram", "com.tdesktop.Telegram"] },
  { id: "microsoft-word", name: "Microsoft Word", bundleIds: ["com.microsoft.Word"] },
  { id: "perplexity", name: "Perplexity", bundleIds: ["ai.perplexity.mac", "ai.perplexity.macv3"] },
  { id: "vs-code", name: "VS Code", bundleIds: ["com.microsoft.VSCode"] },
  { id: "firefox", name: "Firefox", bundleIds: ["org.mozilla.firefox"] },
  { id: "microsoft-teams", name: "Microsoft Teams", bundleIds: ["com.microsoft.teams", "com.microsoft.teams2"] },
  { id: "zoom", name: "Zoom", bundleIds: ["us.zoom.xos"] },
  { id: "terminal", name: "Terminal", bundleIds: ["com.apple.Terminal"] },
  { id: "microsoft-excel", name: "Microsoft Excel", bundleIds: ["com.microsoft.Excel"] },
  { id: "microsoft-powerpoint", name: "Microsoft PowerPoint", bundleIds: ["com.microsoft.Powerpoint"] },
  { id: "obsidian", name: "Obsidian", bundleIds: ["md.obsidian"] },
  { id: "figma", name: "Figma", bundleIds: ["com.figma.Desktop"] },
  { id: "microsoft-onenote", name: "Microsoft OneNote", bundleIds: ["com.microsoft.onenote.mac"] },
  { id: "asana", name: "Asana", bundleIds: ["com.electron.asana"] },
  { id: "clickup", name: "ClickUp", bundleIds: ["com.clickup.desktop-app"] },
  { id: "miro", name: "Miro", bundleIds: ["com.electron.realtimeboard"] },
  { id: "airtable", name: "Airtable", bundleIds: ["com.FormaGrid.Airtable"] },
  { id: "intellij-idea", name: "IntelliJ IDEA", bundleIds: ["com.jetbrains.intellij"] },
  { id: "deepl", name: "DeepL", bundleIds: ["com.linguee.DeepLCopyTranslator"] },
  { id: "kindle", name: "Kindle", bundleIds: ["com.amazon.Kindle"] },
  { id: "spotify", name: "Spotify", bundleIds: ["com.spotify.client"] },
  { id: "grammarly", name: "Grammarly", bundleIds: ["com.grammarly.ProjectLlama"] },
  { id: "shortwave", name: "Shortwave", bundleIds: ["com.electron.shortwave", "com.google.Chrome.app.lnachpgegbbmnnlgpokibfjlmppeciah"] },
  { id: "poe", name: "Poe", bundleIds: ["com.quora.poe.electron"] },
  { id: "raycast", name: "Raycast", bundleIds: ["com.raycast.macos"] },
  { id: "trae", name: "Trae", bundleIds: ["com.trae.app"] },
  { id: "warp", name: "Warp", bundleIds: ["dev.warp.Warp-Stable"] },
  { id: "beeper", name: "Beeper", bundleIds: ["com.automattic.beeper.desktop"] },
  { id: "code-insiders", name: "Code - Insiders", bundleIds: ["com.microsoft.VSCodeInsiders"] },
  { id: "pages", name: "Pages", bundleIds: ["com.apple.iWork.Pages"] },
  { id: "vivaldi", name: "Vivaldi", bundleIds: ["com.vivaldi.Vivaldi"] },
  { id: "sublime-text", name: "Sublime Text", bundleIds: ["com.sublimetext.4", "com.sublimetext.3"] },
  { id: "google-chat", name: "Google Chat", bundleIds: ["com.google.Chrome.app.mdpkiolbdkhdjpekfbkbmhigcaggjagi"] },
  { id: "sidekick", name: "Sidekick", bundleIds: ["com.pushplaylabs.sidekick"] },
  { id: "scrivener", name: "Scrivener", bundleIds: ["com.literatureandlatte.scrivener3"] },
  { id: "bear", name: "Bear", bundleIds: ["net.shinyfrog.bear"] },
  { id: "opera", name: "Opera", bundleIds: ["com.operasoftware.Opera"] },
  { id: "citrix-viewer", name: "Citrix Viewer", bundleIds: ["com.citrix.receiver.icaviewer.mac"] },
  { id: "reflect", name: "Reflect", bundleIds: ["app.reflect.ReflectDesktop"] },
  { id: "anki", name: "Anki", bundleIds: ["net.ankiweb.dtop"] },
  { id: "heptabase", name: "Heptabase", bundleIds: ["app.projectmeta.projectmeta"] },
  { id: "airmail", name: "Airmail", bundleIds: ["it.bloop.airmail2"] },
  { id: "drafts", name: "Drafts", bundleIds: ["com.agiletortoise.Drafts-OSX"] },
  { id: "mimestream", name: "Mimestream", bundleIds: ["com.mimestream.Mimestream"] },
  { id: "texts", name: "Texts", bundleIds: ["com.texts.Texts"] },
  { id: "mailmate", name: "MailMate", bundleIds: ["com.freron.MailMate"] },
  { id: "line", name: "Line", bundleIds: ["jp.naver.line.mac"] },
  { id: "missive", name: "Missive", bundleIds: ["com.missiveapp.osx"] },
  { id: "bbedit", name: "BBEdit", bundleIds: ["com.barebones.bbedit"] },
  { id: "workflowy", name: "WorkFlowy", bundleIds: ["com.workflowy.desktop"] },
  { id: "lark", name: "Lark", bundleIds: ["com.electron.lark"] },
  { id: "todoist", name: "Todoist", bundleIds: ["com.todoist.mac.Todoist"] },
  { id: "bitwarden", name: "Bitwarden", bundleIds: ["com.bitwarden.desktop"] },
  { id: "ia-writer", name: "iA Writer", bundleIds: ["pro.writer.mac"] },
  { id: "dbeaver", name: "DBeaver", bundleIds: ["org.jkiss.dbeaver.core.product"] },
  { id: "postico", name: "Postico", bundleIds: ["at.eggerapps.Postico"] },
  { id: "datagrip", name: "DataGrip", bundleIds: ["com.jetbrains.datagrip"] },
  { id: "pycharm", name: "PyCharm", bundleIds: ["com.jetbrains.pycharm"] },
  { id: "webstorm", name: "WebStorm", bundleIds: ["com.jetbrains.WebStorm"] },
  { id: "tableplus", name: "TablePlus", bundleIds: ["com.tinyapp.TablePlus"] },
  { id: "rubymine", name: "RubyMine", bundleIds: ["com.jetbrains.rubymine"] },
  { id: "affinity-designer", name: "Affinity Designer", bundleIds: ["com.seriflabs.affinitydesigner"] },
  { id: "affinity-photo", name: "Affinity Photo", bundleIds: ["com.seriflabs.affinityphoto"] },
  { id: "affinity-publisher", name: "Affinity Publisher", bundleIds: ["com.seriflabs.affinitypublisher"] },
  { id: "sketch", name: "Sketch", bundleIds: ["com.bohemiancoding.sketch3"] },
  { id: "numbers", name: "Numbers", bundleIds: ["com.apple.iWork.Numbers"] },
  { id: "keynote", name: "Keynote", bundleIds: ["com.apple.iWork.Keynote"] },
  { id: "gimp", name: "GIMP", bundleIds: ["org.gimp.gimp-2.10"] },
  { id: "logseq", name: "LogSeq", bundleIds: ["com.electron.logseq"] },
  { id: "screenflow", name: "Screenflow", bundleIds: ["net.telestream.screenflow9"] },
  { id: "tailscale", name: "Tailscale", bundleIds: ["io.tailscale.ipn.macsys"] },
  { id: "insomnia", name: "Insomnia", bundleIds: ["com.insomnia.app"] },
  { id: "signal", name: "Signal", bundleIds: ["org.whispersystems.signal-desktop"] },
  { id: "protonmail", name: "ProtonMail", bundleIds: ["ch.protonmail.desktop"] },
  { id: "things", name: "Things", bundleIds: ["com.culturedcode.ThingsMac"] },
  { id: "final-cut-pro", name: "Final Cut Pro", bundleIds: ["com.apple.FinalCut"] },
  { id: "xcode", name: "Xcode", bundleIds: ["com.apple.dt.Xcode"] },
  { id: "cleanshot-x", name: "CleanShot X", bundleIds: ["pl.maketheweb.cleanshotx"] },
  { id: "obs-studio", name: "OBS Studio", bundleIds: ["com.obsproject.obs-studio"] },
  { id: "wechat", name: "WeChat", bundleIds: ["com.tencent.xinWeChat"] },
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
  // --- Web apps from an external app-mappings reference (url-only entries). ---
  { id: "docs.google.com", name: "Google Docs" },
  { id: "gemini.google.com", name: "Google Gemini" },
  { id: "replit.com", name: "Replit" },
  { id: "calendar.google.com", name: "Google Calendar" },
  { id: "meet.google.com", name: "Google Meet" },
  { id: "drive.google.com", name: "Google Drive" },
  { id: "messenger.com", name: "Messenger" },
  { id: "trello.com", name: "Trello" },
  { id: "linkedin.com", name: "LinkedIn" },
  { id: "instagram.com", name: "Instagram" },
  { id: "facebook.com", name: "Facebook" },
  { id: "reddit.com", name: "Reddit" },
  { id: "youtube.com", name: "YouTube" },
  { id: "canva.com", name: "Canva" },
  { id: "colab.research.google.com", name: "Google Colab" },
  { id: "v0.dev", name: "v0.dev" },
  { id: "bolt.new", name: "Bolt" },
  { id: "vercel.com", name: "Vercel" },
  { id: "gitlab.com", name: "GitLab" },
  { id: "app.intercom.com", name: "Intercom" },
  { id: "chat.deepseek.com", name: "DeepSeek" },
  { id: "chat.mistral.ai", name: "Mistral AI" },
  { id: "remotedesktop.google.com", name: "Chrome Remote Desktop" },
  { id: "calendly.com", name: "Calendly" },
  { id: "app.fastmail.com", name: "Fastmail" },
  { id: "coda.io", name: "Coda" },
  { id: "netflix.com", name: "Netflix" },
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
  const looksLikeHostname = id.includes(".") && !/\s/.test(id);
  const fallbackEmoji = looksLikeHostname ? "🌐" : "📦";
  if (known) return known.emoji ? known : { ...known, emoji: fallbackEmoji };
  return { id, name: id, emoji: fallbackEmoji };
};

// Default formatting preset for the foreground app, keyed by preset id
// (matching axis PresetId). App slugs reference APP_CATALOG, which holds
// the validated bundle ids — single source of truth. Apps absent here
// resolve to "default". Categorisation: messaging/email from an external
// per-app classification; all IDEs/code editors are
// mapped to "ai" per product decision. Doc apps split by markdown support:
// "markdown_notes" for apps that render markdown (Notion, Obsidian, Linear,
// WorkFlowy) vs "notes" for rich-text apps that show markdown syntax
// literally (Word, Pages, OneNote, Apple Notes). Spreadsheets, slide decks,
// design canvases, and non-text tools are intentionally omitted (-> default).
export type PresetId =
  | "default"
  | "email"
  | "personal_messages"
  | "work_messages"
  | "notes"
  | "markdown_notes"
  | "ai";

export const PRESET_APP_DEFAULTS: Partial<Record<PresetId, string[]>> = {
  work_messages: ["slack", "microsoft-teams", "zoom", "google-chat", "lark"],
  personal_messages: ["imessage", "whatsapp", "discord", "telegram", "beeper", "texts", "signal", "wechat"],
  email: ["apple-mail", "outlook", "spark", "superhuman", "shortwave", "airmail", "mimestream", "protonmail"],
  markdown_notes: ["notion", "obsidian", "linear", "workflowy"],
  notes: ["apple-notes", "microsoft-word", "microsoft-onenote", "pages"],
  ai: ["cursor", "chatgpt", "claude", "windsurf", "perplexity", "vs-code", "intellij-idea", "warp", "code-insiders", "sublime-text", "bbedit", "dbeaver", "datagrip", "pycharm", "webstorm", "rubymine", "xcode"],
};

// Flat foreground-bundle-id -> preset lookup, derived from the slug groups
// above by expanding each app's APP_CATALOG bundleIds. Unknown apps -> "default".
const BUNDLE_ID_TO_PRESET: Map<string, PresetId> = (() => {
  const m = new Map<string, PresetId>();
  for (const [preset, slugs] of Object.entries(PRESET_APP_DEFAULTS)) {
    for (const slug of slugs ?? []) {
      for (const bundleId of appById(slug)?.bundleIds ?? []) {
        m.set(bundleId, preset as PresetId);
      }
    }
  }
  return m;
})();

export const resolvePresetForBundleId = (appBundleId?: string | null): PresetId =>
  (appBundleId ? BUNDLE_ID_TO_PRESET.get(appBundleId) : undefined) ?? "default";

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

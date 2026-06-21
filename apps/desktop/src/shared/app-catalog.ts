// App/site catalog: curated constant data (APP_CATALOG, SITE_CATALOG), the
// foreground-app identity lookups, and app->preset resolution. Pure data +
// functions with no renderer/main-only deps, so both the settings UI (via
// catalog.ts re-exports) and the main-process pipeline can import it.

// IDs stored on skills. Open-ended string — the catalogs below are
// just the curated picker lists, but users can have any id stored
// (manually-added bundle/AUMID/exe values for apps, or any hostname
// for sites).
export type AppId = string;

// `bundleIds` holds the real reverse-DNS Apple bundle identifiers a skill
// matches against the foreground app's `appBundleId` on macOS/iOS.
// `processName` holds Windows Process.ProcessName values (basename, no
// .exe) for the same app. Apps can have several variants, so both are lists.
// Sites match by hostname instead, so SITE_CATALOG entries leave these unset.
// Sourced from production telemetry and an external app-mappings reference.
export type TargetMeta = {
  id: string;
  name: string;
  emoji?: string;
  bundleIds?: string[];
  processName?: string[];
};

// Curated list of native apps for the picker. `id` is the stable slug we
// store on the skill (and reference from SEED_APP_DEFAULTS); `bundleIds`
// and `processName` are the platform identifiers we match the foreground
// app against.
export const APP_CATALOG: TargetMeta[] = [
  {
    id: "slack",
    name: "Slack",
    emoji: "💬",
    bundleIds: ["com.tinyspeck.slackmacgap"],
    processName: ["slack"],
  },
  {
    id: "linear",
    name: "Linear",
    emoji: "📋",
    bundleIds: ["com.linear"],
    processName: ["linear"],
  },
  {
    id: "cursor",
    name: "Cursor",
    emoji: "🧠",
    bundleIds: ["com.todesktop.230313mzl4w4u92"],
    processName: ["cursor"],
  },
  {
    id: "notion",
    name: "Notion",
    emoji: "📝",
    bundleIds: ["notion.id"],
    processName: ["notion"],
  },
  {
    id: "imessage",
    name: "iMessage",
    emoji: "💭",
    bundleIds: ["com.apple.MobileSMS"],
    processName: ["messages"],
  },
  {
    id: "apple-mail",
    name: "Apple Mail",
    emoji: "📮",
    bundleIds: ["com.apple.mail"],
    processName: ["mail"],
  },
  {
    id: "outlook",
    name: "Outlook",
    emoji: "📧",
    bundleIds: ["com.microsoft.Outlook"],
    processName: ["outlook", "olk", "microsoft outlook"],
  },
  {
    id: "spark",
    name: "Spark",
    emoji: "⚡",
    bundleIds: [
      "com.readdle.smartemail-Mac",
      "com.readdle.SparkDesktop",
      "com.readdle.SparkDesktop.appstore",
    ],
    processName: ["spark", "spark mail", "spark desktop"],
  },
  {
    id: "whatsapp",
    name: "WhatsApp",
    emoji: "🟢",
    bundleIds: ["net.whatsapp.WhatsApp"],
    processName: ["whatsapp"],
  },
  {
    id: "discord",
    name: "Discord",
    emoji: "🎮",
    bundleIds: ["com.hnc.Discord"],
    processName: ["discord"],
  },
  {
    id: "superhuman",
    name: "Superhuman",
    emoji: "🦸",
    bundleIds: ["com.superhuman.electron"],
    processName: ["superhuman"],
  },
  // --- Imported from an external app-mappings reference, bundle IDs
  // verbatim; slugs derived from the app name; emoji omitted (the picker
  // falls back via targetById). ---
  {
    id: "google-chrome",
    name: "Google Chrome",
    bundleIds: ["com.google.Chrome"],
    processName: ["chrome", "google chrome"],
  },
  {
    id: "chatgpt",
    name: "ChatGPT",
    bundleIds: [
      "com.openai.chat",
      "com.google.Chrome.app.cadlkienfkclaiaibeoongdcgmdikeeg",
      "com.microsoft.edgemac.app.cadlkienfkclaiaibeoongdcgmdikeeg",
      "com.google.Chrome.app.ganbajppaokgbfcobnjemmjhmmlfccig",
    ],
    processName: ["chatgpt"],
  },
  {
    id: "arc",
    name: "Arc",
    bundleIds: ["company.thebrowser.Browser"],
    processName: ["arc"],
  },
  {
    id: "claude",
    name: "Claude",
    bundleIds: [
      "com.anthropic.claudefordesktop",
      "com.google.Chrome.app.fmpnliohjhemenmnlpbfagaolkdacoja",
    ],
    processName: ["claude"],
  },
  {
    id: "safari",
    name: "Safari",
    bundleIds: ["com.apple.Safari"],
    processName: ["safari"],
  },
  {
    id: "windsurf",
    name: "Windsurf",
    bundleIds: ["com.exafunction.windsurf"],
    processName: ["windsurf"],
  },
  {
    id: "brave-browser",
    name: "Brave Browser",
    bundleIds: ["com.brave.Browser"],
    processName: ["brave", "brave browser"],
  },
  {
    id: "apple-notes",
    name: "Apple Notes",
    bundleIds: ["com.apple.Notes"],
    processName: ["notes"],
  },
  {
    id: "telegram",
    name: "Telegram",
    bundleIds: ["ru.keepcoder.Telegram", "com.tdesktop.Telegram"],
    processName: ["telegram"],
  },
  {
    id: "microsoft-word",
    name: "Microsoft Word",
    bundleIds: ["com.microsoft.Word"],
    processName: ["winword", "microsoft word"],
  },
  {
    id: "perplexity",
    name: "Perplexity",
    bundleIds: ["ai.perplexity.mac", "ai.perplexity.macv3"],
    processName: ["perplexity"],
  },
  {
    id: "vs-code",
    name: "VS Code",
    bundleIds: ["com.microsoft.VSCode"],
    processName: ["code"],
  },
  {
    id: "firefox",
    name: "Firefox",
    bundleIds: ["org.mozilla.firefox"],
    processName: ["firefox"],
  },
  {
    id: "microsoft-teams",
    name: "Microsoft Teams",
    bundleIds: ["com.microsoft.teams", "com.microsoft.teams2"],
    processName: ["ms-teams", "msteams", "microsoft teams"],
  },
  {
    id: "zoom",
    name: "Zoom",
    bundleIds: ["us.zoom.xos"],
    processName: ["zoom"],
  },
  {
    id: "terminal",
    name: "Terminal",
    bundleIds: ["com.apple.Terminal"],
    processName: ["windowsterminal", "cmd", "powershell", "pwsh"],
  },
  {
    id: "microsoft-excel",
    name: "Microsoft Excel",
    bundleIds: ["com.microsoft.Excel"],
    processName: ["excel", "microsoft excel"],
  },
  {
    id: "microsoft-powerpoint",
    name: "Microsoft PowerPoint",
    bundleIds: ["com.microsoft.Powerpoint"],
    processName: ["powerpnt", "microsoft powerpoint"],
  },
  {
    id: "obsidian",
    name: "Obsidian",
    bundleIds: ["md.obsidian"],
    processName: ["obsidian"],
  },
  {
    id: "figma",
    name: "Figma",
    bundleIds: ["com.figma.Desktop"],
    processName: ["figma"],
  },
  {
    id: "microsoft-onenote",
    name: "Microsoft OneNote",
    bundleIds: ["com.microsoft.onenote.mac"],
    processName: ["onenote", "microsoft onenote"],
  },
  {
    id: "asana",
    name: "Asana",
    bundleIds: ["com.electron.asana"],
    processName: ["asana"],
  },
  {
    id: "clickup",
    name: "ClickUp",
    bundleIds: ["com.clickup.desktop-app"],
    processName: ["clickup"],
  },
  {
    id: "miro",
    name: "Miro",
    bundleIds: ["com.electron.realtimeboard"],
    processName: ["miro"],
  },
  {
    id: "airtable",
    name: "Airtable",
    bundleIds: ["com.FormaGrid.Airtable"],
    processName: ["airtable"],
  },
  {
    id: "intellij-idea",
    name: "IntelliJ IDEA",
    bundleIds: ["com.jetbrains.intellij"],
    processName: ["intellij idea", "idea64"],
  },
  {
    id: "deepl",
    name: "DeepL",
    bundleIds: ["com.linguee.DeepLCopyTranslator"],
    processName: ["deepl"],
  },
  { id: "kindle", name: "Kindle", bundleIds: ["com.amazon.Kindle"] },
  { id: "spotify", name: "Spotify", bundleIds: ["com.spotify.client"] },
  {
    id: "grammarly",
    name: "Grammarly",
    bundleIds: ["com.grammarly.ProjectLlama"],
  },
  {
    id: "shortwave",
    name: "Shortwave",
    bundleIds: [
      "com.electron.shortwave",
      "com.google.Chrome.app.lnachpgegbbmnnlgpokibfjlmppeciah",
    ],
    processName: ["shortwave"],
  },
  { id: "poe", name: "Poe", bundleIds: ["com.quora.poe.electron"] },
  { id: "raycast", name: "Raycast", bundleIds: ["com.raycast.macos"] },
  {
    id: "trae",
    name: "Trae",
    bundleIds: ["com.trae.app"],
    processName: ["trae"],
  },
  {
    id: "warp",
    name: "Warp",
    bundleIds: ["dev.warp.Warp-Stable"],
    processName: ["warp"],
  },
  {
    id: "beeper",
    name: "Beeper",
    bundleIds: ["com.automattic.beeper.desktop"],
    processName: ["beeper"],
  },
  {
    id: "code-insiders",
    name: "Code - Insiders",
    bundleIds: ["com.microsoft.VSCodeInsiders"],
    processName: ["code - insiders"],
  },
  {
    id: "pages",
    name: "Pages",
    bundleIds: ["com.apple.iWork.Pages"],
    processName: ["pages"],
  },
  {
    id: "vivaldi",
    name: "Vivaldi",
    bundleIds: ["com.vivaldi.Vivaldi"],
    processName: ["vivaldi"],
  },
  {
    id: "sublime-text",
    name: "Sublime Text",
    bundleIds: ["com.sublimetext.4", "com.sublimetext.3"],
    processName: ["sublime text"],
  },
  {
    id: "google-chat",
    name: "Google Chat",
    bundleIds: ["com.google.Chrome.app.mdpkiolbdkhdjpekfbkbmhigcaggjagi"],
    processName: ["google chat"],
  },
  {
    id: "sidekick",
    name: "Sidekick",
    bundleIds: ["com.pushplaylabs.sidekick"],
  },
  {
    id: "scrivener",
    name: "Scrivener",
    bundleIds: ["com.literatureandlatte.scrivener3"],
    processName: ["scrivener"],
  },
  {
    id: "bear",
    name: "Bear",
    bundleIds: ["net.shinyfrog.bear"],
    processName: ["bear"],
  },
  {
    id: "opera",
    name: "Opera",
    bundleIds: ["com.operasoftware.Opera"],
    processName: ["opera"],
  },
  {
    id: "citrix-viewer",
    name: "Citrix Viewer",
    bundleIds: ["com.citrix.receiver.icaviewer.mac"],
  },
  { id: "reflect", name: "Reflect", bundleIds: ["app.reflect.ReflectDesktop"] },
  { id: "anki", name: "Anki", bundleIds: ["net.ankiweb.dtop"] },
  {
    id: "heptabase",
    name: "Heptabase",
    bundleIds: ["app.projectmeta.projectmeta"],
    processName: ["heptabase"],
  },
  {
    id: "airmail",
    name: "Airmail",
    bundleIds: ["it.bloop.airmail2"],
    processName: ["airmail"],
  },
  {
    id: "drafts",
    name: "Drafts",
    bundleIds: ["com.agiletortoise.Drafts-OSX"],
    processName: ["drafts"],
  },
  {
    id: "mimestream",
    name: "Mimestream",
    bundleIds: ["com.mimestream.Mimestream"],
    processName: ["mimestream"],
  },
  {
    id: "texts",
    name: "Texts",
    bundleIds: ["com.texts.Texts"],
    processName: ["texts"],
  },
  { id: "mailmate", name: "MailMate", bundleIds: ["com.freron.MailMate"] },
  { id: "line", name: "Line", bundleIds: ["jp.naver.line.mac"] },
  {
    id: "missive",
    name: "Missive",
    bundleIds: ["com.missiveapp.osx"],
    processName: ["missive"],
  },
  {
    id: "bbedit",
    name: "BBEdit",
    bundleIds: ["com.barebones.bbedit"],
    processName: ["bbedit"],
  },
  {
    id: "workflowy",
    name: "WorkFlowy",
    bundleIds: ["com.workflowy.desktop"],
    processName: ["workflowy"],
  },
  {
    id: "lark",
    name: "Lark",
    bundleIds: ["com.electron.lark"],
    processName: ["lark"],
  },
  {
    id: "todoist",
    name: "Todoist",
    bundleIds: ["com.todoist.mac.Todoist"],
    processName: ["todoist"],
  },
  { id: "bitwarden", name: "Bitwarden", bundleIds: ["com.bitwarden.desktop"] },
  {
    id: "ia-writer",
    name: "iA Writer",
    bundleIds: ["pro.writer.mac"],
    processName: ["ia writer"],
  },
  {
    id: "dbeaver",
    name: "DBeaver",
    bundleIds: ["org.jkiss.dbeaver.core.product"],
    processName: ["dbeaver"],
  },
  { id: "postico", name: "Postico", bundleIds: ["at.eggerapps.Postico"] },
  { id: "datagrip", name: "DataGrip", bundleIds: ["com.jetbrains.datagrip"] },
  {
    id: "pycharm",
    name: "PyCharm",
    bundleIds: ["com.jetbrains.pycharm"],
    processName: ["pycharm"],
  },
  {
    id: "webstorm",
    name: "WebStorm",
    bundleIds: ["com.jetbrains.WebStorm"],
    processName: ["webstorm"],
  },
  { id: "tableplus", name: "TablePlus", bundleIds: ["com.tinyapp.TablePlus"] },
  {
    id: "rubymine",
    name: "RubyMine",
    bundleIds: ["com.jetbrains.rubymine"],
    processName: ["rubymine"],
  },
  {
    id: "affinity-designer",
    name: "Affinity Designer",
    bundleIds: ["com.seriflabs.affinitydesigner"],
  },
  {
    id: "affinity-photo",
    name: "Affinity Photo",
    bundleIds: ["com.seriflabs.affinityphoto"],
  },
  {
    id: "affinity-publisher",
    name: "Affinity Publisher",
    bundleIds: ["com.seriflabs.affinitypublisher"],
  },
  { id: "sketch", name: "Sketch", bundleIds: ["com.bohemiancoding.sketch3"] },
  { id: "numbers", name: "Numbers", bundleIds: ["com.apple.iWork.Numbers"] },
  { id: "keynote", name: "Keynote", bundleIds: ["com.apple.iWork.Keynote"] },
  { id: "gimp", name: "GIMP", bundleIds: ["org.gimp.gimp-2.10"] },
  {
    id: "logseq",
    name: "LogSeq",
    bundleIds: ["com.electron.logseq"],
    processName: ["logseq"],
  },
  {
    id: "screenflow",
    name: "Screenflow",
    bundleIds: ["net.telestream.screenflow9"],
  },
  {
    id: "tailscale",
    name: "Tailscale",
    bundleIds: ["io.tailscale.ipn.macsys"],
  },
  { id: "insomnia", name: "Insomnia", bundleIds: ["com.insomnia.app"] },
  {
    id: "signal",
    name: "Signal",
    bundleIds: ["org.whispersystems.signal-desktop"],
    processName: ["signal"],
  },
  {
    id: "protonmail",
    name: "ProtonMail",
    bundleIds: ["ch.protonmail.desktop"],
    processName: ["proton", "proton mail"],
  },
  {
    id: "things",
    name: "Things",
    bundleIds: ["com.culturedcode.ThingsMac"],
    processName: ["things"],
  },
  {
    id: "final-cut-pro",
    name: "Final Cut Pro",
    bundleIds: ["com.apple.FinalCut"],
  },
  {
    id: "xcode",
    name: "Xcode",
    bundleIds: ["com.apple.dt.Xcode"],
    processName: ["xcode"],
  },
  {
    id: "cleanshot-x",
    name: "CleanShot X",
    bundleIds: ["pl.maketheweb.cleanshotx"],
    processName: ["cleanshot x"],
  },
  {
    id: "obs-studio",
    name: "OBS Studio",
    bundleIds: ["com.obsproject.obs-studio"],
  },
  {
    id: "wechat",
    name: "WeChat",
    bundleIds: ["com.tencent.xinWeChat"],
    processName: ["wechat"],
  },
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
  personal_messages: [
    "imessage",
    "whatsapp",
    "discord",
    "telegram",
    "beeper",
    "texts",
    "signal",
    "wechat",
  ],
  email: [
    "apple-mail",
    "outlook",
    "spark",
    "superhuman",
    "shortwave",
    "airmail",
    "mimestream",
    "protonmail",
  ],
  markdown_notes: ["notion", "obsidian", "linear", "workflowy"],
  notes: ["apple-notes", "microsoft-word", "microsoft-onenote", "pages"],
  ai: [
    "cursor",
    "chatgpt",
    "claude",
    "windsurf",
    "perplexity",
    "vs-code",
    "intellij-idea",
    "warp",
    "code-insiders",
    "sublime-text",
    "bbedit",
    "dbeaver",
    "datagrip",
    "pycharm",
    "webstorm",
    "rubymine",
    "xcode",
  ],
};

const normalizeAppIdentifier = (value: string): string =>
  value.trim().toLowerCase();

// Flat foreground app identifier -> preset lookup, derived from the slug groups
// above by expanding each app's APP_CATALOG bundleIds and processName.
// Unknown apps -> "default".
const APP_IDENTIFIER_TO_PRESET: Map<string, PresetId> = (() => {
  const m = new Map<string, PresetId>();
  for (const [preset, slugs] of Object.entries(PRESET_APP_DEFAULTS)) {
    for (const slug of slugs ?? []) {
      const app = appById(slug);
      for (const identifier of [
        ...(app?.bundleIds ?? []),
        ...(app?.processName ?? []),
      ]) {
        m.set(normalizeAppIdentifier(identifier), preset as PresetId);
      }
    }
  }
  return m;
})();

export const resolvePresetForBundleId = (
  appBundleId?: string | null,
): PresetId =>
  (appBundleId
    ? APP_IDENTIFIER_TO_PRESET.get(normalizeAppIdentifier(appBundleId))
    : undefined) ?? "default";

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

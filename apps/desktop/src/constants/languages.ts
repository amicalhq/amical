export const AVAILABLE_LANGUAGES = [
  { value: "auto", label: "Auto detect" },
  { value: "en", label: "🇺🇸 English" },
  { value: "zh", label: "🇨🇳 Chinese" },
  { value: "es", label: "🇪🇸 Spanish" },
  { value: "af", label: "🇿🇦 Afrikaans" },
  { value: "sq", label: "🇦🇱 Albanian" },
  { value: "am", label: "🇪🇹 Amharic" },
  { value: "ar", label: "🇸🇦 Arabic" },
  { value: "hy", label: "🇦🇲 Armenian" },
  { value: "as", label: "🇮🇳 Assamese" },
  { value: "az", label: "🇦🇿 Azerbaijani" },
  { value: "ba", label: "🇷🇺 Bashkir" },
  { value: "eu", label: "🇪🇸 Basque" },
  { value: "be", label: "🇧🇾 Belarusian" },
  { value: "bn", label: "🇧🇩 Bengali" },
  { value: "bs", label: "🇧🇦 Bosnian" },
  { value: "br", label: "🇫🇷 Breton" },
  { value: "bg", label: "🇧🇬 Bulgarian" },
  { value: "ca", label: "🇪🇸 Catalan" },
  { value: "hr", label: "🇭🇷 Croatian" },
  { value: "cs", label: "🇨🇿 Czech" },
  { value: "da", label: "🇩🇰 Danish" },
  { value: "nl", label: "🇳🇱 Dutch" },
  { value: "et", label: "🇪🇪 Estonian" },
  { value: "fo", label: "🇫🇴 Faroese" },
  { value: "fi", label: "🇫🇮 Finnish" },
  { value: "fr", label: "🇫🇷 French" },
  { value: "gl", label: "🇪🇸 Galician" },
  { value: "ka", label: "🇬🇪 Georgian" },
  { value: "de", label: "🇩🇪 German" },
  { value: "el", label: "🇬🇷 Greek" },
  { value: "gu", label: "🇮🇳 Gujarati" },
  { value: "ht", label: "🇭🇹 Haitian Creole" },
  { value: "ha", label: "🇳🇬 Hausa" },
  { value: "haw", label: "🇺🇸 Hawaiian" },
  { value: "he", label: "🇮🇱 Hebrew" },
  { value: "hi", label: "🇮🇳 Hindi" },
  { value: "hu", label: "🇭🇺 Hungarian" },
  { value: "is", label: "🇮🇸 Icelandic" },
  { value: "id", label: "🇮🇩 Indonesian" },
  { value: "it", label: "🇮🇹 Italian" },
  { value: "ja", label: "🇯🇵 Japanese" },
  { value: "jw", label: "🇮🇩 Javanese" },
  { value: "kn", label: "🇮🇳 Kannada" },
  { value: "kk", label: "🇰🇿 Kazakh" },
  { value: "km", label: "🇰🇭 Khmer" },
  { value: "ko", label: "🇰🇷 Korean" },
  { value: "lo", label: "🇱🇦 Lao" },
  { value: "la", label: "🇻🇦 Latin" },
  { value: "lv", label: "🇱🇻 Latvian" },
  { value: "ln", label: "🇨🇩 Lingala" },
  { value: "lt", label: "🇱🇹 Lithuanian" },
  { value: "lb", label: "🇱🇺 Luxembourgish" },
  { value: "mk", label: "🇲🇰 Macedonian" },
  { value: "mg", label: "🇲🇬 Malagasy" },
  { value: "ms", label: "🇲🇾 Malay" },
  { value: "ml", label: "🇮🇳 Malayalam" },
  { value: "mt", label: "🇲🇹 Maltese" },
  { value: "mi", label: "🇳🇿 Maori" },
  { value: "mr", label: "🇮🇳 Marathi" },
  { value: "mn", label: "🇲🇳 Mongolian" },
  { value: "my", label: "🇲🇲 Myanmar (Burmese)" },
  { value: "ne", label: "🇳🇵 Nepali" },
  { value: "no", label: "🇳🇴 Norwegian" },
  { value: "nn", label: "🇳🇴 Nynorsk" },
  { value: "oc", label: "🇫🇷 Occitan" },
  { value: "ps", label: "🇦🇫 Pashto" },
  { value: "fa", label: "🇮🇷 Persian" },
  { value: "pl", label: "🇵🇱 Polish" },
  { value: "pt", label: "🇵🇹 Portuguese" },
  { value: "pa", label: "🇮🇳 Punjabi" },
  { value: "ro", label: "🇷🇴 Romanian" },
  { value: "ru", label: "🇷🇺 Russian" },
  { value: "sa", label: "🇮🇳 Sanskrit" },
  { value: "sr", label: "🇷🇸 Serbian" },
  { value: "sn", label: "🇿🇼 Shona" },
  { value: "sd", label: "🇵🇰 Sindhi" },
  { value: "si", label: "🇱🇰 Sinhala" },
  { value: "sk", label: "🇸🇰 Slovak" },
  { value: "sl", label: "🇸🇮 Slovenian" },
  { value: "so", label: "🇸🇴 Somali" },
  { value: "su", label: "🇮🇩 Sundanese" },
  { value: "sw", label: "🇰🇪 Swahili" },
  { value: "sv", label: "🇸🇪 Swedish" },
  { value: "tl", label: "🇵🇭 Tagalog" },
  { value: "tg", label: "🇹🇯 Tajik" },
  { value: "ta", label: "🇮🇳 Tamil" },
  { value: "tt", label: "🇷🇺 Tatar" },
  { value: "te", label: "🇮🇳 Telugu" },
  { value: "th", label: "🇹🇭 Thai" },
  { value: "bo", label: "🇨🇳 Tibetan" },
  { value: "tr", label: "🇹🇷 Turkish" },
  { value: "tk", label: "🇹🇲 Turkmen" },
  { value: "uk", label: "🇺🇦 Ukrainian" },
  { value: "ur", label: "🇵🇰 Urdu" },
  { value: "uz", label: "🇺🇿 Uzbek" },
  { value: "vi", label: "🇻🇳 Vietnamese" },
  { value: "cy", label: "🏴󠁧󠁢󠁷󠁬󠁳󠁿 Welsh" },
  { value: "yi", label: "🇮🇱 Yiddish" },
  { value: "yo", label: "🇳🇬 Yoruba" },
];

export const labelForLanguage = (code: string) =>
  AVAILABLE_LANGUAGES.find((l) => l.value === code)?.label ?? code;

// Primary subtags the OS reports differently than whisper names them.
const LOCALE_ALIASES: Record<string, string> = {
  nb: "no", // Norwegian Bokmål
  fil: "tl", // Filipino → Tagalog
  iw: "he", // legacy Hebrew tag
  in: "id", // legacy Indonesian tag
};

/**
 * Map a BCP-47 locale tag (e.g. "fr-FR", "zh-Hant-TW", "nb-NO") to a
 * supported dictation language code, or undefined when whisper doesn't
 * cover that language.
 */
export const dictationLanguageForLocale = (
  locale: string,
): string | undefined => {
  const primary = locale.toLowerCase().split("-")[0];
  const code = LOCALE_ALIASES[primary] ?? primary;
  // "auto" is a list entry, not a language — never a valid mapping target.
  return code !== "auto" && AVAILABLE_LANGUAGES.some((l) => l.value === code)
    ? code
    : undefined;
};

import { useState } from "react";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { X } from "lucide-react";
import { ComboboxMulti } from "@/components/ui/combobox-multi";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

// TODO: Move to a shared constants file
const languageOptions = [
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

interface LanguageSettingsProps {
  autoDetect: boolean;
  onAutoDetectChange: (value: boolean) => void;
  languages: string[];
  onLanguagesChange: (languages: string[]) => void;
}

export function LanguageSettings({
  autoDetect,
  onAutoDetectChange,
  languages,
  onLanguagesChange,
}: LanguageSettingsProps) {
  const handleRemoveLanguage = (languageValue: string) => {
    onLanguagesChange(languages.filter((lang) => lang !== languageValue));
  };

  return (
    <div className="">
      <div className="flex items-center justify-between mb-2">
        <div>
          <Label className="text-base font-semibold text-foreground">
            Auto detect language
          </Label>
          <p className="text-xs text-muted-foreground mb-2">
            Automatically detect spoken language. Turn off to select specific
            languages.
          </p>
        </div>
        <Switch checked={autoDetect} onCheckedChange={onAutoDetectChange} />
      </div>

      <div className="flex justify-between items-start mt-6 border-border border rounded-md p-4">
        <div
          className={cn(
            "flex items-start gap-2 flex-col",
            autoDetect && "opacity-50 pointer-events-none",
          )}
        >
          <Label className="text-sm font-medium text-foreground">
            Languages
          </Label>
          <div className={cn("flex items-center gap-2 flex-wrap")}>
            {languages.length > 0 &&
              languageOptions
                .filter((l) => languages.includes(l.value))
                .map((l) => (
                  <div key={l.value} className="flex items-center gap-1">
                    <Badge variant="outline">
                      <span>{l.label}</span>
                    </Badge>
                    <Button
                      className="h-5 w-5 p-0"
                      onClick={() => handleRemoveLanguage(l.value)}
                      variant="ghost"
                      size="sm"
                      aria-label={`Remove ${l.label}`}
                    >
                      <X className="w-3 h-3" />
                    </Button>
                  </div>
                ))}
          </div>
        </div>
        <Tooltip delayDuration={100}>
          <TooltipTrigger asChild>
            <div>
              <ComboboxMulti
                options={languageOptions.filter((l) => l.value !== "auto")}
                value={languages}
                onChange={onLanguagesChange}
                placeholder="Select languages..."
                disabled={autoDetect}
              />
            </div>
          </TooltipTrigger>
          {autoDetect && (
            <TooltipContent className="max-w-sm text-center">
              Disable auto detection to select languages. Selecting specific
              languages may increase accuracy.
            </TooltipContent>
          )}
        </Tooltip>
      </div>
    </div>
  );
}

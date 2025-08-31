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

// Mock data - TODO: Move to a shared constants file
const languageOptions = [
  { value: "auto", label: "Auto detect" },
  { value: "en", label: "🇺🇸 English" },
  { value: "es", label: "🇪🇸 Spanish" },
  { value: "fr", label: "🇫🇷 French" },
  { value: "de", label: "🇩🇪 German" },
  { value: "hi", label: "🇮🇳 Hindi" },
  { value: "zh", label: "🇨🇳 Chinese" },
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
            autoDetect && "opacity-50 pointer-events-none"
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
                  <Badge
                    key={l.value}
                    variant="outline"
                    className="flex items-center"
                  >
                    <span>{l.label}</span>
                    <Button
                      className="p-0"
                      onClick={() => handleRemoveLanguage(l.value)}
                      variant="ghost"
                      size="sm"
                    >
                      <X className="w-3 h-3 p-0" />
                    </Button>
                  </Badge>
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

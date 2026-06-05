import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Combobox as ComboboxBase,
  ComboboxChip,
  ComboboxChips,
  ComboboxChipsInput,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxItem,
  ComboboxList,
  ComboboxValue,
  useComboboxAnchor,
} from "@/components/ui/combobox-base";
import {
  AVAILABLE_LANGUAGES,
  labelForLanguage as labelFor,
} from "@/constants/languages";
import { useState, useEffect } from "react";
import { api } from "@/trpc/react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

export function LanguageSettings() {
  const { t } = useTranslation();
  const utils = api.useUtils();

  const { data: dictationSettings, isLoading } =
    api.settings.getDictationSettings.useQuery();

  const updateDictationSettings = api.settings.setDictationSettings.useMutation({
    onSuccess: () => utils.settings.getDictationSettings.invalidate(),
  });

  const [languages, setLanguages] = useState<string[]>(["en"]);
  const [autoDetect, setAutoDetect] = useState(true);
  const [swissGerman, setSwissGerman] = useState(false);

  useEffect(() => {
    if (dictationSettings) {
      setLanguages(dictationSettings.languages);
      setAutoDetect(dictationSettings.autoDetectEnabled);
      setSwissGerman(dictationSettings.swissGermanSpelling ?? false);
    }
  }, [dictationSettings]);

  const persist = async (next: {
    autoDetectEnabled: boolean;
    swissGermanSpelling: boolean;
    languages: string[];
  }) => {
    try {
      await updateDictationSettings.mutateAsync(next);
    } catch (error) {
      setLanguages(dictationSettings?.languages ?? []);
      setAutoDetect(dictationSettings?.autoDetectEnabled ?? true);
      setSwissGerman(dictationSettings?.swissGermanSpelling ?? false);
      console.error("Failed to update dictation settings:", error);
    }
  };

  const handleAutoDetectChange = async (enabled: boolean) => {
    setAutoDetect(enabled);
    await persist({
      autoDetectEnabled: enabled,
      swissGermanSpelling: swissGerman,
      languages,
    });
  };

  const handleLanguagesChange = async (next: string[]) => {
    setLanguages(next);
    await persist({
      autoDetectEnabled: autoDetect,
      swissGermanSpelling: swissGerman,
      languages: next,
    });
  };

  const handleSwissGermanChange = async (enabled: boolean) => {
    setSwissGerman(enabled);
    await persist({
      autoDetectEnabled: autoDetect,
      swissGermanSpelling: enabled,
      languages,
    });
  };

  const disabled = autoDetect || isLoading || updateDictationSettings.isPending;
  const busy = isLoading || updateDictationSettings.isPending;

  const anchor = useComboboxAnchor();
  const languageCodes = AVAILABLE_LANGUAGES.filter(
    (l) => l.value !== "auto",
  ).map((l) => l.value);

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <div>
          <Label className="text-base font-semibold text-foreground">
            {t("settings.dictation.language.autoDetect.label")}
          </Label>
          <p className="text-xs text-muted-foreground mb-2">
            {t("settings.dictation.language.autoDetect.description")}
          </p>
        </div>
        <Switch
          checked={autoDetect}
          onCheckedChange={handleAutoDetectChange}
          disabled={busy}
        />
      </div>

      <div className="mt-6 border-border border rounded-md p-4">
        <div className="flex items-start justify-between gap-16">
          <Label className="text-sm font-medium text-foreground shrink-0">
            {t("settings.dictation.language.languagesLabel")}
          </Label>
          <div
            className={cn(
              "min-w-0 flex-1 flex justify-end",
              disabled && "opacity-50",
            )}
          >
            <ComboboxBase
              multiple
              items={languageCodes}
              value={languages}
              onValueChange={handleLanguagesChange}
              itemToStringLabel={(code: string) => labelFor(code)}
              disabled={disabled}
            >
              <ComboboxChips ref={anchor} className="w-fit max-w-full min-w-0">
                <ComboboxValue>
                  {(values: string[]) => (
                    <>
                      {values.map((code) => (
                        <ComboboxChip key={code}>{labelFor(code)}</ComboboxChip>
                      ))}
                      <ComboboxChipsInput
                        placeholder={t(
                          "settings.dictation.language.languagesPlaceholder",
                        )}
                      />
                    </>
                  )}
                </ComboboxValue>
              </ComboboxChips>
              <ComboboxContent anchor={anchor}>
                <ComboboxEmpty>
                  {t("settings.dictation.language.noResults")}
                </ComboboxEmpty>
                <ComboboxList>
                  {(code: string) => (
                    <ComboboxItem key={code} value={code}>
                      {labelFor(code)}
                    </ComboboxItem>
                  )}
                </ComboboxList>
              </ComboboxContent>
            </ComboboxBase>
          </div>
        </div>
      </div>

      <div className="mt-6 flex items-center justify-between">
        <div>
          <Label className="text-sm font-medium text-foreground">
            {t("settings.dictation.language.swissGerman.label")}
          </Label>
          <p className="text-xs text-muted-foreground">
            {t("settings.dictation.language.swissGerman.description")}
          </p>
        </div>
        <Switch
          checked={swissGerman}
          onCheckedChange={handleSwissGermanChange}
          disabled={busy}
        />
      </div>
    </div>
  );
}

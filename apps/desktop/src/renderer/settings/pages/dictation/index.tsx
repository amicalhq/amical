import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Plus, X } from "lucide-react";
import { Combobox } from "@/components/ui/combobox";
import { ComboboxMulti } from "@/components/ui/combobox-multi";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// Mock data
const languageOptions = [
  { value: "auto", label: "Auto detect" },
  { value: "en", label: "🇺🇸 English" },
  { value: "es", label: "🇪🇸 Spanish" },
  { value: "fr", label: "🇫🇷 French" },
  { value: "de", label: "🇩🇪 German" },
  { value: "hi", label: "🇮🇳 Hindi" },
  { value: "zh", label: "🇨🇳 Chinese" },
];
const microphoneOptions = [
  "Default System input",
  "Niket's iPhone Microphone",
  "XYZ Brand Microphone",
];
// Realistic AI model options
const speechModelOptions = [
  { value: "whisper", label: "OpenAI Whisper" },
  { value: "google-speech", label: "Google Speech-to-Text" },
  { value: "assemblyai", label: "AssemblyAI" },
  { value: "deepgram", label: "Deepgram" },
];
const formattingModelOptions = [
  { value: "gpt-4", label: "OpenAI GPT-4" },
  { value: "claude", label: "Anthropic Claude" },
  { value: "gemini", label: "Google Gemini" },
  { value: "llama-3", label: "Meta Llama 3" },
];

export default function DictationSettingsPage() {
  // State
  const [autoDetect, setAutoDetect] = useState(true);
  const [languages, setLanguages] = useState<string[]>([]);
  const [microphone, setMicrophone] = useState<string>(microphoneOptions[0]);
  // Separate model lists for each section
  const [speechModels, setSpeechModels] = useState(speechModelOptions); // set to [] to test empty state
  const [formattingModels, setFormattingModels] = useState(
    formattingModelOptions
  ); // set to [] to test empty state
  const [speechModel, setSpeechModel] = useState<string>(
    speechModels[0]?.value || ""
  );
  const [formattingEnabled, setFormattingEnabled] = useState(true);
  const [formattingModel, setFormattingModel] = useState<string>(
    formattingModels[0]?.value || ""
  );

  return (
    <div className="container mx-auto p-6 max-w-5xl">
      <div className="mb-8">
        <h1 className="text-xl font-bold">Dictation</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Configure dictation, language, microphone, and AI model settings
        </p>
      </div>
      <Card>
        <CardContent className="space-y-4">
          {/* Languages */}
          <div className="">
            <div className="flex items-center justify-between mb-2">
              <div>
                <Label className="text-base font-semibold text-foreground">
                  Auto detect language
                </Label>
                <p className="text-xs text-muted-foreground mb-2">
                  Automatically detect spoken language. Turn off to select
                  specific languages.
                </p>
              </div>
              <Switch checked={autoDetect} onCheckedChange={setAutoDetect} />
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
                            onClick={() => {
                              setLanguages(
                                languages.filter((lang) => lang !== l.value)
                              );
                            }}
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
                      options={languageOptions.filter(
                        (l) => l.value !== "auto"
                      )}
                      value={languages}
                      onChange={setLanguages}
                      placeholder="Select languages..."
                      disabled={autoDetect}
                    />
                  </div>
                </TooltipTrigger>
                {autoDetect && (
                  <TooltipContent className="max-w-sm text-center">
                    Disable auto detection to select languages. Selecting
                    specific languages may increase accuracy.
                  </TooltipContent>
                )}
              </Tooltip>
            </div>
          </div>
          <Separator />
          {/* Microphone Picker */}
          <div className="flex items-center justify-between">
            <div>
              <Label className="text-base font-semibold text-foreground">
                Microphone
              </Label>
              <p className="text-xs text-muted-foreground mb-2">
                Choose your preferred microphone for dictation.
              </p>
            </div>
            <Select value={microphone} onValueChange={setMicrophone}>
              <SelectTrigger>
                <SelectValue placeholder="Select microphone" />
              </SelectTrigger>
              <SelectContent>
                {microphoneOptions.map((mic) => (
                  <SelectItem key={mic} value={mic}>
                    {mic}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Separator />
          {/* Speech to Text */}
          <div className="flex items-start justify-between">
            <div>
              <Label className="text-base font-semibold text-foreground">
                Speech to Text
              </Label>
              <p className="text-xs text-muted-foreground mb-2">
                Select the AI model for speech-to-text conversion.
              </p>
            </div>
            {speechModels.length === 0 ? (
              <div className="flex items-center gap-2 mt-2">
                <span className="text-destructive">No models available.</span>
                <Link to="/models">
                  <Button variant="outline" className="ml-2">
                    <Plus className="w-4 h-4 mr-1" />
                    Setup model
                  </Button>
                </Link>
              </div>
            ) : (
              <div className="flex flex-col items-end gap-3">
                <Combobox
                  options={speechModels}
                  value={speechModel}
                  onChange={setSpeechModel}
                />
                <Link to="/models">
                  <Button variant="link" className="text-xs px-0">
                    <Plus className="w-4 h-4" />
                    Add more models
                  </Button>
                </Link>
              </div>
            )}
          </div>
          <Separator />
          {/* Formatting */}
          <div className="">
            <div className="flex items-center justify-between mb-2">
              <div>
                <Label className="text-base font-semibold text-foreground">
                  Formatting
                </Label>
                <p className="text-xs text-muted-foreground mb-2">
                  Enable formatting and select the AI model for formatting
                  output.
                </p>
              </div>
              <Switch
                checked={formattingEnabled}
                onCheckedChange={setFormattingEnabled}
              />
            </div>

            {
              <div className="flex items-start justify-between mt-6 border-border border rounded-md p-4">
                <Label
                  className={cn(
                    "text-sm font-medium text-foreground",
                    !formattingEnabled && "opacity-50 pointer-events-none"
                  )}
                >
                  Formatting Model
                </Label>
                {formattingModels.length === 0 ? (
                  <div className="flex items-center gap-2">
                    <span className="text-destructive">
                      No models available.
                    </span>
                    <Link to="/models">
                      <Button variant="outline" className="ml-2">
                        <Plus className="w-4 h-4 mr-1" />
                        Setup model
                      </Button>
                    </Link>
                  </div>
                ) : (
                  <div className="flex flex-col items-end gap-3">
                    <Tooltip delayDuration={100}>
                      <TooltipTrigger asChild>
                        <div>
                          <Combobox
                            disabled={!formattingEnabled}
                            options={formattingModels}
                            value={formattingModel}
                            onChange={setFormattingModel}
                          />
                        </div>
                      </TooltipTrigger>
                      {!formattingEnabled && (
                        <TooltipContent className="max-w-sm text-center">
                          Enable formatting to select a formatting model. This
                          will improve the quality and structure of your
                          transcribed text.
                        </TooltipContent>
                      )}
                    </Tooltip>
                    <Link
                      to="/models"
                      className={cn(
                        !formattingEnabled && "opacity-50 pointer-events-none"
                      )}
                    >
                      <Button variant="link" className="text-xs px-0">
                        <Plus className="w-4 h-4" />
                        Add more models
                      </Button>
                    </Link>
                  </div>
                )}
              </div>
            }
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

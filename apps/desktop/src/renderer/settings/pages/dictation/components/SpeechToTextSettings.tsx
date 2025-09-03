import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { Combobox } from "@/components/ui/combobox";
import { Link } from "react-router-dom";

// Mock data - TODO: Move to a shared constants file
const speechModelOptions = [
  { value: "whisper", label: "OpenAI Whisper" },
  { value: "google-speech", label: "Google Speech-to-Text" },
  { value: "assemblyai", label: "AssemblyAI" },
  { value: "deepgram", label: "Deepgram" },
];

interface SpeechToTextSettingsProps {
  speechModels: Array<{ value: string; label: string }>;
  speechModel: string;
  onSpeechModelChange: (model: string) => void;
}

export function SpeechToTextSettings({
  speechModels,
  speechModel,
  onSpeechModelChange,
}: SpeechToTextSettingsProps) {
  return (
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
            onChange={onSpeechModelChange}
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
  );
}

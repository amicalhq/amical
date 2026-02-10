import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Info } from "lucide-react";

const MAX_LENGTH = 2000;

interface CustomInstructionsEditorProps {
  value: string | undefined;
  onChange: (value: string | undefined) => void;
}

export function CustomInstructionsEditor({
  value,
  onChange,
}: CustomInstructionsEditorProps) {
  const currentLength = value?.length ?? 0;

  return (
    <div>
      <div className="mb-2 flex items-center gap-1.5">
        <Label className="text-sm font-medium text-foreground">
          Custom instructions
        </Label>
        <Tooltip delayDuration={100}>
          <TooltipTrigger asChild>
            <button
              type="button"
              className="inline-flex h-4 w-4 items-center justify-center text-muted-foreground hover:text-foreground"
              aria-label="About custom instructions"
            >
              <Info className="h-4 w-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent className="max-w-sm text-center">
            Additional instructions for the formatter to follow when processing
            your transcriptions.
          </TooltipContent>
        </Tooltip>
      </div>
      <Textarea
        placeholder="e.g. Reformat the user's message, never use punctuation or emojis."
        value={value ?? ""}
        onChange={(e) => {
          const newValue = e.target.value;
          if (newValue.length <= MAX_LENGTH) {
            onChange(newValue || undefined);
          }
        }}
        className="min-h-24 text-sm"
      />
      <p className="text-xs text-muted-foreground mt-1 text-right">
        {currentLength} / {MAX_LENGTH}
      </p>
    </div>
  );
}

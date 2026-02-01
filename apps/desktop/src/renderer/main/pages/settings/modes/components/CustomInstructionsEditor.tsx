import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

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
      <Label className="text-sm font-medium text-foreground mb-1 block">
        Custom instructions
      </Label>
      <p className="text-xs text-muted-foreground mb-2">
        Additional instructions for the formatter to follow when processing your
        transcriptions.
      </p>
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

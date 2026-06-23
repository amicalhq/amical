import * as React from "react";
import * as RadioGroupPrimitive from "@radix-ui/react-radio-group";
import { Check } from "lucide-react";
import { RadioGroup } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import {
  TONE_META,
  TONE_PREVIEW,
  tonesForPreset,
  type Tone,
} from "./catalog";

// Preview surfaces use theme tokens so they gel in light and dark mode; the
// iMessage bubble keeps a blue fill (reads fine on either theme).

function WindowDots() {
  return (
    <div className="flex items-center gap-1.5 px-3 py-2">
      <span className="bg-muted-foreground/30 size-1.5 rounded-full" />
      <span className="bg-muted-foreground/30 size-1.5 rounded-full" />
      <span className="bg-muted-foreground/30 size-1.5 rounded-full" />
    </div>
  );
}

function initialsOf(name: string) {
  return name
    .split(" ")
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("");
}

function EmailPreview({ sender, text }: { sender: string; text: string }) {
  return (
    <div className="bg-background text-muted-foreground overflow-hidden rounded-lg border text-[11px] leading-relaxed">
      <WindowDots />
      <div className="text-foreground border-y px-3 py-1.5 text-[12px] font-semibold">
        {sender}
      </div>
      <div className="px-3 py-2.5 whitespace-pre-line">{text}</div>
    </div>
  );
}

function WorkMessagesPreview({
  sender,
  text,
}: {
  sender: string;
  text: string;
}) {
  return (
    <div className="bg-background text-muted-foreground overflow-hidden rounded-lg border text-[11px] leading-relaxed">
      <div className="text-muted-foreground flex items-center gap-1.5 border-b px-3 py-2 text-[12px] font-semibold">
        <span className="bg-muted text-muted-foreground grid size-3.5 place-items-center rounded text-[8px] font-bold">
          #
        </span>
        Slack
      </div>
      <div className="flex gap-2 px-3 py-2.5">
        <span className="bg-muted text-foreground grid size-6 shrink-0 place-items-center rounded text-[9px] font-semibold">
          {initialsOf(sender)}
        </span>
        <div className="min-w-0">
          <div className="text-foreground text-[12px] font-semibold">
            {sender}
          </div>
          <div>{text}</div>
        </div>
      </div>
    </div>
  );
}

function DefaultPreview({ text }: { text: string }) {
  return (
    <div className="bg-background text-muted-foreground overflow-hidden rounded-lg border text-[11px] leading-relaxed">
      <div className="text-muted-foreground border-b px-3 py-2 text-[12px] font-semibold">
        Notes
      </div>
      <div className="px-3 py-2.5 whitespace-pre-line">{text}</div>
    </div>
  );
}

function PersonalMessagesPreview({ text }: { text: string }) {
  return (
    <div className="bg-background flex justify-end rounded-lg border px-3 py-3">
      <div className="relative max-w-[88%]">
        <div className="rounded-[18px] bg-blue-500 px-3 py-2 text-[11px] leading-relaxed text-white">
          {text}
        </div>
        {/* iMessage-style tail. The standard dual-div technique: a blue
            tab that fills past the bubble's rounded bottom-right, plus a
            bg-coloured mask that carves the classic curve. The mask
            matches the parent's bg-background so the cut is invisible. */}
        <div
          aria-hidden
          className="absolute bottom-0 -right-[5px] h-[18px] w-[18px] bg-blue-500"
          style={{ borderBottomLeftRadius: "16px 14px" }}
        />
        <div
          aria-hidden
          className="bg-background absolute bottom-0 -right-[10px] h-[18px] w-[10px]"
          style={{ borderBottomLeftRadius: "10px" }}
        />
      </div>
    </div>
  );
}

function TonePreview({
  preset,
  tone,
}: {
  preset: string | null | undefined;
  tone: Tone;
}) {
  const spec = preset ? TONE_PREVIEW[preset] : undefined;
  const text = spec?.samples[tone];
  if (!spec || !text) return null;
  if (spec.surface === "email")
    return <EmailPreview sender={spec.sender} text={text} />;
  if (spec.surface === "work_messages")
    return <WorkMessagesPreview sender={spec.sender} text={text} />;
  if (spec.surface === "personal_messages")
    return <PersonalMessagesPreview text={text} />;
  return <DefaultPreview text={text} />;
}

// Circular indicator: hollow outline when unselected, filled with a check
// when selected. Localized here (uses the Radix primitive directly) so the
// shared RadioGroupItem isn't affected.
function ToneRadio({ id, value }: { id: string; value: Tone }) {
  return (
    <RadioGroupPrimitive.Item
      id={id}
      value={value}
      className="border-input focus-visible:ring-ring/50 grid size-5 shrink-0 place-items-center rounded-full border text-white transition-colors outline-none focus-visible:ring-[3px] data-[state=checked]:border-green-600 data-[state=checked]:bg-green-600"
    >
      <RadioGroupPrimitive.Indicator>
        <Check className="size-3" strokeWidth={3.5} />
      </RadioGroupPrimitive.Indicator>
    </RadioGroupPrimitive.Item>
  );
}

export function TonePicker({
  preset,
  value,
  onChange,
  idPrefix,
}: {
  preset: string | null | undefined;
  value: Tone | null;
  onChange: (tone: Tone) => void;
  idPrefix: string;
}) {
  return (
    <RadioGroup
      value={value ?? undefined}
      onValueChange={(v) => onChange(v as Tone)}
      className="grid gap-3 sm:grid-cols-3"
    >
      {tonesForPreset(preset).map((tone) => {
        const id = `${idPrefix}-${tone}`;
        const meta = TONE_META[tone];
        return (
          <Label
            key={tone}
            htmlFor={id}
            className="border-input bg-card hover:bg-accent/30 has-[[data-state=checked]]:border-primary/40 flex cursor-pointer flex-col items-stretch gap-3 rounded-xl border p-4 text-left transition-colors"
          >
            <div className="flex items-start gap-3">
              <ToneRadio id={id} value={tone} />
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="text-sm leading-none font-semibold">
                  {meta.label}
                </span>
                <span className="text-muted-foreground text-xs leading-snug">
                  {meta.description}
                </span>
              </div>
            </div>
            <TonePreview preset={preset} tone={tone} />
          </Label>
        );
      })}
    </RadioGroup>
  );
}

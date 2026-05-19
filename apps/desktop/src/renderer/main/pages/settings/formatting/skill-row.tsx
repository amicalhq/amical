import * as React from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { TargetAvatarStack, TargetPicker } from "./app-picker";
import {
  APP_CATALOG,
  POLISHING_OPTIONS,
  PRESET_OPTIONS,
  SITE_CATALOG,
  TONE_OPTIONS,
  normalizeHostname,
  type Polishing,
  type SkillEdit,
  type SkillSnapshot,
  type Tone,
} from "./catalog";

const toDraft = (skill: SkillSnapshot): SkillEdit => ({
  id: skill.id,
  name: skill.name,
  mode: skill.mode,
  preset: skill.preset,
  prompt: skill.prompt,
  polishing: skill.polishing as Polishing | null,
  tone: skill.tone as Tone | null,
  includedApps: skill.includedApps,
  includedSites: skill.includedSites,
});

export function SkillRow({
  skill,
  expanded,
  saving,
  onToggle,
  onSave,
  onDelete,
  onReset,
}: {
  skill: SkillSnapshot;
  expanded: boolean;
  saving?: boolean;
  onToggle: () => void;
  onSave: (next: SkillEdit) => void;
  onDelete?: () => void;
  // Reset a single list back to app-defined defaults. Only relevant
  // for seeded skills that the user has customized.
  onReset?: (field: "apps" | "sites") => void;
}) {
  const [draft, setDraft] = React.useState<SkillEdit>(() => toDraft(skill));

  React.useEffect(() => {
    if (expanded) setDraft(toDraft(skill));
  }, [expanded, skill]);

  const presetLabel = skill.preset
    ? (PRESET_OPTIONS.find((p) => p.value === skill.preset)?.label ??
      skill.preset)
    : null;
  const polishingLabel = skill.polishing
    ? (POLISHING_OPTIONS.find((p) => p.value === skill.polishing)?.label ??
      skill.polishing)
    : null;
  const toneLabel = skill.tone
    ? (TONE_OPTIONS.find((t) => t.value === skill.tone)?.label ?? skill.tone)
    : null;

  return (
    <div className="group">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/50"
        aria-expanded={expanded}
      >
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium">{skill.name}</div>
          <div className="mt-1.5 flex flex-wrap items-center gap-1">
            {/* Built-in skills' preset is fixed — surface only the
                knobs the user can actually change. User-created
                skills still show their preset choice. */}
            {skill.mode === "preset" && presetLabel && !skill.isBuiltIn && (
              <ConfigChip label="Preset" value={presetLabel} />
            )}
            {skill.mode === "custom" && (
              <Badge variant="outline" className="font-normal">
                Custom prompt
              </Badge>
            )}
            {polishingLabel && (
              <ConfigChip label="Polishing" value={polishingLabel} />
            )}
            {toneLabel && <ConfigChip label="Tone" value={toneLabel} />}
          </div>
          {skill.isDefault && (
            <div className="mt-1 text-xs text-muted-foreground">
              Applies everywhere unless customized below
            </div>
          )}
        </div>
        {!skill.isDefault &&
          (skill.includedApps.length > 0 ||
            skill.includedSites.length > 0) && (
            <TargetAvatarStack
              apps={skill.includedApps}
              sites={skill.includedSites}
            />
          )}
        {expanded ? (
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
        )}
      </button>

      {expanded && (
        <div className="space-y-4 border-t border-border bg-muted/20 px-4 py-4">
          {!skill.isBuiltIn && (
            <FieldRow label="Name">
              <Input
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                className="max-w-sm"
              />
            </FieldRow>
          )}

          {/* Mode toggle — always shown. Custom is disabled with a
              tooltip until AMIC-13 lands. Built-in skills can't switch
              modes; user-created skills also can't yet (Custom locked).
              The actual mode value stays "preset" because the disabled
              item never fires onValueChange. */}
          <FieldRow label="Mode">
            <ToggleGroup
              type="single"
              variant="outline"
              size="sm"
              value={draft.mode}
              onValueChange={(v) => {
                if (v === "preset") setDraft({ ...draft, mode: "preset" });
              }}
              className="max-w-[16rem]"
            >
              <ToggleGroupItem value="preset">Preset</ToggleGroupItem>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex" tabIndex={0}>
                    <ToggleGroupItem
                      value="custom"
                      disabled
                      aria-disabled="true"
                      className="pointer-events-none opacity-50"
                    >
                      Custom
                    </ToggleGroupItem>
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  Custom instructions for the styling. Coming soon.
                </TooltipContent>
              </Tooltip>
            </ToggleGroup>
          </FieldRow>

          {/* Preset picker only for user-created preset-mode skills.
              Built-in skills lock their preset; custom-mode skills
              get the prompt placeholder below. */}
          {draft.mode === "custom" ? (
            <FieldRow label="Prompt">
              <div className="rounded-md border border-dashed border-border bg-background p-3 text-xs text-muted-foreground">
                Editing custom prompts isn't available in this version yet.
              </div>
            </FieldRow>
          ) : !skill.isBuiltIn ? (
            <FieldRow label="Preset">
              <Select
                value={draft.preset ?? ""}
                onValueChange={(v) => setDraft({ ...draft, preset: v })}
              >
                <SelectTrigger className="max-w-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PRESET_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FieldRow>
          ) : null}

          <FieldRow label="Polishing">
            <ToggleGroup
              type="single"
              variant="outline"
              size="sm"
              value={draft.polishing ?? ""}
              onValueChange={(v) => {
                setDraft({
                  ...draft,
                  polishing: v ? (v as Polishing) : null,
                });
              }}
              className="max-w-sm"
            >
              {POLISHING_OPTIONS.map((opt) => (
                <ToggleGroupItem key={opt.value} value={opt.value}>
                  {opt.label}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </FieldRow>

          <FieldRow label="Tone">
            <ToggleGroup
              type="single"
              variant="outline"
              size="sm"
              value={draft.tone ?? ""}
              onValueChange={(v) => {
                setDraft({ ...draft, tone: v ? (v as Tone) : null });
              }}
              className="max-w-[16rem]"
            >
              {TONE_OPTIONS.map((opt) => (
                <ToggleGroupItem key={opt.value} value={opt.value}>
                  {opt.label}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </FieldRow>

          {!skill.isDefault && (
            <>
              <FieldRow
                label="Apps"
                action={
                  skill.isBuiltIn && !skill.isUsingDefaultApps && onReset ? (
                    <ResetLink
                      onClick={() => onReset("apps")}
                      disabled={saving}
                    />
                  ) : null
                }
              >
                <TargetPicker
                  value={draft.includedApps}
                  onChange={(includedApps) =>
                    setDraft({ ...draft, includedApps })
                  }
                  catalog={APP_CATALOG}
                  addLabel="Add app"
                  searchPlaceholder="Search apps..."
                  emptyLabel="No apps found."
                />
              </FieldRow>
              <FieldRow
                label="Websites"
                action={
                  skill.isBuiltIn && !skill.isUsingDefaultSites && onReset ? (
                    <ResetLink
                      onClick={() => onReset("sites")}
                      disabled={saving}
                    />
                  ) : null
                }
              >
                <TargetPicker
                  value={draft.includedSites}
                  onChange={(includedSites) =>
                    setDraft({ ...draft, includedSites })
                  }
                  catalog={SITE_CATALOG}
                  addLabel="Add website"
                  searchPlaceholder="Search or type a hostname..."
                  emptyLabel="Type a hostname to add it."
                  allowCustom
                  normalizeCustom={normalizeHostname}
                  customLabel="Add website"
                />
              </FieldRow>
            </>
          )}

          <div className="flex justify-end gap-2 pt-1">
            {!skill.isBuiltIn && onDelete && (
              <Button
                variant="ghost"
                className="text-destructive hover:text-destructive"
                onClick={onDelete}
                disabled={saving}
              >
                Delete
              </Button>
            )}
            <Button variant="outline" onClick={onToggle} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={() => onSave(draft)} disabled={saving}>
              {saving ? "Saving..." : "Save"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function FieldRow({
  label,
  children,
  action,
}: {
  label: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[7rem_1fr] items-start gap-3">
      <div className="flex items-baseline justify-between pt-2">
        <Label className="text-sm text-muted-foreground">{label}</Label>
      </div>
      <div className="min-w-0">
        {action && (
          <div className="mb-1 flex justify-end">
            <div className="text-xs">{action}</div>
          </div>
        )}
        {children}
      </div>
    </div>
  );
}

function ConfigChip({ label, value }: { label: string; value: string }) {
  return (
    <Badge variant="secondary" className="gap-1 font-normal">
      <span className="text-muted-foreground">{label}:</span>
      <span>{value}</span>
    </Badge>
  );
}

function ResetLink({
  onClick,
  disabled,
}: {
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline disabled:opacity-50"
    >
      Reset to defaults
    </button>
  );
}

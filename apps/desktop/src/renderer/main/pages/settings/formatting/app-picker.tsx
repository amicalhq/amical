import * as React from "react";
import { Plus, X } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { targetById, type TargetMeta } from "./catalog";

export function TargetPicker({
  value,
  onChange,
  catalog,
  addLabel,
  searchPlaceholder,
  emptyLabel,
  allowCustom = false,
  normalizeCustom,
  customLabel = "Add",
}: {
  value: string[];
  onChange: (next: string[]) => void;
  catalog: TargetMeta[];
  addLabel: string;
  searchPlaceholder: string;
  emptyLabel: string;
  // When true, the popover surfaces an "Add <typed>" item when the
  // search query doesn't match a catalog entry. The normalized result
  // is what gets stored on the skill.
  allowCustom?: boolean;
  normalizeCustom?: (raw: string) => string | null;
  customLabel?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const remaining = catalog.filter((a) => !value.includes(a.id));

  const customNormalized =
    allowCustom && query.trim().length > 0
      ? (normalizeCustom ?? ((s) => s.trim().toLowerCase()))(query)
      : null;
  const matchesCatalog = remaining.some(
    (t) =>
      t.name.toLowerCase() === query.trim().toLowerCase() ||
      t.id.toLowerCase() === query.trim().toLowerCase(),
  );
  const showCustomItem =
    Boolean(customNormalized) &&
    !matchesCatalog &&
    !value.includes(customNormalized!);

  const addCustom = () => {
    if (!customNormalized) return;
    onChange([...value, customNormalized]);
    setQuery("");
    setOpen(false);
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-input bg-background p-2 min-h-10">
      {value.map((id) => {
        const meta = targetById(id);
        return (
          <span
            key={id}
            className="inline-flex items-center gap-1.5 rounded-md bg-muted px-2 py-1 text-xs"
          >
            <span aria-hidden>{meta.emoji}</span>
            <span>{meta.name}</span>
            <button
              type="button"
              aria-label={`Remove ${meta.name}`}
              className="text-muted-foreground hover:text-foreground"
              onClick={() => onChange(value.filter((v) => v !== id))}
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        );
      })}

      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setQuery("");
        }}
      >
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className={cn(
              "h-7 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground",
              remaining.length === 0 && !allowCustom && "opacity-50",
            )}
            disabled={remaining.length === 0 && !allowCustom}
          >
            <Plus className="h-3.5 w-3.5" />
            {addLabel}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-72 p-0" align="start">
          <Command shouldFilter={!showCustomItem}>
            <CommandInput
              placeholder={searchPlaceholder}
              value={query}
              onValueChange={setQuery}
            />
            <CommandList>
              {!showCustomItem && <CommandEmpty>{emptyLabel}</CommandEmpty>}
              <CommandGroup>
                {remaining.map((target) => (
                  <CommandItem
                    key={target.id}
                    value={target.name}
                    onSelect={() => {
                      onChange([...value, target.id]);
                      setQuery("");
                      setOpen(false);
                    }}
                    className="gap-2"
                  >
                    <span aria-hidden>{target.emoji}</span>
                    <span>{target.name}</span>
                  </CommandItem>
                ))}
                {showCustomItem && (
                  <CommandItem
                    key={`__custom_${customNormalized}`}
                    value={`__custom_${customNormalized}`}
                    onSelect={addCustom}
                    className="gap-2"
                  >
                    <Plus className="h-3.5 w-3.5 text-muted-foreground" />
                    <span>
                      {customLabel}{" "}
                      <span className="font-medium">{customNormalized}</span>
                    </span>
                  </CommandItem>
                )}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}

// Renders a horizontal avatar stack for the combined apps+sites a skill
// targets. Pass either or both arrays; the stack merges them in order.
export function TargetAvatarStack({
  apps = [],
  sites = [],
  max = 3,
}: {
  apps?: string[];
  sites?: string[];
  max?: number;
}) {
  const merged = [...apps, ...sites];
  const shown = merged.slice(0, max);
  const extra = merged.length - shown.length;
  return (
    <div className="flex items-center -space-x-1.5">
      {shown.map((id) => {
        const meta = targetById(id);
        return (
          <span
            key={id}
            title={meta.name}
            className="flex h-6 w-6 items-center justify-center rounded-full border border-background bg-muted text-xs"
          >
            {meta.emoji}
          </span>
        );
      })}
      {extra > 0 && (
        <span className="flex h-6 min-w-6 items-center justify-center rounded-full border border-background bg-muted px-1.5 text-[10px] font-medium text-muted-foreground">
          +{extra}
        </span>
      )}
    </div>
  );
}

"use client";

import * as React from "react";
import { CheckIcon, ChevronsUpDownIcon, XIcon } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

export function ComboboxMulti({
  options,
  value,
  onChange,
  placeholder,
  className,
  disabled,
}: {
  options: { value: string; label: string; icon?: string }[];
  value: string[];
  onChange: (value: string[]) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = React.useState(false);

  const selectedOptions = options.filter((option) =>
    value.includes(option.value),
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger disabled={disabled} asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn(
            "w-full justify-between flex-wrap min-h-[40px] h-auto",
            className,
          )}
        >
          <div className="flex flex-wrap gap-1 items-center">
            {selectedOptions.length === 0 ? (
              <span className="text-muted-foreground">
                {placeholder || "Select..."}
              </span>
            ) : (
              selectedOptions.map((opt) => (
                <span
                  key={opt.value}
                  className="inline-flex items-center gap-1 rounded-md bg-secondary px-1.5 py-0.5 text-xs"
                >
                  {opt.icon && (
                    <img
                      src={opt.icon}
                      alt=""
                      className="h-4 w-4 shrink-0"
                    />
                  )}
                  {opt.label}
                  <span
                    role="button"
                    aria-label={`Remove ${opt.label}`}
                    title="Remove"
                    tabIndex={-1}
                    className="ml-0.5 rounded-sm hover:bg-muted-foreground/20"
                    onClick={(e) => {
                      e.stopPropagation();
                      onChange(value.filter((v) => v !== opt.value));
                    }}
                  >
                    <XIcon className="h-3 w-3" />
                  </span>
                </span>
              ))
            )}
          </div>
          <ChevronsUpDownIcon className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0">
        <Command>
          <CommandInput placeholder={placeholder || "Search..."} />
          <CommandList>
            <CommandEmpty>No option found.</CommandEmpty>
            <CommandGroup>
              {options.map((option) => (
                <CommandItem
                  key={option.value}
                  value={option.label}
                  keywords={[option.value]}
                  onSelect={() => {
                    if (value.includes(option.value)) {
                      onChange(value.filter((v) => v !== option.value));
                    } else {
                      onChange([...value, option.value]);
                    }
                  }}
                  className="flex items-center gap-2"
                >
                  <Checkbox
                    checked={value.includes(option.value)}
                    tabIndex={-1}
                    className="pointer-events-none"
                  />
                  {option.icon && (
                    <img
                      src={option.icon}
                      alt=""
                      className="h-5 w-5 shrink-0"
                    />
                  )}
                  <span>{option.label}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

"use client";

import * as React from "react";
import { CheckIcon, ChevronsUpDownIcon } from "lucide-react";

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

export interface ComboboxOption {
  value: string;
  label: string;
  disabled?: boolean;
  disabledReason?: string;
  icon?: string;
  iconAlt?: string;
  iconClassName?: string;
  iconFrameClass?: string;
  iconFallback?: string;
  iconFallbackClassName?: string;
}

export function Combobox({
  options,
  value,
  onChange,
  disabled,
  placeholder = "Select option...",
}: {
  options: ComboboxOption[];
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const selectedOption = options.find((option) => option.value === value);

  const renderOptionIcon = (option: ComboboxOption) => {
    if (!option.icon && !option.iconFallback) return null;
    return (
      <span
        className={cn(
          "inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md border",
          option.iconFrameClass ?? "border-border bg-background",
        )}
      >
        {option.icon ? (
          <img
            src={option.icon}
            alt={option.iconAlt ?? option.label}
            className={cn(
              "h-4 w-4 max-h-4 max-w-4 object-contain",
              option.iconClassName,
            )}
          />
        ) : (
          <span
            className={cn(
              "text-[9px] font-semibold",
              option.iconFallbackClassName,
            )}
          >
            {option.iconFallback}
          </span>
        )}
      </span>
    );
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild disabled={disabled}>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="min-w-[200px] justify-between"
        >
          {selectedOption ? (
            <span className="flex items-center gap-2">
              {renderOptionIcon(selectedOption)}
              <span>{selectedOption.label}</span>
            </span>
          ) : (
            placeholder
          )}
          <ChevronsUpDownIcon className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[200px] p-0">
        <Command>
          <CommandInput placeholder={placeholder} />
          <CommandList>
            <CommandEmpty>No option found.</CommandEmpty>
            <CommandGroup>
              {options.map((option) => (
                <div key={option.value}>
                  <CommandItem
                    value={option.value}
                    disabled={option.disabled}
                    onSelect={(currentValue) => {
                      if (option.disabled) {
                        return;
                      }
                      setOpen(false);
                      onChange(currentValue === value ? "" : currentValue);
                    }}
                    >
                    <span className="flex items-center gap-2 w-full">
                      {renderOptionIcon(option)}
                      <span>{option.label}</span>
                      <CheckIcon
                        className={cn(
                          "ml-auto h-4 w-4",
                          value === option.value ? "opacity-100" : "opacity-0",
                        )}
                      />
                    </span>
                  </CommandItem>
                  {option.disabled && option.disabledReason && (
                    <p className="text-[10px] text-muted-foreground px-2 pb-1 -mt-0.5">
                      {option.disabledReason}
                    </p>
                  )}
                </div>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

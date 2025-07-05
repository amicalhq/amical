import React, { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { X, Pencil, AlertCircle, Command } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface ShortcutInputProps {
  value?: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  isRecording?: boolean;
  onRecordingChange?: (recording: boolean) => void;
}

export function ShortcutInput({
  value,
  onChange,
  placeholder = "Not set",
  className,
  isRecording = false,
  onRecordingChange,
}: ShortcutInputProps) {
  const [keys, setKeys] = useState<Set<string>>(new Set());
  const inputRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isRecording) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      console.log("handleKeyDown", e);
      e.preventDefault();
      e.stopPropagation();

      const key = getKeyName(e);
      if (key) {
        setKeys((prev) => {
          const newKeys = new Set(prev);
          newKeys.add(key);
          return newKeys;
        });
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      // Build the shortcut string
      const shortcut = buildShortcutString(keys);
      if (shortcut) {
        onChange(shortcut);
      }

      onRecordingChange?.(false);
      setKeys(new Set());
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, [isRecording, keys, onChange, onRecordingChange]);

  const handleClick = () => {
    onRecordingChange?.(true);
    setKeys(new Set());
    inputRef.current?.focus();
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange("");
  };

  const getKeyName = (e: KeyboardEvent): string => {
    const specialKeys: Record<string, string> = {
      Control: "Ctrl",
      Meta: "Cmd",
      Alt: "Alt",
      Shift: "Shift",
      " ": "Space",
      ArrowUp: "Up",
      ArrowDown: "Down",
      ArrowLeft: "Left",
      ArrowRight: "Right",
      Enter: "Enter",
      Tab: "Tab",
      Escape: "Esc",
      Backspace: "Backspace",
      Delete: "Delete",
      Home: "Home",
      End: "End",
      PageUp: "PageUp",
      PageDown: "PageDown",
      F1: "F1",
      F2: "F2",
      F3: "F3",
      F4: "F4",
      F5: "F5",
      F6: "F6",
      F7: "F7",
      F8: "F8",
      F9: "F9",
      F10: "F10",
      F11: "F11",
      F12: "F12",
    };

    // Handle modifier keys
    if (e.ctrlKey) keys.add("Ctrl");
    if (e.metaKey) keys.add("Cmd");
    if (e.altKey) keys.add("Alt");
    if (e.shiftKey) keys.add("Shift");

    if (e.key === "Fn" || e.code === "Fn") {
      keys.add("Fn");
    }

    // Get the main key
    const key = specialKeys[e.key] || e.key.toUpperCase();

    return key;
  };

  const buildShortcutString = (keys: Set<string>): string => {
    const modifiers = ["Cmd", "Ctrl", "Alt", "Shift", "Fn"];
    const sortedModifiers = modifiers.filter((mod) => keys.has(mod));
    const mainKeys = Array.from(keys).filter((key) => !modifiers.includes(key));

    if (keys.size === 0) return "";

    // Allow single key shortcuts
    if (mainKeys.length === 0 && sortedModifiers.length > 0) {
      return sortedModifiers.join("+");
    }

    return [...sortedModifiers, ...mainKeys].join("+");
  };

  return (
    <TooltipProvider>
      <div className={cn("inline-flex items-center gap-2", className)}>
        {isRecording ? (
          <div
            ref={inputRef}
            className="inline-flex items-center gap-2 px-3 py-1 bg-muted rounded-md ring-2 ring-primary"
            tabIndex={0}
          >
            <span className="text-sm text-muted-foreground">Press keys...</span>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="h-6 px-2">
                  <Command className="h-3 w-3 mr-1" />
                  Special
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem
                  onClick={() => {
                    onChange("Fn");
                    onRecordingChange?.(false);
                    setKeys(new Set());
                  }}
                >
                  Fn Key
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => {
                    onChange("Fn+Space");
                    onRecordingChange?.(false);
                    setKeys(new Set());
                  }}
                >
                  Fn+Space
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ) : (
          <>
            {value ? (
              <kbd
                onClick={handleClick}
                className="inline-flex items-center px-3 py-1 bg-muted hover:bg-muted/70 rounded-md text-sm font-mono cursor-pointer transition-colors"
              >
                {value}
              </kbd>
            ) : (
              <span
                onClick={handleClick}
                className="inline-flex items-center px-3 py-1 text-sm text-muted-foreground hover:text-foreground cursor-pointer transition-colors"
              >
                {placeholder}
              </span>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0"
              onClick={handleClick}
            >
              <Pencil className="h-3 w-3" />
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="h-6 w-6 p-0">
                  <Command className="h-3 w-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem
                  onClick={() => {
                    onChange("Fn");
                  }}
                >
                  Set to Fn
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => {
                    onChange("Fn+Space");
                  }}
                >
                  Set to Fn+Space
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            {value && (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0"
                onClick={handleClear}
              >
                <X className="h-3 w-3" />
              </Button>
            )}
          </>
        )}
      </div>
    </TooltipProvider>
  );
}

"use client";

import * as React from "react";
import { IconSearch } from "@tabler/icons-react";
import { DynamicIcon } from "lucide-react/dynamic";
import { useNavigate } from "@tanstack/react-router";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Button } from "@/components/ui/button";
import { api } from "@/trpc/react";
import { FileTextIcon } from "lucide-react";

// Detect platform for keyboard shortcuts
const isMac =
  typeof navigator !== "undefined" &&
  navigator.platform.toUpperCase().indexOf("MAC") >= 0;

export function CommandSearchButton() {
  const [open, setOpen] = React.useState(false);
  const [search, setSearch] = React.useState("");
  const navigate = useNavigate();

  // Use the search API with debouncing
  const { data: searchResults = [] } = api.settings.searchSettings.useQuery(
    { query: search },
    {
      enabled: open, // Only search when dialog is open
      staleTime: 1000 * 60 * 5, // Cache for 5 minutes
    }
  );

  React.useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((open) => !open);
      }
    };

    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, []);

  const shortcutDisplay = isMac ? "⌘ K" : "Ctrl+K";

  const handleSelect = (url: string) => {
    setOpen(false);
    setSearch("");
    navigate({ to: url });
  };

  return (
    <>
      <Button
        variant="outline"
        className="w-full justify-start gap-2 px-2 h-8 text-sm font-normal"
        onClick={() => setOpen(true)}
      >
        <IconSearch className="h-4 w-4" />
        <span className="flex-1 text-left">Search...</span>
        <kbd className="pointer-events-none inline-flex h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground ml-auto">
          {shortcutDisplay}
        </kbd>
      </Button>

      <CommandDialog open={open} onOpenChange={setOpen}>
        <CommandInput
          placeholder="Search settings and notes..."
          value={search}
          onValueChange={setSearch}
        />
        <CommandList>
          <CommandEmpty>No results found.</CommandEmpty>
          {(() => {
            // Separate results by type
            const settingsResults = searchResults.filter(
              (item) => item.type === "settings"
            );
            const noteResults = searchResults.filter(
              (item) => item.type === "note"
            );

            return (
              <>
                {settingsResults.length > 0 && (
                  <CommandGroup heading="Settings">
                    {settingsResults.map((page) => (
                      <CommandItem
                        key={page.url}
                        value={page.title}
                        onSelect={() => handleSelect(page.url)}
                        className="cursor-pointer"
                      >
                        <DynamicIcon
                          name={
                            page.icon as Parameters<
                              typeof DynamicIcon
                            >[0]["name"]
                          }
                          className="mr-2 h-4 w-4"
                        />
                        <div className="flex flex-col">
                          <span className="font-medium">{page.title}</span>
                          <span className="text-xs text-muted-foreground">
                            {page.description}
                          </span>
                        </div>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                )}
                {noteResults.length > 0 && (
                  <CommandGroup heading="Notes">
                    {noteResults.map((note) => (
                      <CommandItem
                        key={note.url}
                        value={note.title}
                        onSelect={() => handleSelect(note.url)}
                        className="cursor-pointer"
                      >
                        {note.icon === "file-text" ? (
                          <FileTextIcon className="mr-2 h-4 w-4" />
                        ) : (
                          <span className="mr-2 text-xl">{note.icon}</span>
                        )}
                        <div className="flex flex-col">
                          <span className="font-medium">{note.title}</span>
                          <span className="text-xs text-muted-foreground">
                            {note.description}
                          </span>
                        </div>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                )}
              </>
            );
          })()}
        </CommandList>
      </CommandDialog>
    </>
  );
}

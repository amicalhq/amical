"use client";

import * as React from "react";
import { IconSearch } from "@tabler/icons-react";
import { useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { SidebarMenuButton } from "@/components/ui/sidebar";
import { api } from "@/trpc/react";
import { FileTextIcon } from "lucide-react";
import { formatDate } from "@/lib/utils";
import { SETTINGS_NAV_ITEMS } from "../lib/settings-navigation";

// Detect platform for keyboard shortcuts
const isMac = window.electronAPI.platform === "darwin";

export function CommandSearchButton() {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = React.useState(false);
  const [search, setSearch] = React.useState("");
  const navigate = useNavigate();

  const localizedSettings = React.useMemo(
    () =>
      SETTINGS_NAV_ITEMS.map((page) => ({
        ...page,
        title: t(page.titleKey),
        description: t(page.descriptionKey),
      })),
    [t, i18n.language],
  );

  // Client-side filtering for settings
  const settingsResults = React.useMemo(() => {
    const query = search.toLowerCase().trim();
    if (!query) {
      return localizedSettings;
    }
    return localizedSettings.filter((page) => {
      const searchText = [page.title, page.description].join(" ").toLowerCase();
      return searchText.includes(query);
    });
  }, [search, localizedSettings]);

  const { data: noteResults = [] } = api.notes.searchNotes.useQuery(
    { query: search },
    {
      enabled: open,
      staleTime: 1000 * 60 * 5,
    },
  );

  const searchResults = React.useMemo(() => {
    return [
      ...settingsResults,
      ...noteResults.map((n) => ({
        ...n,
        url: `/settings/notes/${n.id}`,
        description: formatDate(new Date(n.createdAt)),
        type: "note" as const,
        icon: n.icon || "file-text",
      })),
    ];
  }, [settingsResults, noteResults]);

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
      <SidebarMenuButton onClick={() => setOpen(true)}>
        <IconSearch />
        <span>{t("settings.search.buttonLabel")}</span>
        <kbd className="pointer-events-none inline-flex h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground ml-auto">
          {shortcutDisplay}
        </kbd>
      </SidebarMenuButton>

      <CommandDialog open={open} onOpenChange={setOpen}>
        <CommandInput
          placeholder={t("settings.search.inputPlaceholder")}
          value={search}
          onValueChange={setSearch}
        />
        <CommandList>
          <CommandEmpty>{t("settings.search.noResults")}</CommandEmpty>
          {(() => {
            // Separate results by type
            const noteResults = searchResults.filter(
              (item) => item.type === "note",
            );
            const settingsResults = searchResults.filter(
              (item) => item.type === "settings",
            );

            return (
              <>
                {settingsResults.length > 0 && (
                  <CommandGroup heading={t("settings.search.settingsHeading")}>
                    {settingsResults.map((page) => (
                      <CommandItem
                        key={page.url}
                        value={page.title}
                        onSelect={() => handleSelect(page.url)}
                        className="cursor-pointer"
                      >
                        {typeof page.icon === "string" ? (
                          <span className="mr-2 text-xl">{page.icon}</span>
                        ) : (
                          <page.icon className="mr-2 h-4 w-4" />
                        )}
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
                  <CommandGroup heading={t("settings.search.notesHeading")}>
                    {noteResults.map((note) => (
                      <CommandItem
                        key={note.url}
                        value={note.title}
                        onSelect={() => handleSelect(note.url)}
                        className="cursor-pointer"
                      >
                        {note.icon ? (
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

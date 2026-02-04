import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { MarkdownShortcutPlugin } from "@lexical/react/LexicalMarkdownShortcutPlugin";
import { ListPlugin } from "@lexical/react/LexicalListPlugin";
import { CheckListPlugin } from "@lexical/react/LexicalCheckListPlugin";
import { TabIndentationPlugin } from "@lexical/react/LexicalTabIndentationPlugin";
import { AutoFocusPlugin } from "@lexical/react/LexicalAutoFocusPlugin";
import { ClickableLinkPlugin } from "@lexical/react/LexicalClickableLinkPlugin";
import { AutoLinkPlugin } from "@lexical/react/LexicalAutoLinkPlugin";
import { HeadingNode, QuoteNode } from "@lexical/rich-text";
import { ListNode, ListItemNode } from "@lexical/list";
import {
  CodeNode,
  CodeHighlightNode,
  registerCodeHighlighting,
} from "@lexical/code";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { LinkNode, AutoLinkNode } from "@lexical/link";
import { HorizontalRuleNode } from "@lexical/react/LexicalHorizontalRuleNode";
import { TRANSFORMERS } from "@lexical/markdown";
import { Loader2 } from "lucide-react";
import { NoteSyncProvider } from "@/renderer/main/providers/sync-provider";
import { YjsSyncPlugin } from "@/renderer/main/components/editor/yjs-sync-plugin";
import { CodeBlockShortcutPlugin } from "@/renderer/main/components/editor/code-block-plugin";
import { ChecklistShortcutPlugin } from "@/renderer/main/components/editor/checklist-shortcut-plugin";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

interface NoteEditorProps {
  noteId: number;
  onSyncStatusChange?: (isSyncing: boolean) => void;
  onReady?: () => void;
}

const theme = {
  paragraph: "mb-0.5",
  heading: {
    h1: "text-3xl font-bold mt-4 mb-2",
    h2: "text-2xl font-bold mt-3 mb-1.5",
    h3: "text-xl font-bold mt-2 mb-1",
    h4: "text-lg font-bold mt-2 mb-1",
    h5: "text-base font-bold mt-1 mb-0.5",
  },
  quote: "border-l-4 border-gray-300 pl-4 italic text-muted-foreground my-1",
  list: {
    ul: "list-disc list-inside ml-4 my-1",
    ol: "list-decimal list-inside ml-4 my-1",
    listitem: "my-0",
    checklist: "list-none ml-0 my-1",
    listitemChecked: "listitemChecked",
    listitemUnchecked: "listitemUnchecked",
    nested: {
      listitem: "list-none",
    },
  },
  code: "bg-muted block px-4 py-3 rounded-lg font-mono text-sm my-2 overflow-x-auto whitespace-pre",
  codeHighlight: {
    atrule: "text-purple-500",
    attr: "text-blue-500",
    boolean: "text-orange-500",
    builtin: "text-cyan-500",
    cdata: "text-gray-500",
    char: "text-green-500",
    class: "text-yellow-500",
    "class-name": "text-yellow-500",
    comment: "text-gray-400 italic",
    constant: "text-orange-500",
    deleted: "text-red-500",
    doctype: "text-gray-500",
    entity: "text-orange-500",
    function: "text-blue-500",
    important: "text-red-500 font-bold",
    inserted: "text-green-500",
    keyword: "text-purple-500",
    namespace: "text-gray-500",
    number: "text-orange-500",
    operator: "text-gray-600",
    prolog: "text-gray-500",
    property: "text-blue-500",
    punctuation: "text-gray-600",
    regex: "text-orange-500",
    selector: "text-green-500",
    string: "text-green-500",
    symbol: "text-orange-500",
    tag: "text-red-500",
    url: "text-cyan-500",
    variable: "text-orange-500",
  },
  link: "text-muted-foreground underline underline-offset-2 cursor-pointer hover:text-foreground",
  text: {
    bold: "font-bold",
    italic: "italic",
    underline: "underline",
    strikethrough: "line-through",
    code: "bg-muted px-1 py-0.5 rounded font-mono text-sm",
  },
  hr: "my-4 border-t border-border",
};

function onError(error: Error): void {
  console.error("Lexical error:", error);
}

// Plugin to enable code syntax highlighting
function CodeHighlightPlugin(): null {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    return registerCodeHighlighting(editor);
  }, [editor]);

  return null;
}

// All nodes needed for markdown support
const EDITOR_NODES = [
  HeadingNode,
  QuoteNode,
  ListNode,
  ListItemNode,
  CodeNode,
  CodeHighlightNode,
  LinkNode,
  AutoLinkNode,
  HorizontalRuleNode,
];

// URL and email matchers for AutoLinkPlugin
// Matches URLs with or without protocol (e.g., google.com, www.google.com, https://google.com)
const URL_REGEX =
  /(https?:\/\/)?(www\.)?[-a-zA-Z0-9@:%._+~#=]{1,256}\.[a-zA-Z]{2,6}\b([-a-zA-Z0-9()@:%_+.~#?&//=]*)/;

const EMAIL_REGEX =
  /(([^<>()[\]\\.,;:\s@"]+(\.[^<>()[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))/;

const MATCHERS = [
  // Email matcher should come first to prevent emails from being matched as URLs
  (text: string) => {
    const match = EMAIL_REGEX.exec(text);
    if (match) {
      const fullMatch = match[0];
      return {
        index: match.index,
        length: fullMatch.length,
        text: fullMatch,
        url: `mailto:${fullMatch}`,
      };
    }
    return null;
  },
  (text: string) => {
    const match = URL_REGEX.exec(text);
    if (match) {
      const fullMatch = match[0];
      // Skip if it looks like part of an email (has @ before)
      const textBefore = text.slice(0, match.index);
      if (textBefore.includes("@")) {
        return null;
      }
      return {
        index: match.index,
        length: fullMatch.length,
        text: fullMatch,
        url: fullMatch.startsWith("http") ? fullMatch : `https://${fullMatch}`,
      };
    }
    return null;
  },
];

export function NoteEditor({
  noteId,
  onSyncStatusChange,
  onReady,
}: NoteEditorProps): React.ReactNode {
  const { t } = useTranslation();
  const [isLoading, setIsLoading] = useState(true);
  const [syncProvider, setSyncProvider] = useState<NoteSyncProvider | null>(
    null,
  );
  const providerRef = useRef<NoteSyncProvider | null>(null);
  const destroyQueueRef = useRef<Array<NoteSyncProvider>>([]);
  const onReadyCalledRef = useRef(false);
  const onSaveErrorRef = useRef(() =>
    toast.error(t("settings.notes.toast.saveFailed")),
  );

  // Handle sync status changes and propagate to parent
  const handleSyncStatusChange = useCallback(
    (isSyncing: boolean) => {
      onSyncStatusChange?.(isSyncing);
    },
    [onSyncStatusChange],
  );

  // Reset onReady tracking when noteId changes
  useEffect(() => {
    onReadyCalledRef.current = false;
  }, [noteId]);

  useEffect(() => {
    onSaveErrorRef.current = () =>
      toast.error(t("settings.notes.toast.saveFailed"));
  }, [t]);

  // Notify parent when editor is ready
  useEffect(() => {
    if (!isLoading && syncProvider && !onReadyCalledRef.current) {
      onReadyCalledRef.current = true;
      onReady?.();
    }
  }, [isLoading, syncProvider, onReady]);

  // After `syncProvider` changes (either unmounting or swapping to a new
  // provider), it is safe to destroy the previous provider(s). This ensures
  // YjsSyncPlugin can flush any pending debounced writes during its cleanup
  // while the persistence listener is still attached.
  useEffect(() => {
    if (destroyQueueRef.current.length === 0) return;

    const providersToDestroy = destroyQueueRef.current;
    destroyQueueRef.current = [];

    providersToDestroy.forEach((provider) => {
      provider.destroy();
    });
  }, [syncProvider]);

  useEffect(() => {
    let mounted = true;

    const initProvider = async () => {
      // Reset loading state to unmount editor when switching notes
      setIsLoading(true);
      setSyncProvider(null);

      // Queue the previous provider for destruction after unmount. This avoids
      // dropping any pending debounced flushes when switching notes quickly.
      if (providerRef.current) {
        destroyQueueRef.current.push(providerRef.current);
        providerRef.current = null;
      }

      const provider = new NoteSyncProvider({
        noteId,
        onSaveError: () => onSaveErrorRef.current(),
      });

      providerRef.current = provider;

      try {
        await provider.loadFromLocal();
      } catch (error) {
        console.error("Failed to load note content:", error);
      }

      if (mounted) {
        setSyncProvider(provider);
        setIsLoading(false);
      }
    };

    initProvider();

    return () => {
      mounted = false;
    };
  }, [noteId]);

  // Clean up providers on unmount.
  useEffect(() => {
    return () => {
      if (providerRef.current) {
        providerRef.current.destroy();
        providerRef.current = null;
      }

      destroyQueueRef.current.forEach((provider) => {
        provider.destroy();
      });
      destroyQueueRef.current = [];
    };
  }, []);

  const initialConfig = useMemo(
    () => ({
      namespace: `note-${noteId}`,
      theme,
      onError,
      nodes: EDITOR_NODES,
    }),
    [noteId],
  );

  if (isLoading || !syncProvider) {
    return (
      <div className="flex items-center justify-center min-h-[200px]">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <LexicalComposer initialConfig={initialConfig}>
      <div className="relative">
        <RichTextPlugin
          contentEditable={
            <ContentEditable
              className="min-h-[500px] px-4 py-2 outline-none text-base leading-relaxed"
              aria-placeholder={t("settings.notes.note.bodyPlaceholder")}
              placeholder={
                <div className="absolute top-2 left-4 text-muted-foreground pointer-events-none">
                  {t("settings.notes.note.bodyPlaceholder")}
                </div>
              }
            />
          }
          ErrorBoundary={LexicalErrorBoundary}
        />
        <HistoryPlugin />
        <AutoFocusPlugin />
        <ListPlugin />
        <CheckListPlugin />
        <TabIndentationPlugin />
        <ClickableLinkPlugin />
        <AutoLinkPlugin matchers={MATCHERS} />
        <CodeHighlightPlugin />
        <CodeBlockShortcutPlugin />
        <ChecklistShortcutPlugin />
        <MarkdownShortcutPlugin transformers={TRANSFORMERS} />
        <YjsSyncPlugin
          yText={syncProvider.getText()}
          onSyncStatusChange={handleSyncStatusChange}
        />
      </div>
    </LexicalComposer>
  );
}

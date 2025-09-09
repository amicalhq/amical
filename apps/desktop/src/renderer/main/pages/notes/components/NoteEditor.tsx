import React, {
  useEffect,
  useRef,
  useState,
  useCallback,
  useMemo,
} from "react";
import * as Y from "yjs";
import { X, Save, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { formatDistanceToNow } from "date-fns";
import type { Note } from "../../../../../db/schema";
import { useDebounce } from "../../../hooks/useDebounce";
import { debounce } from "../../../utils/debounce";

interface NoteEditorProps {
  note: Note;
  onUpdateTitle: (title: string) => void;
  onClose: () => void;
}

export function NoteEditor({ note, onUpdateTitle, onClose }: NoteEditorProps) {
  const [title, setTitle] = useState(note.title);
  const [content, setContent] = useState("");
  const [isSyncing, setIsSyncing] = useState(true);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const ydocRef = useRef<Y.Doc | null>(null);
  const textRef = useRef<Y.Text | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Debounce title updates
  const debouncedTitle = useDebounce(title, 500);

  // Update title when debounced value changes
  useEffect(() => {
    if (debouncedTitle !== note.title) {
      onUpdateTitle(debouncedTitle);
    }
  }, [debouncedTitle, note.title, onUpdateTitle]);

  // Debounced yjs update function
  const debouncedYjsUpdate = useMemo(
    () =>
      debounce((newContent: string) => {
        if (textRef.current && ydocRef.current) {
          console.log("[YJS Debug] Debounced update - applying to Y.Text");
          ydocRef.current.transact(() => {
            const oldLength = textRef.current!.length;
            textRef.current!.delete(0, oldLength);
            textRef.current!.insert(0, newContent);
            console.log(
              "[YJS Debug] Y.Text updated via debounce - old length:",
              oldLength,
              "new length:",
              textRef.current!.length,
            );
          }, "user-input-debounced");
        }
      }, 500), // 500ms debounce
    [],
  );

  // Initialize yjs document and load content
  useEffect(() => {
    // Cancel any pending updates from previous note
    debouncedYjsUpdate.cancel();

    let mounted = true;

    const initializeYjs = async () => {
      try {
        // Create yjs document
        const ydoc = new Y.Doc();
        const text = ydoc.getText("content");

        console.log("[YJS Debug] Y.Doc created for note:", note.docName);
        console.log("[YJS Debug] Initial Y.Text length:", text.length);

        // Store references
        ydocRef.current = ydoc;
        textRef.current = text;

        // Expose to window for debugging (remove in production)
        if (process.env.NODE_ENV === "development") {
          (window as any).__ydoc = ydoc;
          (window as any).__ytext = text;
          console.log(
            "[YJS Debug] Exposed window.__ydoc and window.__ytext for debugging",
          );
        }

        // Load existing yjs updates from backend
        try {
          const updates = await window.electronAPI.notes.loadYjsUpdates(
            note.docName,
          );
          console.log(
            "[YJS Debug] Loaded",
            updates.length,
            "yjs updates from database",
          );

          if (updates.length > 0) {
            // Apply all updates to reconstruct the document
            updates.forEach((update: ArrayBuffer) => {
              Y.applyUpdate(ydoc, new Uint8Array(update));
            });

            // Set content from the reconstructed document
            const reconstructedContent = text.toString();
            setContent(reconstructedContent);
            console.log(
              "[YJS Debug] Reconstructed content:",
              reconstructedContent.length,
              "characters",
            );
          }
        } catch (error) {
          console.error("[YJS Debug] Failed to load yjs updates:", error);
        }

        setIsSyncing(false);

        // Listen for changes from yjs
        const observer = (event: any, transaction: any) => {
          if (!mounted) return;
          const newContent = text.toString();
          console.log(
            "[YJS Debug] Observer fired - Y.Text content:",
            newContent,
          );
          console.log("[YJS Debug] Transaction origin:", transaction.origin);
          console.log("[YJS Debug] Y.Text length:", text.length);
          setContent(newContent);
          setLastSaved(new Date());
        };

        text.observe(observer);

        // Save yjs updates to backend
        ydoc.on("update", async (update: Uint8Array, origin: any) => {
          console.log(
            "[YJS Debug] Y.Doc update event - update size:",
            update.length,
            "origin:",
            origin,
          );

          // Send update to backend for persistence
          try {
            // Convert Uint8Array to ArrayBuffer for IPC
            const buffer = update.buffer.slice(
              update.byteOffset,
              update.byteOffset + update.byteLength,
            );
            await window.electronAPI.notes.saveYjsUpdate(note.docName, buffer);
            console.log("[YJS Debug] Yjs update saved to database");
          } catch (error) {
            console.error("[YJS Debug] Failed to save yjs update:", error);
          }
        });

        // Cleanup
        return () => {
          text.unobserve(observer);
        };
      } catch (error) {
        console.error("Failed to initialize yjs:", error);
        setIsSyncing(false);
      }
    };

    initializeYjs();

    return () => {
      mounted = false;
      // Cancel any pending debounced updates
      debouncedYjsUpdate.cancel();
    };
  }, [note.docName, note.id, debouncedYjsUpdate]);

  // Handle content changes
  const handleContentChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const newContent = e.target.value;

      // Immediate UI update for smooth typing
      setContent(newContent);

      // Debounced yjs update (will fire 500ms after user stops typing)
      debouncedYjsUpdate(newContent);
    },
    [debouncedYjsUpdate],
  );

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height =
        textareaRef.current.scrollHeight + "px";
    }
  }, [content]);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b">
        <div className="flex items-center gap-4 flex-1">
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="text-lg font-semibold border-none focus-visible:ring-0 px-0"
            placeholder="Note title..."
          />
          {isSyncing && (
            <Badge variant="secondary" className="animate-pulse">
              <Clock className="h-3 w-3 mr-1" />
              Syncing...
            </Badge>
          )}
          {!isSyncing && lastSaved && (
            <span className="text-xs text-muted-foreground">
              Saved {formatDistanceToNow(lastSaved, { addSuffix: true })}
            </span>
          )}
        </div>
        <Button variant="ghost" size="icon" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* Editor */}
      <div className="flex-1 p-4 overflow-auto">
        <Textarea
          ref={textareaRef}
          value={content}
          onChange={handleContentChange}
          placeholder="Start typing your note..."
          className="w-full min-h-[300px] resize-none border-none focus-visible:ring-0 text-base"
          disabled={isSyncing}
        />
      </div>

      {/* Footer */}
      <div className="p-4 border-t">
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>
            Created{" "}
            {formatDistanceToNow(new Date(note.createdAt), { addSuffix: true })}
          </span>
          <div className="flex items-center gap-4">
            <span>{content.length} characters</span>
            {process.env.NODE_ENV === "development" && ydocRef.current && (
              <span className="text-xs bg-green-100 text-green-800 px-2 py-1 rounded">
                YJS Active
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

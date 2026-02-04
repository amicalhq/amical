import { useEffect, useRef, useMemo, useCallback } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import type * as Y from "yjs";
import { debounce } from "@/renderer/main/utils/debounce";

interface YjsSyncPluginProps {
  yText: Y.Text;
  onSyncStatusChange?: (isSyncing: boolean) => void;
}

export function YjsSyncPlugin({
  yText,
  onSyncStatusChange,
}: YjsSyncPluginProps): null {
  const [editor] = useLexicalComposerContext();
  const isUpdatingFromYjsRef = useRef(false);
  const isUpdatingFromLexicalRef = useRef(false);
  const hasPendingRef = useRef(false);
  const pendingJsonRef = useRef<string | null>(null);
  const onSyncStatusChangeRef = useRef(onSyncStatusChange);

  // Keep the callback ref up to date
  useEffect(() => {
    onSyncStatusChangeRef.current = onSyncStatusChange;
  }, [onSyncStatusChange]);

  const writeJsonToYjs = useCallback(
    (jsonString: string) => {
      if (isUpdatingFromYjsRef.current) {
        onSyncStatusChangeRef.current?.(false);
        return;
      }

      isUpdatingFromLexicalRef.current = true;
      try {
        const yDoc = yText.doc;
        if (yDoc) {
          yDoc.transact(() => {
            const oldLength = yText.length;
            yText.delete(0, oldLength);
            yText.insert(0, jsonString);
          }, "lexical-sync");
        }
      } finally {
        isUpdatingFromLexicalRef.current = false;
        hasPendingRef.current = false;
        pendingJsonRef.current = null;
        onSyncStatusChangeRef.current?.(false);
      }
    },
    [yText],
  );

  // Create debounced sync function once per yText instance
  const debouncedSync = useMemo(
    () => debounce((jsonString: string) => writeJsonToYjs(jsonString), 500),
    [writeJsonToYjs],
  );

  useEffect(() => {
    const setEditorStateFromJson = (jsonString: string) => {
      isUpdatingFromYjsRef.current = true;
      try {
        const editorState = editor.parseEditorState(jsonString);
        editor.setEditorState(editorState);
      } finally {
        isUpdatingFromYjsRef.current = false;
      }
    };

    // Set initial content from Yjs (stored as JSON)
    const storedContent = yText.toString();
    if (storedContent) {
      try {
        setEditorStateFromJson(storedContent);
      } catch (error) {
        console.warn("Failed to parse stored content as editor state:", error);
      }
    }
    onSyncStatusChangeRef.current?.(false);

    // Observer for Yjs changes -> Lexical
    const yjsObserver = () => {
      if (isUpdatingFromLexicalRef.current) return;

      const newContent = yText.toString();

      if (newContent) {
        try {
          const currentJson = JSON.stringify(editor.getEditorState().toJSON());
          if (currentJson !== newContent) {
            setEditorStateFromJson(newContent);
          }
        } catch (error) {
          console.warn("Failed to parse Yjs content as editor state:", error);
        }
      }
    };

    yText.observe(yjsObserver);

    // Listener for Lexical changes -> Yjs (save as JSON)
    const removeUpdateListener = editor.registerUpdateListener(
      ({ editorState, dirtyElements, dirtyLeaves }) => {
        // Skip if triggered by Yjs sync or no actual changes
        if (
          isUpdatingFromYjsRef.current ||
          (dirtyElements.size === 0 && dirtyLeaves.size === 0)
        ) {
          return;
        }

        const jsonString = JSON.stringify(editorState.toJSON());
        const currentYjsContent = yText.toString();

        if (jsonString === currentYjsContent) {
          if (hasPendingRef.current) {
            debouncedSync.cancel();
            hasPendingRef.current = false;
            pendingJsonRef.current = null;
            onSyncStatusChangeRef.current?.(false);
          }
          return;
        }

        if (jsonString !== currentYjsContent) {
          pendingJsonRef.current = jsonString;
          hasPendingRef.current = true;
          onSyncStatusChangeRef.current?.(true);
          debouncedSync(jsonString);
        }
      },
    );

    return () => {
      if (hasPendingRef.current && pendingJsonRef.current) {
        writeJsonToYjs(pendingJsonRef.current);
      }
      yText.unobserve(yjsObserver);
      removeUpdateListener();
      debouncedSync.cancel();
    };
  }, [editor, yText, debouncedSync]);

  return null;
}

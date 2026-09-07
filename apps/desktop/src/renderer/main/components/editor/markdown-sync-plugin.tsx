import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  CLEAR_HISTORY_COMMAND,
  COMMAND_PRIORITY_CRITICAL,
  FORMAT_TEXT_COMMAND,
  type SerializedEditorState,
} from "lexical";
import { LinkNode, AutoLinkNode } from "@lexical/link";
import {
  editorStateToMarkdown,
  markdownToEditorState,
  isSafeNoteUrl,
} from "@/notes/markdown";
import {
  NoteSyncProvider,
  type NoteSaveIssue,
} from "@/renderer/main/providers/sync-provider";

const LOAD_TAG = "note-markdown-load";

export function MarkdownSyncPlugin({
  noteId,
  onStatus,
}: {
  noteId: string;
  onStatus?: (pending: boolean) => void;
}): React.ReactNode {
  const [editor] = useLexicalComposerContext();
  const { t } = useTranslation();
  const [issue, setIssue] = useState<NoteSaveIssue | "format">(null);
  const statusRef = useRef(onStatus);
  statusRef.current = onStatus;

  useEffect(() => {
    let provider: NoteSyncProvider;
    try {
      provider = new NoteSyncProvider(noteId);
    } catch {
      editor.setEditable(false);
      setIssue("error");
      return;
    }
    const load = () => {
      try {
        const state = markdownToEditorState(provider.body.markdown);
        editor.setEditorState(
          editor.parseEditorState(state as SerializedEditorState),
          { tag: LOAD_TAG },
        );
        // A replaced snapshot must not return via Undo.
        editor.dispatchCommand(CLEAR_HISTORY_COMMAND, undefined);
        if (!editor.isEditable()) editor.setEditable(true);
        setIssue(null);
      } catch {
        editor.setEditable(false);
        setIssue("error");
      }
    };
    provider.onBody = load;
    provider.onStatus = (hasPending, nextIssue) => {
      statusRef.current?.(hasPending);
      setIssue(nextIssue);
      if (nextIssue === "deleted") editor.setEditable(false);
    };
    const sanitizeLink = (node: LinkNode) => {
      if (isSafeNoteUrl(node.getURL())) return;
      for (const child of node.getChildren()) node.insertBefore(child);
      node.remove();
    };
    const removeLinkTransform = editor.registerNodeTransform(
      LinkNode,
      sanitizeLink,
    );
    const removeAutoLinkTransform = editor.registerNodeTransform(
      AutoLinkNode,
      sanitizeLink,
    );
    load();
    const remove = editor.registerUpdateListener(
      ({ editorState, dirtyElements, dirtyLeaves, tags }) => {
        if (
          tags.has(LOAD_TAG) ||
          (dirtyElements.size === 0 && dirtyLeaves.size === 0)
        )
          return;
        try {
          const body = editorStateToMarkdown(editorState.toJSON());
          provider.queue(body);
        } catch {
          provider.holdUnsupportedEdit();
          statusRef.current?.(true);
          setIssue("format");
        }
      },
    );
    const removeFormat = editor.registerCommand(
      FORMAT_TEXT_COMMAND,
      (format) => {
        if (["bold", "italic", "strikethrough", "code"].includes(format))
          return false;
        return true;
      },
      COMMAND_PRIORITY_CRITICAL,
    );
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!provider.flush()) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      remove();
      removeFormat();
      removeLinkTransform();
      removeAutoLinkTransform();
      window.removeEventListener("beforeunload", beforeUnload);
      provider.destroy();
    };
  }, [editor, noteId]);

  if (!issue) return null;
  return (
    <div role="alert" className="order-first p-4 text-sm">
      {t(
        `settings.notes.recovery.${issue === "deleted" ? "deletedNote" : issue}`,
      )}
    </div>
  );
}

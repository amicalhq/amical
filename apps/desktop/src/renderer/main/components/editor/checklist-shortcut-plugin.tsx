import { useEffect } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $createListItemNode, $createListNode } from "@lexical/list";
import {
  $getSelection,
  $isRangeSelection,
  $isParagraphNode,
  KEY_SPACE_COMMAND,
  COMMAND_PRIORITY_HIGH,
} from "lexical";

/**
 * Plugin that handles checklist creation with [] shortcut.
 * Type [] at the start of a line and press Space to create a checklist item.
 */
export function ChecklistShortcutPlugin(): null {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    return editor.registerCommand(
      KEY_SPACE_COMMAND,
      (event) => {
        const selection = $getSelection();

        if (!$isRangeSelection(selection) || !selection.isCollapsed()) {
          return false;
        }

        const anchorNode = selection.anchor.getNode();
        const parentNode = anchorNode.getParent();

        // Only trigger in paragraphs to avoid invalid list structures
        if (!$isParagraphNode(parentNode)) {
          return false;
        }

        const textContent = anchorNode.getTextContent();

        // Match [] or [ ] at the start
        if (textContent === "[]" || textContent === "[ ]") {
          event?.preventDefault();

          const listItem = $createListItemNode(false); // false = unchecked checkbox
          const list = $createListNode("check");
          list.append(listItem);

          if (parentNode) {
            parentNode.replace(list);
            listItem.selectStart();
          }

          return true;
        }

        // Match [x] for checked item
        if (textContent === "[x]" || textContent === "[X]") {
          event?.preventDefault();

          const listItem = $createListItemNode(true); // true = checked checkbox
          const list = $createListNode("check");
          list.append(listItem);

          if (parentNode) {
            parentNode.replace(list);
            listItem.selectStart();
          }

          return true;
        }

        return false;
      },
      COMMAND_PRIORITY_HIGH,
    );
  }, [editor]);

  return null;
}

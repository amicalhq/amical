import { useEffect } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $createCodeNode, $isCodeNode } from "@lexical/code";
import {
  $getSelection,
  $isRangeSelection,
  KEY_ENTER_COMMAND,
  COMMAND_PRIORITY_HIGH,
} from "lexical";
import { $isListItemNode } from "@lexical/list";
import { $isHeadingNode } from "@lexical/rich-text";

/**
 * Plugin that handles code block creation with triple backticks.
 * Type ``` at the start of a line and press Enter to create a code block.
 * Optionally include a language: ```js, ```python, etc.
 */
export function CodeBlockShortcutPlugin(): null {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    return editor.registerCommand(
      KEY_ENTER_COMMAND,
      (event) => {
        const selection = $getSelection();

        if (!$isRangeSelection(selection) || !selection.isCollapsed()) {
          return false;
        }

        const anchorNode = selection.anchor.getNode();
        const parentNode = anchorNode.getParent();

        // Don't trigger in code blocks, list items, or headings
        if (
          $isCodeNode(parentNode) ||
          $isListItemNode(parentNode) ||
          $isHeadingNode(parentNode)
        ) {
          return false;
        }

        // Get the text content of the current block
        const textContent = anchorNode.getTextContent();

        // Match ``` optionally followed by a language identifier
        const codeBlockMatch = textContent.match(/^```(\w*)$/);

        if (codeBlockMatch) {
          event?.preventDefault();

          const language = codeBlockMatch[1] || undefined;
          const codeNode = $createCodeNode(language);

          // Replace the current paragraph with a code node
          if (parentNode) {
            parentNode.replace(codeNode);
            codeNode.selectStart();
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

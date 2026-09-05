import { $isParagraphNode, type EditorConfig, type LexicalNode } from "lexical";
import {
  $isListNode,
  ListItemNode,
  type SerializedListItemNode,
} from "@lexical/list";

// Lexical normally merges paragraph children into a list item's inline text.
// Markdown list items can contain multiple paragraphs, so keep those blocks.
export class NoteListItemNode extends ListItemNode {
  static getType() {
    return "note-listitem";
  }

  static clone(node: NoteListItemNode) {
    return new NoteListItemNode(node.__value, node.__checked, node.__key);
  }

  static importJSON(node: SerializedListItemNode) {
    return new NoteListItemNode().updateFromJSON(node);
  }

  canMergeWith(node: LexicalNode) {
    return !$isParagraphNode(node) && super.canMergeWith(node);
  }

  updateListItemDOM(
    prev: ListItemNode | null,
    dom: HTMLLIElement,
    config: EditorConfig,
  ) {
    super.updateListItemDOM(prev, dom, config);
    // Only a wrapper containing solely a nested list should hide its marker.
    if (this.getChildren().some((child) => !$isListNode(child))) {
      const classes =
        config.theme.list?.nested?.listitem?.split(/\s+/).filter(Boolean) ?? [];
      dom.classList.remove(...classes);
    }
  }
}

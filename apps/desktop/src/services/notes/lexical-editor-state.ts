type SerializedTextNode = {
  type: "text";
  version: 1;
  text: string;
  detail: 0;
  format: 0;
  mode: "normal";
  style: "";
};

type SerializedParagraphNode = {
  type: "paragraph";
  version: 1;
  children: SerializedTextNode[];
  direction: null;
  format: "";
  indent: 0;
};

type SerializedRootNode = {
  type: "root";
  version: 1;
  children: SerializedParagraphNode[];
  direction: null;
  format: "";
  indent: 0;
};

type SerializedEditorState = {
  root: SerializedRootNode;
};

export function isLexicalEditorStateJsonString(value: string): boolean {
  if (!value) return false;

  try {
    const parsed = JSON.parse(value) as Partial<SerializedEditorState> | null;
    const root =
      parsed && typeof parsed === "object"
        ? (parsed as Partial<SerializedEditorState>).root
        : undefined;

    return !!(
      root &&
      typeof root === "object" &&
      root.type === "root" &&
      Array.isArray(root.children)
    );
  } catch {
    return false;
  }
}

export function serializePlainTextToLexicalEditorStateJson(
  plainText: string,
): string {
  const lines = plainText.split(/\r?\n/);

  const paragraphs: SerializedParagraphNode[] = lines.map((line) => ({
    type: "paragraph",
    version: 1,
    direction: null,
    format: "",
    indent: 0,
    children:
      line.length > 0
        ? [
            {
              type: "text",
              version: 1,
              text: line,
              detail: 0,
              format: 0,
              mode: "normal",
              style: "",
            },
          ]
        : [],
  }));

  const state: SerializedEditorState = {
    root: {
      type: "root",
      version: 1,
      direction: null,
      format: "",
      indent: 0,
      children: paragraphs,
    },
  };

  return JSON.stringify(state);
}

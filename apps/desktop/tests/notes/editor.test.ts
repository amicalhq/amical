// @vitest-environment jsdom
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  getNearestEditorFromDOMNode,
  type LexicalEditor,
} from "lexical";
import { $createLinkNode } from "@lexical/link";
import { NoteEditor } from "@/renderer/main/pages/notes/components/note-editor";
import type { NoteBody } from "@/notes/types";
import { convertLegacyNote } from "@/notes/legacy";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
let body: Extract<NoteBody, { status: "ready" }>;
beforeEach(() => {
  window.sessionStorage.clear();
  Range.prototype.getBoundingClientRect = () => new DOMRect();
  body = { status: "ready", noteId: 1, markdown: "" };
  window.electronAPI = {
    notes: {
      loadBody: vi.fn(() => ({ ...body })),
      saveBody: vi.fn((_id: number, markdown: string) => {
        body = { ...body, markdown };
        return { status: "saved" };
      }),
      onBodyChange: vi.fn(() => () => {}),
    },
  } as unknown as typeof window.electronAPI;
});
afterEach(cleanup);
async function openEditor() {
  const view = render(createElement(NoteEditor, { noteId: 1 }));
  await waitFor(() =>
    expect(
      view.container.querySelector('[contenteditable="true"]'),
    ).not.toBeNull(),
  );
  const element = view.container.querySelector('[contenteditable="true"]')!;
  return {
    view,
    element,
    editor: getNearestEditorFromDOMNode(element) as LexicalEditor,
  };
}

describe("real NoteEditor Markdown integration", () => {
  it("opens a formerly unsupported legacy note in the normal editable Markdown editor", async () => {
    body.markdown = convertLegacyNote(
      [],
      JSON.stringify({
        root: {
          type: "root",
          children: [
            {
              type: "paragraph",
              format: "center",
              children: [
                {
                  type: "text",
                  text: "Original 👋",
                  format: 9,
                  style: "color:red",
                },
              ],
            },
          ],
        },
      }),
    );
    const { view, element, editor } = await openEditor();
    expect(element.querySelector("strong")?.textContent).toBe("Original 👋");
    expect(view.queryByRole("alert")).toBeNull();
    expect(window.electronAPI.notes.saveBody).not.toHaveBeenCalled();
    await act(async () =>
      editor.update(
        () => {
          $getRoot().append(
            $createParagraphNode().append($createTextNode("new edit")),
          );
        },
        { discrete: true },
      ),
    );
    await waitFor(() =>
      expect(window.electronAPI.notes.saveBody).toHaveBeenCalledOnce(),
    );
    view.unmount();
    const reopened = await openEditor();
    expect(reopened.element.textContent).toContain("new edit");
    expect(reopened.element.querySelector("strong")?.textContent).toBe(
      "Original 👋",
    );
  });
  it("saves a rich-text edit and reopens the durable Markdown as rich text", async () => {
    const { view, editor } = await openEditor();
    await act(async () =>
      editor.update(
        () => {
          $getRoot()
            .clear()
            .append(
              $createParagraphNode().append(
                $createTextNode("Bold 👋").toggleFormat("bold"),
                $createTextNode(" *literal*"),
              ),
            );
        },
        { discrete: true },
      ),
    );
    await waitFor(() =>
      expect(window.electronAPI.notes.saveBody).toHaveBeenCalledOnce(),
    );
    expect(body.markdown).toContain("**Bold 👋**");
    expect(body.markdown).toContain("\\*literal\\*");
    view.unmount();
    const reopened = await openEditor();
    expect(reopened.element.querySelector("strong")?.textContent).toBe(
      "Bold 👋",
    );
    expect(reopened.element.textContent).toContain("*literal*");
    expect(window.electronAPI.notes.saveBody).toHaveBeenCalledOnce();
  });
  it("opening code, links and lists does not save or normalize canonical Markdown", async () => {
    const original =
      "# Title\n\nhttps://example.com\n\n- one\n  - nested\n\n````js\nconst a = `hi`;\n```\n````\n\n\n";
    body.markdown = original;
    const { view, element } = await openEditor();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 350));
    });
    expect(element.querySelector("h1")?.textContent).toBe("Title");
    expect(element.querySelector("code")).not.toBeNull();
    view.unmount();
    expect(body.markdown).toBe(original);
    expect(window.electronAPI.notes.saveBody).not.toHaveBeenCalled();
  });
  it("flushes a pending edit in beforeunload before the debounce expires", async () => {
    const { editor } = await openEditor();
    await act(async () =>
      editor.update(
        () => {
          $getRoot().append(
            $createParagraphNode().append($createTextNode("closing")),
          );
        },
        { discrete: true },
      ),
    );
    expect(window.electronAPI.notes.saveBody).not.toHaveBeenCalled();
    act(() =>
      window.dispatchEvent(new Event("beforeunload", { cancelable: true })),
    );
    expect(body.markdown).toContain("closing");
  });
  it("neutralizes active link schemes introduced by rich-text paste", async () => {
    const { editor, element } = await openEditor();
    await act(async () =>
      editor.update(
        () => {
          $getRoot()
            .clear()
            .append(
              $createParagraphNode().append(
                $createLinkNode("javascript:alert(1)").append(
                  $createTextNode("unsafe label"),
                ),
              ),
            );
        },
        { discrete: true },
      ),
    );
    await waitFor(() =>
      expect(window.electronAPI.notes.saveBody).toHaveBeenCalledOnce(),
    );
    expect(element.querySelector("a")).toBeNull();
    expect(body.markdown).toBe("unsafe label\n");
  });
  it("saves the local edit last without a conflict prompt or close blocker", async () => {
    const { view, editor, element } = await openEditor();
    await act(async () =>
      editor.update(
        () => {
          $getRoot()
            .clear()
            .append(
              $createParagraphNode().append($createTextNode("local draft")),
            );
        },
        { discrete: true },
      ),
    );
    body = { ...body, markdown: "other window\n" };
    const close = new Event("beforeunload", { cancelable: true });
    act(() => window.dispatchEvent(close));
    expect(close.defaultPrevented).toBe(false);
    expect(body.markdown).toBe("local draft\n");
    expect(element.getAttribute("contenteditable")).toBe("true");
    expect(view.queryByRole("alert")).toBeNull();
    expect(view.queryByRole("button")).toBeNull();
    view.unmount();
    const reopened = await openEditor();
    expect(reopened.element.textContent).toBe("local draft");
  });
  it("does not flush a previous valid state over an unsupported edit", async () => {
    const { view, editor } = await openEditor();
    await act(async () =>
      editor.update(
        () => {
          $getRoot()
            .clear()
            .append(
              $createParagraphNode().append($createTextNode("valid pending")),
            );
        },
        { discrete: true },
      ),
    );
    await act(async () =>
      editor.update(
        () => {
          $getRoot()
            .clear()
            .append(
              $createParagraphNode().append(
                $createTextNode("unsupported draft").toggleFormat("underline"),
              ),
            );
        },
        { discrete: true },
      ),
    );
    const event = new Event("beforeunload", { cancelable: true });
    act(() => {
      window.dispatchEvent(event);
    });
    expect(event.defaultPrevented).toBe(true);
    expect(view.container.textContent).toContain("unsupported draft");
    view.unmount();
    expect(window.electronAPI.notes.saveBody).not.toHaveBeenCalled();
  });

  it("does not expose an editable empty note after failed load or migration", async () => {
    vi.mocked(window.electronAPI.notes.loadBody).mockReturnValue({
      status: "blocked",
      noteId: 1,
      reason: "Incomplete legacy editor updates",
    });
    const view = render(createElement(NoteEditor, { noteId: 1 }));
    expect(view.getByRole("alert").textContent).toBe(
      "settings.notes.recovery.blocked",
    );
    expect(view.container.textContent).not.toContain("original text");
    expect(view.queryByRole("button")).toBeNull();
    expect(view.container.querySelector("[contenteditable]")).toBeNull();
    expect(window.electronAPI.notes.saveBody).not.toHaveBeenCalled();
  });
});

it.each([
  ["- first\n\n  second\n", "firstsecond"],
  ["- before\n\n  - nested\n\n  after\n", "beforenestedafter"],
])(
  "keeps list order and paragraph boundaries through the real editor: %s",
  async (source, text) => {
    body.markdown = source;
    const { view, editor, element } = await openEditor();
    expect(element.textContent).toBe(text);
    expect(window.electronAPI.notes.saveBody).not.toHaveBeenCalled();
    await act(async () =>
      editor.update(
        () => {
          $getRoot().append(
            $createParagraphNode().append($createTextNode("unrelated edit")),
          );
        },
        { discrete: true },
      ),
    );
    act(() =>
      window.dispatchEvent(new Event("beforeunload", { cancelable: true })),
    );
    expect(body.markdown).toContain(source.trimEnd());
    view.unmount();
    const reopened = await openEditor();
    expect(reopened.element.textContent).toBe(text + "unrelated edit");
  },
);

it("does not leave a recovery notice after correcting an unsupported edit", async () => {
  const { view, editor } = await openEditor();
  await act(async () =>
    editor.update(
      () => {
        $getRoot()
          .clear()
          .append(
            $createParagraphNode().append(
              $createTextNode("temporary").toggleFormat("underline"),
            ),
          );
      },
      { discrete: true },
    ),
  );
  await act(async () =>
    editor.update(
      () => {
        $getRoot()
          .clear()
          .append($createParagraphNode().append($createTextNode("fixed")));
      },
      { discrete: true },
    ),
  );
  act(() =>
    window.dispatchEvent(new Event("beforeunload", { cancelable: true })),
  );
  expect(body.markdown).toBe("fixed\n");
  view.unmount();
  const reopened = await openEditor();
  expect(reopened.view.queryByRole("status")).toBeNull();
  expect(reopened.view.queryByRole("alert")).toBeNull();
  expect(window.sessionStorage.length).toBe(0);
});

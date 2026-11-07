// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import NotePage from "@/renderer/main/pages/notes/components/note-wrapper";
import { NotesWindowPanel } from "@/renderer/notes-widget/components/NotesWindowPanel";
import type { NoteBodyChange } from "@/notes/types";

const state = vi.hoisted(() => ({
  note: {
    id: "nt_abcdefghijklmnopqrstuvwx",
    title: "Meeting",
    icon: null as string | null,
    remoteVersion: 1,
    updatedAt: new Date(1000),
  },
  titleMutation: { mutateAsync: vi.fn(), isPending: false },
  iconMutation: { mutate: vi.fn() },
  otherMutation: { mutateAsync: vi.fn(), isPending: false },
  utils: {
    notes: {
      getNotes: { invalidate: vi.fn() },
      getNoteById: { invalidate: vi.fn(), fetch: vi.fn() },
    },
    settings: { getPreferences: { fetch: vi.fn() } },
  },
  preferences: { autoDictateOnNewNote: false },
}));
vi.mock("@/trpc/react", () => ({
  api: {
    useUtils: () => state.utils,
    notes: {
      getNoteById: {
        useQuery: () => ({
          data: state.note,
          isLoading: false,
          isError: false,
        }),
      },
      updateNoteTitle: { useMutation: () => state.titleMutation },
      updateNoteIcon: { useMutation: () => state.iconMutation },
      deleteNote: { useMutation: () => state.otherMutation },
      createNote: { useMutation: () => state.otherMutation },
    },
    settings: {
      getPreferences: { useQuery: () => ({ data: state.preferences }) },
    },
    recording: { signalStart: { useMutation: () => state.otherMutation } },
    widget: { closeNotesWindow: { useMutation: () => state.otherMutation } },
  },
}));
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => vi.fn() }));
vi.mock("react-i18next", () => {
  const value = { t: (key: string) => key, i18n: { language: "en" } };
  return { useTranslation: () => value };
});
vi.mock("@/renderer/main/pages/notes/components/note-editor", () => ({
  NoteEditor: () => null,
}));
vi.mock("@/renderer/main/pages/notes/components/note", () => ({
  default: (props: {
    noteTitle: string;
    onTitleChange: (title: string) => void;
    onEmojiChange: (icon: string | null) => void;
    children: ReactNode;
  }) =>
    createElement(
      "div",
      null,
      createElement("input", {
        value: props.noteTitle,
        onChange: (event: React.ChangeEvent<HTMLInputElement>) =>
          props.onTitleChange(event.target.value),
      }),
      createElement(
        "button",
        { onClick: () => props.onEmojiChange("📝") },
        "Change icon",
      ),
      props.children,
    ),
}));
let bodyListeners: Set<(change: NoteBodyChange) => void>;
let saves: Array<{
  resolve: (saved: typeof state.note) => void;
  reject: (error: Error) => void;
}>;
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  bodyListeners = new Set();
  saves = [];
  state.titleMutation.mutateAsync.mockImplementation(
    () => new Promise((resolve, reject) => saves.push({ resolve, reject })),
  );
  state.note = {
    ...state.note,
    id: "nt_abcdefghijklmnopqrstuvwx",
    title: "Meeting",
    icon: null,
    remoteVersion: 1,
  };
  state.utils.notes.getNoteById.fetch.mockImplementation(
    async () => state.note,
  );
  window.electronAPI = {
    on: vi.fn(),
    off: vi.fn(),
    notes: {
      onBodyChange: (callback: (change: NoteBodyChange) => void) => {
        bodyListeners.add(callback);
        return () => bodyListeners.delete(callback);
      },
    },
  } as unknown as typeof window.electronAPI;
});
afterEach(async () => {
  await act(async () => {
    cleanup();
    for (const noteId of [
      "nt_abcdefghijklmnopqrstuvwx",
      "nt_bcdefghijklmnopqrstuvwxy",
    ]) {
      bodyListeners.forEach((listener) => listener({ noteId, deleted: true }));
    }
    saves.forEach(({ resolve }) => resolve(state.note));
  });
  vi.useRealTimers();
});

it.each(["main", "widget"])(
  "autosaves 250 ms after the latest title edit in %s",
  async (surface) => {
    const view = render(
      surface === "main"
        ? createElement(NotePage, { noteId: state.note.id })
        : createElement(NotesWindowPanel, { initialNoteId: state.note.id }),
    );
    await act(async () => {});
    fireEvent.change(view.getByRole("textbox"), {
      target: { value: "First edit" },
    });
    act(() => vi.advanceTimersByTime(249));
    expect(state.titleMutation.mutateAsync).not.toHaveBeenCalled();
    fireEvent.change(view.getByRole("textbox"), {
      target: { value: "Unsaved title" },
    });
    act(() => vi.advanceTimersByTime(249));
    expect(state.titleMutation.mutateAsync).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(state.titleMutation.mutateAsync).toHaveBeenCalledExactlyOnceWith({
      id: state.note.id,
      title: "Unsaved title",
      expectedRemoteVersion: 1,
      originalTitle: "Meeting",
    });
    await act(async () =>
      saves[0].resolve({ ...state.note, title: "Unsaved title" }),
    );
    view.unmount();
    act(() => vi.runAllTimers());
    expect(state.titleMutation.mutateAsync).toHaveBeenCalledOnce();
    expect(bodyListeners.size).toBe(0);
  },
);

it.each(["main", "widget"])(
  "serializes title saves and advances the next draft's base in %s",
  async (surface) => {
    const view = render(
      surface === "main"
        ? createElement(NotePage, { noteId: state.note.id })
        : createElement(NotesWindowPanel, { initialNoteId: state.note.id }),
    );
    await act(async () => {});
    fireEvent.change(view.getByRole("textbox"), { target: { value: "B" } });
    act(() => vi.advanceTimersByTime(250));
    expect(state.titleMutation.mutateAsync).toHaveBeenCalledOnce();
    fireEvent.change(view.getByRole("textbox"), { target: { value: "C" } });
    act(() => vi.advanceTimersByTime(250));
    expect(state.titleMutation.mutateAsync).toHaveBeenCalledOnce();

    const [input] = state.titleMutation.mutateAsync.mock.calls[0];
    expect(input).toMatchObject({
      originalTitle: "Meeting",
      expectedRemoteVersion: 1,
    });
    // The first save may have reconciled a remote change while C was queued.
    const saved = { ...state.note, title: "B", remoteVersion: 2 };
    await act(async () => saves[0].resolve(saved));
    act(() => vi.advanceTimersByTime(250));
    expect(state.titleMutation.mutateAsync).toHaveBeenCalledTimes(2);
    expect(state.titleMutation.mutateAsync.mock.calls[1][0]).toMatchObject({
      title: "C",
      originalTitle: "B",
      expectedRemoteVersion: 2,
    });
    fireEvent.change(view.getByRole("textbox"), { target: { value: "D" } });
    act(() => vi.advanceTimersByTime(250));
    expect(state.titleMutation.mutateAsync).toHaveBeenCalledTimes(2);
    await act(async () => saves[1].reject(new Error("save failed")));
    act(() => vi.advanceTimersByTime(250));
    expect(state.titleMutation.mutateAsync.mock.calls[2][0]).toMatchObject({
      title: "D",
      originalTitle: "B",
      expectedRemoteVersion: 2,
    });
  },
);

it("restores the latest remote title when a local rename is reverted", () => {
  const originalTitle = state.note.title;
  const view = render(createElement(NotePage, { noteId: state.note.id }));
  fireEvent.change(view.getByRole("textbox"), {
    target: { value: "Unsaved rename" },
  });
  state.note = { ...state.note, title: "Remote title", remoteVersion: 2 };
  view.rerender(createElement(NotePage, { noteId: state.note.id }));
  fireEvent.change(view.getByRole("textbox"), {
    target: { value: originalTitle },
  });

  act(() => vi.advanceTimersByTime(250));

  expect(view.getByRole("textbox")).toHaveProperty("value", "Remote title");
  expect(state.titleMutation.mutateAsync).not.toHaveBeenCalled();
});

it("saves a pending title immediately when navigating away", async () => {
  const view = render(createElement(NotePage, { noteId: state.note.id }));
  fireEvent.change(view.getByRole("textbox"), {
    target: { value: "Before navigation" },
  });
  view.unmount();
  expect(state.titleMutation.mutateAsync).toHaveBeenCalledOnce();
  await act(async () =>
    saves[0].resolve({ ...state.note, title: "Before navigation" }),
  );
  expect(bodyListeners.size).toBe(0);
  act(() => vi.runAllTimers());
  expect(state.titleMutation.mutateAsync).toHaveBeenCalledOnce();
});

it("finishes the old note's queued title when switching notes during a save", async () => {
  const oldId = state.note.id;
  const view = render(createElement(NotePage, { noteId: oldId }));
  fireEvent.change(view.getByRole("textbox"), { target: { value: "B" } });
  act(() => vi.advanceTimersByTime(250));
  fireEvent.change(view.getByRole("textbox"), { target: { value: "C" } });
  state.note = {
    ...state.note,
    id: "nt_bcdefghijklmnopqrstuvwxy",
    title: "Other",
  };
  view.rerender(createElement(NotePage, { noteId: state.note.id }));
  expect(view.getByRole("textbox")).toHaveProperty("value", "Other");
  await act(async () =>
    saves[0].resolve({
      ...state.note,
      id: oldId,
      title: "B",
      remoteVersion: 2,
    }),
  );
  expect(state.titleMutation.mutateAsync.mock.calls[1][0]).toMatchObject({
    id: oldId,
    title: "C",
    originalTitle: "B",
    expectedRemoteVersion: 2,
  });
  await act(async () =>
    saves[1].resolve({
      ...state.note,
      id: oldId,
      title: "C",
      remoteVersion: 3,
    }),
  );
  expect(state.titleMutation.mutateAsync).toHaveBeenCalledTimes(2);
  expect(bodyListeners.size).toBe(1);
  expect(view.getByRole("textbox")).toHaveProperty("value", "Other");
});

it("does not retry an older failed title after revisiting and saving the note", async () => {
  const first = render(createElement(NotePage, { noteId: state.note.id }));
  fireEvent.change(first.getByRole("textbox"), { target: { value: "B" } });
  first.unmount();
  await act(async () => saves[0].reject(new Error("save failed")));

  const revisited = render(createElement(NotePage, { noteId: state.note.id }));
  expect(revisited.getByRole("textbox")).toHaveProperty("value", "B");
  fireEvent.change(revisited.getByRole("textbox"), { target: { value: "C" } });
  act(() => vi.advanceTimersByTime(250));
  await act(async () => saves[1].resolve({ ...state.note, title: "C" }));
  revisited.unmount();
  act(() => vi.runAllTimers());
  expect(state.titleMutation.mutateAsync).toHaveBeenCalledTimes(2);
  expect(bodyListeners.size).toBe(0);
});

it.each(["main", "widget"])(
  "finishes an in-flight title and the latest draft on unmount in %s",
  async (surface) => {
    const view = render(
      surface === "main"
        ? createElement(NotePage, { noteId: state.note.id })
        : createElement(NotesWindowPanel, { initialNoteId: state.note.id }),
    );
    await act(async () => {});
    fireEvent.change(view.getByRole("textbox"), { target: { value: "B" } });
    act(() => vi.advanceTimersByTime(250));
    fireEvent.change(view.getByRole("textbox"), { target: { value: "C" } });
    view.unmount();
    expect(state.titleMutation.mutateAsync).toHaveBeenCalledOnce();
    await act(async () =>
      saves[0].resolve({ ...state.note, title: "B", remoteVersion: 2 }),
    );
    expect(state.titleMutation.mutateAsync.mock.calls[1][0]).toMatchObject({
      title: "C",
      originalTitle: "B",
      expectedRemoteVersion: 2,
    });
    await act(async () =>
      saves[1].resolve({ ...state.note, title: "C", remoteVersion: 3 }),
    );
    act(() => vi.runAllTimers());
    expect(state.titleMutation.mutateAsync).toHaveBeenCalledTimes(2);
    expect(bodyListeners.size).toBe(0);
  },
);

it.each(["main", "widget"])(
  "retains failed title drafts until their note is deleted in %s",
  async (surface) => {
    const view = render(
      surface === "main"
        ? createElement(NotePage, { noteId: state.note.id })
        : createElement(NotesWindowPanel, { initialNoteId: state.note.id }),
    );
    await act(async () => {});
    fireEvent.change(view.getByRole("textbox"), { target: { value: "Draft" } });
    act(() => vi.advanceTimersByTime(250));
    await act(async () => saves[0].reject(new Error("save failed")));
    expect(view.getByRole("textbox")).toHaveProperty("value", "Draft");
    fireEvent.change(view.getByRole("textbox"), {
      target: { value: "Unsaved" },
    });
    act(() =>
      bodyListeners.forEach((listener) =>
        listener({ noteId: "nt_bcdefghijklmnopqrstuvwxy", deleted: true }),
      ),
    );
    act(() => vi.advanceTimersByTime(250));
    expect(state.titleMutation.mutateAsync.mock.calls[1][0]).toMatchObject({
      title: "Unsaved",
    });
    fireEvent.change(view.getByRole("textbox"), {
      target: { value: "Deleted draft" },
    });
    act(() =>
      bodyListeners.forEach((listener) =>
        listener({ noteId: state.note.id, deleted: true }),
      ),
    );
    await act(async () =>
      saves[1].resolve({ ...state.note, title: "Unsaved" }),
    );
    act(() => vi.runAllTimers());
    expect(state.titleMutation.mutateAsync).toHaveBeenCalledTimes(2);
    view.unmount();
    expect(bodyListeners.size).toBe(0);
  },
);

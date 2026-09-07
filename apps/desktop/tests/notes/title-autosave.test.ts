// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import NotePage from "@/renderer/main/pages/notes/components/note-wrapper";
import { NotesWindowPanel } from "@/renderer/notes-widget/components/NotesWindowPanel";

const state = vi.hoisted(() => ({
  note: {
    id: "nt_abcdefghijklmnopqrstuvwx",
    title: "Meeting",
    icon: null as string | null,
    remoteVersion: 1,
    updatedAt: new Date(1000),
  },
  titleMutation: { mutate: vi.fn(), isPending: false },
  titleOptions: {} as { onSuccess?: (saved: unknown, input: unknown) => void },
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
      updateNoteTitle: {
        useMutation: (options: typeof state.titleOptions = {}) => {
          state.titleOptions = options;
          return state.titleMutation;
        },
      },
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
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  state.note = {
    ...state.note,
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
  } as unknown as typeof window.electronAPI;
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

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
    act(() => vi.advanceTimersByTime(500));
    expect(state.titleMutation.mutate).toHaveBeenCalledOnce();
    fireEvent.change(view.getByRole("textbox"), { target: { value: "C" } });
    act(() => vi.advanceTimersByTime(500));
    expect(state.titleMutation.mutate).toHaveBeenCalledOnce();

    const [input, callbacks] = state.titleMutation.mutate.mock.calls[0];
    expect(input).toMatchObject({
      originalTitle: "Meeting",
      expectedRemoteVersion: 1,
    });
    // The first save may have reconciled a remote change while C was queued.
    const saved = { ...state.note, title: "B", remoteVersion: 2 };
    act(() =>
      (surface === "main" ? state.titleOptions : callbacks).onSuccess(
        saved,
        input,
      ),
    );
    act(() => vi.advanceTimersByTime(500));
    expect(state.titleMutation.mutate).toHaveBeenCalledTimes(2);
    expect(state.titleMutation.mutate.mock.calls[1][0]).toMatchObject({
      title: "C",
      originalTitle: "B",
      expectedRemoteVersion: 2,
    });
    fireEvent.change(view.getByRole("textbox"), { target: { value: "D" } });
    act(() => vi.advanceTimersByTime(500));
    expect(state.titleMutation.mutate).toHaveBeenCalledTimes(2);
    const [failedInput, failedCallbacks] =
      state.titleMutation.mutate.mock.calls[1];
    act(() =>
      (surface === "main" ? state.titleOptions : failedCallbacks).onError(
        new Error("save failed"),
        failedInput,
      ),
    );
    act(() => vi.advanceTimersByTime(500));
    expect(state.titleMutation.mutate.mock.calls[2][0]).toMatchObject({
      title: "D",
      originalTitle: "B",
      expectedRemoteVersion: 2,
    });
  },
);

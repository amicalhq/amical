// @vitest-environment jsdom

// The editor composes the existing one-chord recorder into a binding list.

import React, { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ShortcutBindingsEditor } from "../../src/renderer/main/pages/settings/shortcuts";
import type {
  ShortcutBindings,
  ShortcutType,
} from "../../src/utils/shortcut-validation";

const mocks = vi.hoisted(() => ({
  setRecordingState: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        "settings.shortcuts.input.pressKeys": "Press keys...",
        "settings.shortcuts.input.unassigned": "Not assigned",
        "settings.shortcuts.input.edit": "Edit shortcut",
        "settings.shortcuts.input.clear": "Clear shortcut",
        "settings.shortcuts.input.cancel": "Cancel editing",
        "settings.shortcuts.input.add": "Add shortcut",
      })[key] ?? key,
  }),
}));

vi.mock("@/trpc/react", () => ({
  api: {
    settings: {
      setShortcutRecordingState: {
        useMutation: () => ({ mutate: mocks.setRecordingState }),
      },
      activeKeysUpdates: {
        useSubscription: () => undefined,
      },
    },
  },
}));

function Harness({
  type,
  initialBindings,
  onChange,
}: {
  type: ShortcutType;
  initialBindings: ShortcutBindings;
  onChange?: (bindings: ShortcutBindings) => void;
}) {
  const [bindings, setBindings] = useState(initialBindings);
  const [recordingBinding, setRecordingBinding] = useState<{
    type: ShortcutType;
    index: number;
  } | null>(null);

  return React.createElement(ShortcutBindingsEditor, {
    type,
    bindings,
    recordingBinding,
    onRecordingBindingChange: setRecordingBinding,
    onChange: (nextBindings) => {
      setBindings(nextBindings);
      onChange?.(nextBindings);
    },
  });
}

describe("ShortcutBindingsEditor", () => {
  it("starts a new recorder after the existing bindings", () => {
    render(
      React.createElement(Harness, {
        type: "pushToTalk",
        initialBindings: [[55, 59], [63]],
      }),
    );

    expect(
      screen.getAllByRole("button", { name: "Edit shortcut" }),
    ).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Add shortcut" }));

    expect(screen.getByText("Press keys...")).toBeTruthy();
    expect(mocks.setRecordingState).toHaveBeenCalledWith(true);
  });

  it("removes one optional binding without changing its siblings", () => {
    const onChange = vi.fn();
    render(
      React.createElement(Harness, {
        type: "newNote",
        initialBindings: [
          [55, 59, 45],
          [55, 59, 46],
        ],
        onChange,
      }),
    );

    fireEvent.click(
      screen.getAllByRole("button", { name: "Edit shortcut" })[0],
    );
    fireEvent.click(screen.getByRole("button", { name: "Clear shortcut" }));

    expect(onChange).toHaveBeenCalledWith([[55, 59, 46]]);
  });

  it("does not allow removal of the final PTT binding", () => {
    render(
      React.createElement(Harness, {
        type: "pushToTalk",
        initialBindings: [[63]],
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Edit shortcut" }));

    expect(screen.queryByRole("button", { name: "Clear shortcut" })).toBeNull();
  });

  it("does not render an empty entry beside an assigned binding", () => {
    render(
      React.createElement(Harness, {
        type: "newNote",
        initialBindings: [[55, 59, 45], []],
      }),
    );

    expect(
      screen.getAllByRole("button", { name: "Edit shortcut" }),
    ).toHaveLength(1);
    expect(screen.queryByText("Not assigned")).toBeNull();
  });

  it("shows one inferred unassigned state when no binding is assigned", () => {
    render(
      React.createElement(Harness, {
        type: "newNote",
        initialBindings: [[], []],
      }),
    );

    expect(screen.getAllByText("Not assigned")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Edit shortcut" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Add shortcut" })).toBeNull();
  });
});

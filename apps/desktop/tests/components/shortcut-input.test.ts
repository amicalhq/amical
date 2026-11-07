// @vitest-environment jsdom

import React, { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ShortcutInput } from "../../src/components/shortcut-input";

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
  initialValue,
  onChange,
  allowUnassign,
}: {
  initialValue: number[];
  onChange: (value: number[]) => void;
  allowUnassign?: boolean;
}) {
  const [value, setValue] = useState(initialValue);
  const [isRecording, setIsRecording] = useState(false);

  return React.createElement(ShortcutInput, {
    value,
    onChange: (nextValue) => {
      setValue(nextValue);
      onChange(nextValue);
    },
    isRecordingShortcut: isRecording,
    onRecordingShortcutChange: setIsRecording,
    allowUnassign: allowUnassign ?? true,
  });
}

describe("ShortcutInput", () => {
  it("shows clearing only while an assigned shortcut is being edited", () => {
    render(
      React.createElement(Harness, {
        initialValue: [55, 59, 9],
        onChange: vi.fn(),
      }),
    );

    expect(screen.getByRole("button", { name: "Edit shortcut" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Clear shortcut" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Edit shortcut" }));

    expect(screen.getByText("Press keys...")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Cancel editing" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Clear shortcut" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Edit shortcut" })).toBeNull();
  });

  it("clears the shortcut and leaves recording mode", () => {
    const onChange = vi.fn();
    render(
      React.createElement(Harness, {
        initialValue: [55, 59, 9],
        onChange,
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Edit shortcut" }));
    fireEvent.click(screen.getByRole("button", { name: "Clear shortcut" }));

    expect(onChange).toHaveBeenCalledOnce();
    expect(onChange).toHaveBeenCalledWith([]);
    expect(screen.getByText("Not assigned")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Edit shortcut" })).toBeTruthy();
    expect(mocks.setRecordingState).toHaveBeenNthCalledWith(1, true);
    expect(mocks.setRecordingState).toHaveBeenNthCalledWith(2, false);
  });

  it("cancels editing without changing the shortcut", () => {
    const onChange = vi.fn();
    render(
      React.createElement(Harness, {
        initialValue: [55, 59, 9],
        onChange,
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Edit shortcut" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel editing" }));

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Edit shortcut" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Clear shortcut" })).toBeNull();
  });

  it("does not offer clearing when the shortcut is already unassigned", () => {
    render(
      React.createElement(Harness, {
        initialValue: [],
        onChange: vi.fn(),
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Edit shortcut" }));

    expect(screen.getByText("Press keys...")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Clear shortcut" })).toBeNull();
  });

  it("can keep unassignment out of flows that require a shortcut", () => {
    render(
      React.createElement(Harness, {
        initialValue: [63],
        onChange: vi.fn(),
        allowUnassign: false,
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Edit shortcut" }));

    expect(screen.getByText("Press keys...")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Clear shortcut" })).toBeNull();
  });
});

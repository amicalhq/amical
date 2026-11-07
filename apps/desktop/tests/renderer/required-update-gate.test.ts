// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  access: {
    requirement: { required: true, evaluatedVersion: "1.0.0" },
    recordingActive: false,
  } as unknown,
  updateState: "not-available",
  check: vi.fn(),
  install: vi.fn(),
  download: vi.fn(),
  downloadFailed: false,
  downloadPending: false,
  quit: vi.fn(),
}));
vi.mock("@/hooks/useUpdateRequirement", () => ({
  useUpdateRequirement: () => mocks.access,
}));
vi.mock("@/hooks/useUpdateState", () => ({
  useUpdateState: () => mocks.updateState,
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/trpc/react", () => ({
  api: {
    updater: {
      checkForUpdates: { useMutation: () => ({ mutate: mocks.check }) },
      quitAndInstall: { useMutation: () => ({ mutate: mocks.install }) },
      openDownloadPage: {
        useMutation: () => ({
          mutate: mocks.download,
          isError: mocks.downloadFailed,
          isPending: mocks.downloadPending,
        }),
      },
      quit: { useMutation: () => ({ mutate: mocks.quit }) },
    },
  },
}));

import { RequiredUpdateGate } from "../../src/components/required-update-gate";
const gate = () =>
  React.createElement(RequiredUpdateGate, {
    children: React.createElement("button", null, "Normal action"),
  });

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  mocks.access = {
    requirement: { required: true, evaluatedVersion: "1.0.0" },
    recordingActive: false,
  };
  mocks.updateState = "not-available";
  mocks.downloadFailed = false;
  mocks.downloadPending = false;
});

describe("required update screen", () => {
  it("blocks normal content and cannot be dismissed with Escape", () => {
    render(gate());
    expect(screen.queryByText("Normal action")).toBeNull();
    expect(screen.getByText("updater.requiredUpdate")).toBeTruthy();
    expect(screen.getByText("updater.appBlocked")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe("");
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "updater.updateNow" }),
    );
    expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(screen.getByRole("dialog")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "updater.updateNow" }));
    expect(mocks.check).toHaveBeenCalledWith({ userInitiated: true });
    expect(screen.getAllByRole("button")).toHaveLength(3);
    fireEvent.click(screen.getByRole("button", { name: "updater.quit" }));
    expect(mocks.quit).toHaveBeenCalledOnce();
    fireEvent.click(
      screen.getByRole("button", { name: "updater.manualDownload" }),
    );
    expect(mocks.download).toHaveBeenCalledOnce();
  });

  it("shows progress in the button, announces it, and supports retry and restart", () => {
    mocks.updateState = "available";
    const view = render(gate());
    const downloading = screen.getByRole("button", {
      name: "updater.downloading",
    });
    expect((downloading as HTMLButtonElement).disabled).toBe(true);
    expect(downloading.getAttribute("aria-busy")).toBe("true");
    expect(screen.getByRole("status").textContent).toBe("updater.downloading");
    expect(document.activeElement).toBe(screen.getByRole("dialog"));
    fireEvent.click(downloading);
    expect(mocks.check).not.toHaveBeenCalled();
    expect(screen.getAllByRole("button")).toHaveLength(3);

    mocks.updateState = "checking";
    view.rerender(gate());
    expect(
      (
        screen.getByRole("button", {
          name: "updater.checking",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(screen.getByRole("status").textContent).toBe("updater.checking");

    mocks.updateState = "error";
    view.rerender(gate());
    expect(screen.getByRole("alert").textContent).toBe(
      "updater.requiredUpdateFailed",
    );
    fireEvent.click(screen.getByRole("button", { name: "updater.tryAgain" }));
    expect(mocks.check).toHaveBeenCalledOnce();

    mocks.updateState = "downloaded";
    view.rerender(gate());
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "updater.restartAndUpdate" }),
    );
    expect(mocks.install).toHaveBeenCalledOnce();
    expect(screen.getByRole("status").textContent).toBe(
      "updater.restartAndUpdate",
    );
    expect(screen.getAllByRole("button")).toHaveLength(3);
  });

  it("keeps browser-launch errors separate through automatic update and manual retry", () => {
    mocks.downloadFailed = true;
    const view = render(gate());
    expect(screen.getByRole("alert").textContent).toBe(
      "updater.manualDownloadFailed",
    );
    expect(screen.queryByText("updater.requiredUpdateFailed")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "updater.updateNow" }));
    expect(mocks.check).toHaveBeenCalledOnce();

    mocks.updateState = "available";
    view.rerender(gate());
    expect(
      screen.getByRole("button", { name: "updater.downloading" }),
    ).toBeTruthy();
    mocks.updateState = "downloaded";
    view.rerender(gate());
    fireEvent.click(
      screen.getByRole("button", { name: "updater.restartAndUpdate" }),
    );
    expect(mocks.install).toHaveBeenCalledOnce();
    expect(screen.queryByText("updater.requiredUpdateFailed")).toBeNull();

    fireEvent.click(
      screen.getByRole("button", { name: "updater.manualDownload" }),
    );
    expect(mocks.download).toHaveBeenCalledOnce();
    // A retried React Query mutation transitions from error to pending.
    mocks.downloadFailed = false;
    mocks.downloadPending = true;
    view.rerender(gate());
    expect(screen.queryByRole("alert")).toBeNull();
    expect(
      (
        screen.getByRole("button", {
          name: "updater.manualDownload",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    mocks.downloadPending = false;
    view.rerender(gate());
    expect(screen.queryByRole("alert")).toBeNull();
    expect(
      screen.getByRole("button", { name: "updater.restartAndUpdate" }),
    ).toBeTruthy();
  });

  it("does not put a modal over an active recording and unlocks on a fresh policy", () => {
    mocks.access = {
      requirement: { required: true, evaluatedVersion: "1.0.0" },
      recordingActive: true,
    };
    const view = render(gate());
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByText("updater.finishingRecording")).toBeTruthy();
    mocks.access = { requirement: null, recordingActive: false };
    view.rerender(gate());
    expect(screen.getByRole("button", { name: "Normal action" })).toBeTruthy();
  });

  it("keeps existing content mounted but inaccessible when a block arrives", () => {
    mocks.access = { requirement: null, recordingActive: false };
    const view = render(gate());
    const button = screen.getByRole("button", { name: "Normal action" });
    mocks.access = {
      requirement: { required: true, evaluatedVersion: "1.0.0" },
      recordingActive: false,
    };
    view.rerender(gate());
    expect(screen.queryByRole("button", { name: "Normal action" })).toBeNull();
    expect(screen.getByText("Normal action")).toBe(button);
    expect(button.parentElement?.hasAttribute("inert")).toBe(true);
    mocks.access = { requirement: null, recordingActive: false };
    view.rerender(gate());
    expect(screen.getByRole("button", { name: "Normal action" })).toBe(button);
  });

  it("waits for the initial policy before mounting normal content", () => {
    mocks.access = null;
    render(gate());
    expect(screen.queryByText("Normal action")).toBeNull();
  });
});

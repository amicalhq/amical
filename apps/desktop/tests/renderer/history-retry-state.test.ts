// @vitest-environment jsdom

import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Transcription } from "../../src/db/schema";
import { TooltipProvider } from "../../src/components/ui/tooltip";
import { HistoryTableCard } from "../../src/renderer/main/pages/settings/history";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);
vi.stubGlobal("PointerEvent", MouseEvent);

const transcription = {
  id: 42,
  text: "Test transcript",
  timestamp: new Date(),
  language: "en",
  detectedLanguage: "en",
  audioFile: "/tmp/recording.wav",
  confidence: null,
  duration: 1,
  speechModel: "whisper-tiny",
  formattingModel: null,
  meta: {},
  createdAt: new Date(),
  updatedAt: new Date(),
} satisfies Transcription;

function renderHistoryCard({
  retryDisabledByRecording = false,
  retryingId = null,
  item = transcription,
  onRetry,
}: {
  retryDisabledByRecording?: boolean;
  retryingId?: number | null;
  item?: Transcription;
  onRetry: (id: number) => void;
}) {
  return render(
    React.createElement(
      TooltipProvider,
      null,
      React.createElement(HistoryTableCard, {
        items: [item],
        onCopy: vi.fn(),
        onPlay: vi.fn(),
        onDownload: vi.fn(),
        onDelete: vi.fn(),
        onRetry,
        onReport: vi.fn(),
        isTelemetryEnabled: true,
        currentPlayingId: null,
        isPlaying: false,
        retryingId,
        retryDisabledByRecording,
      }),
    ),
  );
}

const showRowActions = () => fireEvent.pointerEnter(screen.getByRole("row"));

describe("HistoryTableCard retry state", () => {
  it("disables retry and explains why while recording is active", async () => {
    const onRetry = vi.fn();
    renderHistoryCard({ retryDisabledByRecording: true, onRetry });
    showRowActions();

    const retryButton = screen.getByRole("button", {
      name: "settings.history.actions.retry",
    }) as HTMLButtonElement;
    expect(retryButton.disabled).toBe(true);
    fireEvent.click(retryButton);
    expect(onRetry).not.toHaveBeenCalled();

    fireEvent.pointerMove(retryButton.parentElement!, {
      pointerType: "mouse",
    });
    const tooltips = await screen.findAllByText(
      "settings.history.actions.retryDisabledRecording",
    );
    expect(tooltips.some((tooltip) => document.body.contains(tooltip))).toBe(
      true,
    );
  });

  it("disables every row while another retry is active", async () => {
    const onRetry = vi.fn();
    const otherTranscription = { ...transcription, id: 43 };
    renderHistoryCard({
      item: otherTranscription,
      retryingId: transcription.id,
      onRetry,
    });
    showRowActions();

    const retryButton = screen.getByRole("button", {
      name: "settings.history.actions.retry",
    }) as HTMLButtonElement;
    expect(retryButton.disabled).toBe(true);
    fireEvent.click(retryButton);
    expect(onRetry).not.toHaveBeenCalled();

    fireEvent.pointerMove(retryButton.parentElement!, {
      pointerType: "mouse",
    });
    const tooltips = await screen.findAllByText(
      "settings.history.actions.retryDisabledInProgress",
    );
    expect(tooltips.some((tooltip) => document.body.contains(tooltip))).toBe(
      true,
    );
  });

  it("allows retry when recording is idle and no retry is active", () => {
    const onRetry = vi.fn();
    renderHistoryCard({ onRetry });
    showRowActions();

    const retryButton = screen.getByRole("button", {
      name: "settings.history.actions.retry",
    }) as HTMLButtonElement;
    expect(retryButton.disabled).toBe(false);

    fireEvent.click(retryButton);
    expect(onRetry).toHaveBeenCalledWith(transcription.id);
  });
});

// @vitest-environment jsdom

import React from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RemoteConfigSidebarSlot } from "../../src/renderer/main/components/remote-config-surfaces";
import { StarNudge } from "../../src/renderer/main/components/star-nudge";

const mocks = vi.hoisted(() => ({
  track: vi.fn(),
})) as unknown as {
  track: ReturnType<typeof vi.fn>;
  config: {
    version: number;
    surfaces: unknown[];
    flags: Record<string, boolean>;
  };
  auth: { isAuthenticated: boolean } | undefined;
  stats: { totalWords: number; totalTranscriptions: number };
  sidebarState: string;
};

vi.mock("@/trpc/react", () => ({
  api: {
    remoteConfig: { get: { useQuery: () => ({ data: mocks.config }) } },
    transcriptions: {
      getLifetimeStats: { useQuery: () => ({ data: mocks.stats }) },
    },
    telemetry: { trackEvent: { useMutation: () => ({ mutate: mocks.track }) } },
    auth: {
      getAuthStatus: { useQuery: () => ({ data: mocks.auth }) },
      openWebSession: { useMutation: () => ({ mutate: vi.fn() }) },
    },
  },
}));

vi.mock("@/components/ui/sidebar", () => ({
  useSidebar: () => ({ state: mocks.sidebarState }),
}));

vi.mock("@/renderer/main/hooks/use-document-visible", () => ({
  useDocumentVisible: () => true,
}));

vi.mock("@tanstack/react-router", () => ({ useNavigate: () => vi.fn() }));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    i18n: { language: "en" },
    t: (key: string, params?: { words?: string }) =>
      params?.words ? `${key}:${params.words}` : key,
  }),
}));

const TITLE = "settings.sidebar.starNudge.title:12,400";

const slot = () =>
  React.createElement(RemoteConfigSidebarSlot, {
    fallback: React.createElement(StarNudge),
  });
const renderSlot = () => render(slot());

const outcomes = () =>
  mocks.track.mock.calls.map(([input]) => input.payload.outcome);

describe("StarNudge", () => {
  const openExternal = vi.fn();

  beforeEach(() => {
    window.localStorage.clear();
    mocks.config = {
      version: 1,
      surfaces: [],
      flags: { "desktop-star-nudge": true },
    };
    mocks.auth = { isAuthenticated: false };
    mocks.stats = { totalWords: 12_400, totalTranscriptions: 50 };
    mocks.sidebarState = "expanded";
    mocks.track.mockClear();
    openExternal.mockClear();
    Object.assign(window, { electronAPI: { openExternal } });
  });

  afterEach(cleanup);

  it("asks from the 20th dictation", () => {
    mocks.stats.totalTranscriptions = 19;
    const { rerender } = renderSlot();
    expect(screen.queryByText(TITLE)).toBeNull();

    mocks.stats = { ...mocks.stats, totalTranscriptions: 20 };
    rerender(slot());

    expect(screen.getByText(TITLE)).toBeTruthy();
  });

  it("waits while a remote card holds the slot", () => {
    mocks.config.surfaces = [
      {
        id: "campaign",
        kind: "side_slot",
        content: { body: "Remote card" },
      },
    ];
    renderSlot();

    expect(screen.getByText("Remote card")).toBeTruthy();
    expect(screen.queryByText(TITLE)).toBeNull();
    expect(outcomes()).toEqual([]);
  });

  it("stays off until the user is known to be signed out", () => {
    mocks.auth = undefined;
    const { rerender } = renderSlot();
    expect(screen.queryByText(TITLE)).toBeNull();

    mocks.auth = { isAuthenticated: true };
    rerender(slot());
    expect(screen.queryByText(TITLE)).toBeNull();
    expect(outcomes()).toEqual([]);
  });

  it("stays off when the remote flag is false", () => {
    mocks.config.flags = { "desktop-star-nudge": false };
    renderSlot();

    expect(screen.queryByText(TITLE)).toBeNull();
  });

  it("reports shown once, when the sidebar first opens", () => {
    mocks.sidebarState = "collapsed";
    const { rerender } = renderSlot();
    expect(outcomes()).toEqual([]);

    for (const state of ["expanded", "collapsed", "expanded"]) {
      mocks.sidebarState = state;
      rerender(slot());
    }

    expect(outcomes()).toEqual(["shown"]);
  });

  it("opens the repo on a click and never asks again", () => {
    renderSlot();

    act(() => screen.getByText("settings.sidebar.starNudge.cta").click());

    expect(openExternal).toHaveBeenCalledWith(
      "https://github.com/amicalhq/amical",
    );
    expect(outcomes()).toEqual(["shown", "clicked"]);
    expect(screen.queryByText(TITLE)).toBeNull();

    cleanup();
    renderSlot();
    expect(screen.queryByText(TITLE)).toBeNull();
  });

  it("ends the ask on a dismiss without opening the repo", () => {
    renderSlot();

    act(() => screen.getByLabelText("Dismiss").click());

    expect(openExternal).not.toHaveBeenCalled();
    expect(outcomes()).toEqual(["shown", "dismissed"]);
    expect(screen.queryByText(TITLE)).toBeNull();
  });
});

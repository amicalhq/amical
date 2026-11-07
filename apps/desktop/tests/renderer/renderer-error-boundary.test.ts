// @vitest-environment jsdom

import React from "react";
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RendererErrorBoundary } from "../../src/renderer/lib/renderer-error-boundary";

const mocks = vi.hoisted(() => ({
  captureRendererException: vi.fn(),
}));

vi.mock("@/renderer/lib/posthog", () => ({
  captureRendererException: mocks.captureRendererException,
}));

vi.mock("@/renderer/widget/pass-through", () => ({
  setPassThroughReason: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const renderError = new Error("root failed");

function BrokenRoot(): React.ReactNode {
  throw renderError;
}

describe("RendererErrorBoundary", () => {
  const consoleError = vi
    .spyOn(console, "error")
    .mockImplementation(() => undefined);

  afterEach(() => {
    mocks.captureRendererException.mockReset();
    consoleError.mockClear();
  });

  it("reports a root render failure with its surface and component stack", () => {
    render(
      React.createElement(
        RendererErrorBoundary,
        { surface: "notes" },
        React.createElement(BrokenRoot),
      ),
    );

    expect(screen.getByText("errors.renderer.title")).toBeTruthy();
    expect(mocks.captureRendererException).toHaveBeenCalledOnce();
    expect(mocks.captureRendererException).toHaveBeenCalledWith(
      renderError,
      expect.objectContaining({
        error_context: "root_render_failed",
        surface: "notes",
        component_stack: expect.stringContaining("BrokenRoot"),
      }),
    );
  });
});

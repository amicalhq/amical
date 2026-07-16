// @vitest-environment jsdom

import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LanguageSettings } from "../../src/renderer/main/pages/settings/dictation/components/LanguageSettings";
import { ChangeModal } from "../../src/renderer/onboarding/components/shared/ChangeModal";

const mocks = vi.hoisted(() => ({
  settings: { autoDetectEnabled: false, languages: ["en"] },
  mutateAsync: vi.fn().mockResolvedValue(true),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@/trpc/react", () => ({
  api: {
    useUtils: () => ({
      settings: {
        getDictationSettings: { invalidate: vi.fn() },
      },
    }),
    settings: {
      getDictationSettings: {
        useQuery: () => ({
          data: mocks.settings,
          isLoading: false,
        }),
      },
      setDictationSettings: {
        useMutation: () => ({
          mutateAsync: mocks.mutateAsync,
          isPending: false,
        }),
      },
    },
  },
}));

/**
 * A popup portalled to document.body is dead inside a modal Radix dialog:
 * Radix locks the page with `pointer-events: none` on <body> and re-enables
 * pointer events only on the dialog content, and it dismisses the dialog on
 * pointerdown outside its own DOM tree. Both problems go away only if the
 * popup renders INSIDE the dialog content, so that is the invariant to
 * assert for any popup hosted in a modal.
 */
function expectPopupUsableUnderModal(popup: HTMLElement) {
  const dialog = screen.getByRole("dialog");
  // Sanity: the modal really is holding the body pointer-events lock —
  // otherwise this assertion would be testing nothing.
  expect(document.body.style.pointerEvents).toBe("none");
  expect(dialog.contains(popup)).toBe(true);
}

describe("LanguageSettings", () => {
  afterEach(() => {
    mocks.mutateAsync.mockClear();
  });

  it("allows replacing English after removing it", async () => {
    render(
      React.createElement(ChangeModal, {
        open: true,
        onOpenChange: vi.fn(),
        title: "Change languages",
        children: React.createElement(LanguageSettings, { inModal: true }),
      }),
    );

    const englishChip = screen.getByText("🇺🇸 English").parentElement;
    const removeButton = englishChip?.querySelector("button");
    expect(removeButton).not.toBeNull();

    fireEvent.click(removeButton!);
    fireEvent.mouseDown(screen.getByRole("combobox"));
    const germanOption = await screen.findByText("🇩🇪 German");

    expectPopupUsableUnderModal(germanOption);
    fireEvent.click(germanOption);

    await waitFor(() => {
      // Clearing the last chip persists the (valid) empty selection, then
      // picking German persists the replacement.
      expect(mocks.mutateAsync).toHaveBeenCalledTimes(2);
      expect(mocks.mutateAsync).toHaveBeenNthCalledWith(1, {
        autoDetectEnabled: false,
        languages: [],
      });
      expect(mocks.mutateAsync).toHaveBeenLastCalledWith({
        autoDetectEnabled: false,
        languages: ["de"],
      });
    });
  });
});

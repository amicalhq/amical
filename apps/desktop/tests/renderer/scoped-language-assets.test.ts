// @vitest-environment jsdom

import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import SnippetsSettingsPage from "../../src/renderer/main/pages/settings/snippets";
import VocabularySettingsPage from "../../src/renderer/main/pages/settings/vocabulary";

const mocks = vi.hoisted(() => ({
  vocabularyScope: "all",
  snippetScope: "all",
  organizationCanWrite: false,
  organizationVocabulary: {
    id: "11111111-1111-4111-8111-111111111111",
    scopeType: "org" as const,
    scopeId: "org-1",
    word: "Amical",
    replacementWord: null,
    dateAdded: new Date(0),
    usageCount: 0,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  },
  organizationSnippet: {
    id: "22222222-2222-4222-8222-222222222222",
    scopeType: "org" as const,
    scopeId: "org-1",
    trigger: "/support",
    content: "Organization support response",
    createdAt: new Date(0),
    updatedAt: new Date(0),
  },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        "settings.vocabulary.scope.label": "Vocabulary scope",
        "settings.vocabulary.scope.all": "All",
        "settings.vocabulary.scope.user": "Personal",
        "settings.vocabulary.scope.org": "Organisation",
        "settings.vocabulary.scope.organizationBadge": "Organisation",
        "settings.vocabulary.scope.addOrganization": "Add organisation word",
        "settings.vocabulary.scope.readOnly":
          "Organisation vocabulary is read-only for your current role.",
        "settings.snippets.scope.label": "Snippet scope",
        "settings.snippets.scope.all": "All",
        "settings.snippets.scope.user": "Personal",
        "settings.snippets.scope.org": "Organisation",
        "settings.snippets.scope.organizationBadge": "Organisation",
        "settings.snippets.scope.addOrganization": "Add organisation snippet",
        "settings.snippets.scope.readOnly":
          "Organisation snippets are read-only for your current role.",
      })[key] ?? key,
  }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/trpc/react", () => ({
  // These factories are local because vi.mock is hoisted above module scope.
  api: {
    useUtils: () => ({
      vocabulary: { getVocabulary: { invalidate: vi.fn() } },
      snippets: { getSnippets: { invalidate: vi.fn() } },
    }),
    vocabulary: {
      getVocabulary: {
        useQuery: (input: { scope: string }) => {
          mocks.vocabularyScope = input.scope;
          return { data: [mocks.organizationVocabulary], isLoading: false };
        },
      },
      getScopeAccess: {
        useQuery: () => ({
          data: {
            scopeId: "org-1",
            role: "member",
            canWrite: mocks.organizationCanWrite,
          },
        }),
      },
      createVocabularyWord: {
        useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
      },
      createOrganizationVocabularyWord: {
        useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
      },
      updateVocabulary: {
        useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
      },
      updateOrganizationVocabulary: {
        useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
      },
      deleteVocabulary: {
        useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
      },
      deleteOrganizationVocabulary: {
        useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
      },
    },
    snippets: {
      getSnippets: {
        useQuery: (input: { scope: string }) => {
          mocks.snippetScope = input.scope;
          return { data: [mocks.organizationSnippet], isLoading: false };
        },
      },
      getScopeAccess: {
        useQuery: () => ({
          data: {
            scopeId: "org-1",
            role: "member",
            canWrite: mocks.organizationCanWrite,
          },
        }),
      },
      createSnippet: {
        useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
      },
      createOrganizationSnippet: {
        useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
      },
      updateSnippet: {
        useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
      },
      updateOrganizationSnippet: {
        useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
      },
      deleteSnippet: {
        useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
      },
      deleteOrganizationSnippet: {
        useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
      },
    },
  },
}));

describe("organization-scoped language asset settings", () => {
  afterEach(() => {
    cleanup();
    mocks.organizationCanWrite = false;
  });

  it("filters vocabulary by All, Personal, and Organisation", () => {
    render(React.createElement(VocabularySettingsPage));

    expect(mocks.vocabularyScope).toBe("all");
    fireEvent.click(screen.getByRole("tab", { name: "Personal" }));
    expect(mocks.vocabularyScope).toBe("user");
    fireEvent.click(screen.getByRole("tab", { name: "Organisation" }));
    expect(mocks.vocabularyScope).toBe("org");
  });

  it("makes read-only organization vocabulary actions unavailable", () => {
    const { container } = render(React.createElement(VocabularySettingsPage));
    fireEvent.click(screen.getByRole("tab", { name: "Organisation" }));

    expect(
      screen.getByRole<HTMLButtonElement>("button", {
        name: "Add organisation word",
      }).disabled,
    ).toBe(true);
    expect(
      screen.getByText(
        "Organisation vocabulary is read-only for your current role.",
      ),
    ).not.toBeNull();
    expect(container.querySelector(".lucide-edit")).toBeNull();
    expect(container.querySelector(".lucide-trash-2")).toBeNull();
  });

  it("filters snippets and hides read-only organization row actions", () => {
    const { container } = render(React.createElement(SnippetsSettingsPage));

    expect(mocks.snippetScope).toBe("all");
    fireEvent.click(screen.getByRole("tab", { name: "Personal" }));
    expect(mocks.snippetScope).toBe("user");
    fireEvent.click(screen.getByRole("tab", { name: "Organisation" }));
    expect(mocks.snippetScope).toBe("org");
    expect(
      screen.getByRole<HTMLButtonElement>("button", {
        name: "Add organisation snippet",
      }).disabled,
    ).toBe(true);
    expect(
      screen.getByText(
        "Organisation snippets are read-only for your current role.",
      ),
    ).not.toBeNull();
    expect(container.querySelector(".lucide-edit")).toBeNull();
    expect(container.querySelector(".lucide-trash-2")).toBeNull();
  });
});

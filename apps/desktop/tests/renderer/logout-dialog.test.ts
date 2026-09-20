// @vitest-environment jsdom

import React from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthButton } from "../../src/components/auth-button";
import { SignInScreen } from "../../src/renderer/onboarding/components/screens/SignInScreen";

const mocks = vi.hoisted(() => ({
  authStatus: {
    isAuthenticated: true,
    userId: "user-1",
    userEmail: "user@example.com",
  },
  getLogoutStatus: vi.fn(),
  syncBeforeLogout: vi.fn(),
  logout: vi.fn(),
  login: vi.fn(),
  logoutPending: false,
  logoutCallbacks: {} as {
    onSuccess: () => void;
    onError: (error: Error) => void;
  },
  authCallbacks: {} as {
    onData: (data: {
      eventType: string;
      isAuthenticated: boolean;
      userEmail?: string;
    }) => void;
  },
  toastError: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: { error: mocks.toastError, success: vi.fn(), info: vi.fn() },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock(
  "../../src/renderer/onboarding/components/shared/useApplyOnboardingModel",
  () => ({ useApplyOnboardingModel: vi.fn() }),
);

vi.mock("@/components/ui/sidebar", () => ({
  SidebarMenuItem: ({ children }: React.PropsWithChildren) =>
    React.createElement("li", null, children),
  SidebarMenuButton: (props: React.ComponentProps<"button">) =>
    React.createElement("button", props),
}));

vi.mock("@/trpc/react", () => ({
  api: {
    useUtils: () => ({
      client: {
        auth: { getLogoutStatus: { query: mocks.getLogoutStatus } },
      },
    }),
    auth: {
      getAuthStatus: {
        useQuery: () => ({
          data: mocks.authStatus,
          isLoading: false,
          refetch: vi.fn(),
        }),
      },
      onAuthStateChange: {
        useSubscription: (
          _input: unknown,
          callbacks: typeof mocks.authCallbacks,
        ) => {
          mocks.authCallbacks = callbacks;
        },
      },
      login: { useMutation: () => ({ mutate: mocks.login }) },
      logout: {
        useMutation: (callbacks: typeof mocks.logoutCallbacks) => {
          mocks.logoutCallbacks = callbacks;
          return { mutate: mocks.logout, isPending: mocks.logoutPending };
        },
      },
      syncBeforeLogout: {
        useMutation: () => ({ mutateAsync: mocks.syncBeforeLogout }),
      },
    },
  },
}));

function deferredSync() {
  let resolve!: (result: { synced: boolean }) => void;
  const promise = new Promise<{ synced: boolean }>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function startLogout() {
  fireEvent.keyDown(screen.getByRole("button", { name: /user@example.com/ }), {
    key: "Enter",
  });
  fireEvent.click(screen.getByText("Sign Out"));
  await waitFor(() => expect(mocks.getLogoutStatus).toHaveBeenCalled());
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.authStatus.isAuthenticated = true;
  mocks.logoutPending = false;
  mocks.getLogoutStatus.mockResolvedValue({ hasPendingChanges: true });
  mocks.syncBeforeLogout.mockImplementation(() => new Promise(() => {}));
});

afterEach(cleanup);

describe("onboarding account switch", () => {
  function startAccountSwitch() {
    render(
      React.createElement(SignInScreen, { onNext: vi.fn(), onBack: vi.fn() }),
    );
    act(() =>
      mocks.authCallbacks.onData({
        eventType: "authenticated",
        isAuthenticated: true,
        userEmail: "user@example.com",
      }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "onboarding.signIn.switchAccount" }),
    );
  }

  it("syncs pending work before logging out to switch accounts", async () => {
    const sync = deferredSync();
    mocks.syncBeforeLogout.mockReturnValue(sync.promise);
    startAccountSwitch();

    expect(await screen.findByRole("alertdialog")).toBeTruthy();
    expect(mocks.getLogoutStatus).toHaveBeenCalledOnce();
    expect(mocks.logout).not.toHaveBeenCalled();

    await act(async () => sync.resolve({ synced: true }));

    expect(mocks.logout).toHaveBeenCalledOnce();
  });

  it("checks for pending work and logs out directly when none remains", async () => {
    mocks.getLogoutStatus.mockResolvedValue({ hasPendingChanges: false });
    startAccountSwitch();

    await waitFor(() => expect(mocks.logout).toHaveBeenCalledOnce());
    expect(mocks.getLogoutStatus).toHaveBeenCalledOnce();
    expect(mocks.syncBeforeLogout).not.toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("keeps the account when syncing is cancelled and restores focus", async () => {
    const sync = deferredSync();
    mocks.syncBeforeLogout.mockReturnValue(sync.promise);
    startAccountSwitch();
    await screen.findByRole("alertdialog");

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await act(async () => sync.resolve({ synced: true }));

    expect(mocks.logout).not.toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog")).toBeNull();
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: "onboarding.signIn.switchAccount" }),
      ),
    );
  });
});

describe("logout dialog", () => {
  it("shows syncing immediately, then automatically logs out on success", async () => {
    const sync = deferredSync();
    mocks.syncBeforeLogout.mockReturnValue(sync.promise);
    render(React.createElement(AuthButton));

    await startLogout();

    expect(screen.getByRole("alertdialog").textContent).toContain(
      "Syncing unsaved changes…",
    );
    expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();
    expect(mocks.syncBeforeLogout).toHaveBeenCalledOnce();
    expect(mocks.logout).not.toHaveBeenCalled();

    await act(async () => sync.resolve({ synced: true }));

    expect(mocks.logout).toHaveBeenCalledOnce();
  });

  it("logs out directly when there are no pending changes", async () => {
    mocks.getLogoutStatus.mockResolvedValue({ hasPendingChanges: false });
    render(React.createElement(AuthButton));

    await startLogout();

    expect(mocks.logout).toHaveBeenCalledOnce();
    expect(mocks.syncBeforeLogout).not.toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it.each(["unsynced", "error"])(
    "offers discard or cancel when syncing ends with %s",
    async (result) => {
      if (result === "error") {
        mocks.syncBeforeLogout.mockRejectedValue(new Error("Offline"));
      } else {
        mocks.syncBeforeLogout.mockResolvedValue({ synced: false });
      }
      render(React.createElement(AuthButton));

      await startLogout();

      expect(await screen.findByText("You have unsynced changes")).toBeTruthy();
      expect(
        screen.getByText(
          "Logging out without syncing will permanently discard these changes. They won’t be restored when you sign back in.",
        ),
      ).toBeTruthy();
      expect(mocks.logout).not.toHaveBeenCalled();

      fireEvent.click(
        screen.getByRole("button", { name: "Discard changes and log out" }),
      );

      expect(mocks.logout).toHaveBeenCalledOnce();
      expect(screen.getByRole("alertdialog")).toBeTruthy();
    },
  );

  it("does not log out if an earlier sync succeeds after cancellation", async () => {
    const first = deferredSync();
    const second = deferredSync();
    mocks.syncBeforeLogout
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    render(React.createElement(AuthButton));
    await startLogout();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();

    await startLogout();
    await act(async () => first.resolve({ synced: true }));

    expect(mocks.logout).not.toHaveBeenCalled();
    expect(screen.getByText("Syncing unsaved changes…")).toBeTruthy();

    await act(async () => second.resolve({ synced: true }));
    expect(mocks.logout).toHaveBeenCalledOnce();
  });

  it("ignores sync completion after the account control unmounts", async () => {
    const sync = deferredSync();
    mocks.syncBeforeLogout.mockReturnValue(sync.promise);
    const view = render(React.createElement(AuthButton));
    await startLogout();

    view.unmount();
    await act(async () => sync.resolve({ synced: true }));

    expect(mocks.logout).not.toHaveBeenCalled();
  });

  it("stays signed in when the discard warning is cancelled", async () => {
    mocks.syncBeforeLogout.mockResolvedValue({ synced: false });
    render(React.createElement(AuthButton));
    await startLogout();
    await screen.findByText("You have unsynced changes");

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(mocks.logout).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: /user@example.com/ }),
      ),
    );
  });

  it("reports logout failure and allows another attempt", async () => {
    mocks.syncBeforeLogout.mockResolvedValue({ synced: true });
    render(React.createElement(AuthButton));
    await startLogout();
    await waitFor(() => expect(mocks.logout).toHaveBeenCalledOnce());

    act(() => mocks.logoutCallbacks.onError(new Error("Could not clear data")));

    expect(mocks.toastError).toHaveBeenCalledWith("Failed to sign out", {
      description: "Could not clear data",
    });
    expect(screen.queryByRole("alertdialog")).toBeNull();
    await startLogout();
    await waitFor(() => expect(mocks.logout).toHaveBeenCalledTimes(2));
  });

  it("keeps logout busy across auth events while the restart is pending", async () => {
    mocks.syncBeforeLogout.mockResolvedValue({ synced: true });
    const view = render(React.createElement(AuthButton));
    await startLogout();
    await waitFor(() => expect(mocks.logout).toHaveBeenCalledOnce());
    mocks.logoutPending = true;
    view.rerender(React.createElement(AuthButton));

    act(() =>
      mocks.authCallbacks.onData({
        eventType: "logout",
        isAuthenticated: false,
      }),
    );

    expect(screen.getByText("Logging out…")).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "Cancel" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it("keeps sign-in-again available for an account with expired credentials", () => {
    mocks.authStatus.isAuthenticated = false;
    render(React.createElement(AuthButton));
    fireEvent.keyDown(
      screen.getByRole("button", { name: /user@example.com/ }),
      {
        key: "Enter",
      },
    );

    expect(screen.getByText("Sign in again")).toBeTruthy();
    expect(screen.getByText("Sign Out")).toBeTruthy();
  });
});

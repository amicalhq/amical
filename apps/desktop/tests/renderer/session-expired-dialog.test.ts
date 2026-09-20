// @vitest-environment jsdom

import React from "react";
import {
  act,
  cleanup,
  fireEvent,
  render as renderComponent,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SessionExpiredDialog } from "../../src/components/session-expired-dialog";
import { AuthButton } from "../../src/components/auth-button";
import { LogoutProvider } from "../../src/hooks/useLogout";

const mocks = vi.hoisted(() => ({
  authStatus: {
    isAuthenticated: false,
    userId: "user-1" as string | null,
    userEmail: "user@example.com",
  },
  refetch: vi.fn(),
  login: vi.fn(),
  loginPending: false,
  loginCallbacks: {} as {
    onMutate: () => void;
    onError: (error: Error) => void;
  },
  authCallbacks: {} as {
    onData: (event: { eventType: string; error?: string }) => void;
  },
  getLogoutStatus: vi.fn(),
  syncBeforeLogout: vi.fn(),
  logout: vi.fn(),
  logoutPending: false,
  logoutCallbacks: {} as {
    onSuccess: () => void;
    onError: (error: Error) => void;
  },
  toastError: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: { error: mocks.toastError, success: vi.fn(), info: vi.fn() },
}));

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
        useQuery: () => ({ data: mocks.authStatus, refetch: mocks.refetch }),
      },
      onAuthStateChange: {
        useSubscription: (
          _input: unknown,
          callbacks: typeof mocks.authCallbacks,
        ) => {
          mocks.authCallbacks = callbacks;
        },
      },
      login: {
        useMutation: (callbacks: typeof mocks.loginCallbacks) => {
          mocks.loginCallbacks = callbacks;
          return { mutate: mocks.login, isPending: mocks.loginPending };
        },
      },
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

function render(element: React.ReactElement) {
  return renderComponent(element, { wrapper: LogoutProvider });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.authStatus = {
    isAuthenticated: false,
    userId: "user-1",
    userEmail: "user@example.com",
  };
  mocks.loginPending = false;
  mocks.logoutPending = false;
  mocks.login.mockImplementation(() => mocks.loginCallbacks.onMutate());
  mocks.getLogoutStatus.mockResolvedValue({ hasPendingChanges: false });
  mocks.syncBeforeLogout.mockImplementation(() => new Promise(() => {}));
});

afterEach(cleanup);

describe("session expired dialog", () => {
  it.each([
    { isAuthenticated: true, userId: "user-1" },
    { isAuthenticated: false, userId: null },
  ])("does not show for a valid session or a guest (%j)", (status) => {
    Object.assign(mocks.authStatus, status);
    render(React.createElement(SessionExpiredDialog));

    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("shows the retained account and cannot be dismissed with Escape or an outside click", () => {
    render(React.createElement(SessionExpiredDialog));

    expect(screen.getByRole("alertdialog").textContent).toContain(
      "Sign in again with user@example.com to continue.",
    );
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Sign in again" }),
    );

    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    fireEvent.pointerDown(document.body);
    fireEvent.click(document.body);

    expect(screen.getByRole("alertdialog")).toBeTruthy();
    expect(mocks.logout).not.toHaveBeenCalled();
  });

  it("checks persisted account state on an expiry event and shows the dialog", () => {
    mocks.authStatus.isAuthenticated = true;
    const view = render(React.createElement(SessionExpiredDialog));

    act(() => mocks.authCallbacks.onData({ eventType: "signed-out" }));

    expect(mocks.refetch).toHaveBeenCalledOnce();
    mocks.authStatus.isAuthenticated = false;
    view.rerender(React.createElement(SessionExpiredDialog));
    expect(screen.getByText("Your session expired")).toBeTruthy();
  });

  it("stays open during the browser handoff and allows another attempt once the browser opens", () => {
    const view = render(React.createElement(SessionExpiredDialog));
    fireEvent.click(screen.getByRole("button", { name: "Sign in again" }));
    expect(mocks.login).toHaveBeenCalledOnce();

    mocks.loginPending = true;
    view.rerender(React.createElement(SessionExpiredDialog));
    expect(screen.getByRole("alertdialog")).toBeTruthy();
    expect(
      (
        screen.getByRole("button", {
          name: "Opening browser…",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);

    mocks.loginPending = false;
    view.rerender(React.createElement(SessionExpiredDialog));
    fireEvent.click(screen.getByRole("button", { name: "Sign in again" }));

    expect(mocks.login).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("alertdialog")).toBeTruthy();
  });

  it("shows a rejected account's error inside the dialog and clears it on retry", () => {
    render(React.createElement(SessionExpiredDialog));
    const message =
      "Please sign in with user@example.com, or log out first to switch accounts.";

    act(() =>
      mocks.authCallbacks.onData({ eventType: "auth-error", error: message }),
    );

    expect(screen.getByRole("alert").textContent).toBe(message);
    expect(screen.getAllByRole("alertdialog")).toHaveLength(1);
    expect(mocks.logout).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Sign in again" }));

    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("alertdialog")).toBeTruthy();
  });

  it("shows browser launch errors inline and leaves sign-in available", () => {
    render(React.createElement(SessionExpiredDialog));
    fireEvent.click(screen.getByRole("button", { name: "Sign in again" }));

    act(() =>
      mocks.loginCallbacks.onError(new Error("Could not open browser")),
    );

    expect(screen.getByRole("alert").textContent).toBe(
      "Could not open browser",
    );
    expect(screen.getByRole("button", { name: "Sign in again" })).toBeTruthy();
  });

  it("closes when the same account has successfully signed in", () => {
    const view = render(React.createElement(SessionExpiredDialog));
    act(() => mocks.authCallbacks.onData({ eventType: "authenticated" }));
    expect(mocks.refetch).toHaveBeenCalledOnce();

    mocks.authStatus.isAuthenticated = true;
    view.rerender(React.createElement(SessionExpiredDialog));

    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("logs out directly when nothing is pending and stays open while logout runs", async () => {
    const view = render(React.createElement(SessionExpiredDialog));
    fireEvent.click(screen.getByRole("button", { name: "Log out" }));

    await waitFor(() => expect(mocks.logout).toHaveBeenCalledOnce());
    expect(mocks.syncBeforeLogout).not.toHaveBeenCalled();
    mocks.logoutPending = true;
    view.rerender(React.createElement(SessionExpiredDialog));
    expect(screen.getByRole("alertdialog")).toBeTruthy();
    expect(
      (
        screen.getByRole("button", {
          name: "Logging out…",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });

  it("uses the existing unsynced-changes warning before discarding data", async () => {
    mocks.getLogoutStatus.mockResolvedValue({ hasPendingChanges: true });
    mocks.syncBeforeLogout.mockResolvedValue({ synced: false });
    render(React.createElement(SessionExpiredDialog));
    fireEvent.click(screen.getByRole("button", { name: "Log out" }));

    await screen.findByText("You have unsynced changes");
    expect(screen.getAllByRole("alertdialog")).toHaveLength(1);
    expect(mocks.logout).not.toHaveBeenCalled();

    fireEvent.click(
      screen.getByRole("button", { name: "Discard changes and log out" }),
    );

    expect(mocks.logout).toHaveBeenCalledOnce();
  });

  it("returns to sign-in when logout is cancelled and ignores later sync completion", async () => {
    const sync = Promise.withResolvers<{ synced: boolean }>();
    mocks.getLogoutStatus.mockResolvedValue({ hasPendingChanges: true });
    mocks.syncBeforeLogout.mockReturnValue(sync.promise);
    render(React.createElement(SessionExpiredDialog));
    fireEvent.click(screen.getByRole("button", { name: "Log out" }));
    await screen.findByText("Syncing unsaved changes…");

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await act(async () => sync.resolve({ synced: true }));

    expect(screen.getByText("Your session expired")).toBeTruthy();
    expect(screen.getAllByRole("alertdialog")).toHaveLength(1);
    expect(mocks.logout).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Sign in again" }));
    expect(mocks.login).toHaveBeenCalledOnce();
  });

  it("keeps sign-in available if logout fails", async () => {
    render(React.createElement(SessionExpiredDialog));
    fireEvent.click(screen.getByRole("button", { name: "Log out" }));
    await waitFor(() => expect(mocks.logout).toHaveBeenCalledOnce());

    act(() => mocks.logoutCallbacks.onError(new Error("Could not clear data")));

    expect(mocks.toastError).toHaveBeenCalledWith("Failed to sign out", {
      description: "Could not clear data",
    });
    expect(screen.getByRole("button", { name: "Sign in again" })).toBeTruthy();
  });

  it("keeps one logout dialog when its sync attempt discovers expired credentials", async () => {
    mocks.authStatus.isAuthenticated = true;
    mocks.getLogoutStatus.mockResolvedValue({ hasPendingChanges: true });
    const sync = Promise.withResolvers<{ synced: boolean }>();
    mocks.syncBeforeLogout.mockReturnValue(sync.promise);
    const content = () =>
      React.createElement(
        React.Fragment,
        null,
        React.createElement(AuthButton),
        React.createElement(SessionExpiredDialog),
      );
    const view = render(content());
    fireEvent.keyDown(
      screen.getByRole("button", { name: /user@example.com/ }),
      {
        key: "Enter",
      },
    );
    fireEvent.click(screen.getByText("Sign Out"));
    await screen.findByText("Syncing unsaved changes…");

    mocks.authStatus.isAuthenticated = false;
    view.rerender(content());
    await act(async () => sync.resolve({ synced: false }));

    expect(screen.getAllByRole("alertdialog")).toHaveLength(1);
    expect(screen.getByText("You have unsynced changes")).toBeTruthy();
    expect(screen.queryByText("Your session expired")).toBeNull();
    expect(mocks.syncBeforeLogout).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.getByText("Your session expired")).toBeTruthy();
    expect(screen.getAllByRole("alertdialog")).toHaveLength(1);
    expect(mocks.logout).not.toHaveBeenCalled();
  });
});

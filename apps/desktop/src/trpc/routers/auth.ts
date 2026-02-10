import { observable } from "@trpc/server/observable";
import { createRouter, procedure } from "../trpc";
import { logger } from "../../main/logger";
import { AuthState } from "../../services/auth-service";

export const authRouter = createRouter({
  // Get current auth status
  getAuthStatus: procedure.query(async ({ ctx }) => {
    const authService = ctx.serviceManager.getService("authService");

    const authState = await authService.getAuthState();
    const isAuthenticated = await authService.isAuthenticated();

    return {
      isAuthenticated,
      userEmail: authState?.userInfo?.email || null,
      userName: authState?.userInfo?.name || null,
    };
  }),

  // Initiate login flow
  login: procedure.mutation(async ({ ctx }) => {
    const authService = ctx.serviceManager.getService("authService");

    await authService.login();

    // The actual authentication will complete via the deep link callback
    return {
      success: true,
      message: "Login initiated - please complete in your browser",
    };
  }),

  // Logout
  logout: procedure.mutation(async ({ ctx }) => {
    const authService = ctx.serviceManager.getService("authService");

    await authService.logout();

    return {
      success: true,
      message: "Logged out successfully",
    };
  }),

  // Subscribe to auth state changes
  // Using Observable instead of async generator due to Symbol.asyncDispose conflict
  // eslint-disable-next-line deprecation/deprecation
  onAuthStateChange: procedure.subscription(({ ctx }) => {
    return observable<{
      eventType: "initial" | "authenticated" | "signed-out" | "auth-error";
      isAuthenticated: boolean;
      userEmail: string | null;
      userName: string | null;
      error?: string;
    }>((emit) => {
      const authService = ctx.serviceManager.getService("authService");

      // Define handlers once (not in a loop)
      const handleAuthenticated = async (authState: AuthState) => {
        logger.main.info("Auth state changed - authenticated");
        emit.next({
          eventType: "authenticated",
          isAuthenticated: true,
          userEmail: authState.userInfo?.email || null,
          userName: authState.userInfo?.name || null,
        });
      };

      const handleLoggedOut = () => {
        logger.main.info("Auth state changed - logged out");
        emit.next({
          eventType: "signed-out",
          isAuthenticated: false,
          userEmail: null,
          userName: null,
        });
      };

      const handleAuthError = (error: Error) => {
        logger.main.error("Auth error:", error);
        emit.next({
          eventType: "auth-error",
          isAuthenticated: false,
          userEmail: null,
          userName: null,
          error: error.message,
        });
      };

      // Attach listeners once
      authService.on("authenticated", handleAuthenticated);
      authService.on("logged-out", handleLoggedOut);
      authService.on("auth-error", handleAuthError);

      // Send initial state
      authService.getAuthState().then((state) => {
        emit.next({
          eventType: "initial",
          isAuthenticated: state?.isAuthenticated || false,
          userEmail: state?.userInfo?.email || null,
          userName: state?.userInfo?.name || null,
        });
      });

      // Cleanup function - removes listeners when subscription ends
      return () => {
        authService.off("authenticated", handleAuthenticated);
        authService.off("logged-out", handleLoggedOut);
        authService.off("auth-error", handleAuthError);
      };
    });
  }),
});

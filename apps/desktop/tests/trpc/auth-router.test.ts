import { Effect } from "effect";
import { shell } from "electron";
import { describe, expect, it } from "vitest";
import { authRouter } from "../../src/trpc/routers/auth";
import { AuthServiceFailure } from "../../src/services/auth-service";

const callerWith = (openWebSession: () => Effect.Effect<void, unknown>) =>
  authRouter.createCaller({
    services: { authService: { openWebSession } },
  } as never);

describe("authRouter.openWebSession", () => {
  it("opens the page directly when the handoff fails", async () => {
    const caller = callerWith(() =>
      Effect.fail(new AuthServiceFailure({ message: "Not signed in" })),
    );

    await caller.openWebSession({
      returnPath: "/organization/billing?from=quota",
    });

    expect(shell.openExternal).toHaveBeenCalledExactlyOnceWith(
      "https://app.amical.ai/organization/billing?from=quota",
    );
  });

  it("does not open the page again when the handoff succeeds", async () => {
    const caller = callerWith(() => Effect.void);

    await caller.openWebSession({ returnPath: "/organization/members" });

    expect(shell.openExternal).not.toHaveBeenCalled();
  });
});

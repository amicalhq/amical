import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";

import { retryOnceAfterAuthenticationRequired } from "../../src/services/auth-retry";
import { AuthenticationRequired } from "../../src/types/errors/cloud-request";

describe("retryOnceAfterAuthenticationRequired", () => {
  it("does not refresh a successful operation", async () => {
    const operation = vi.fn(() => Effect.succeed("done"));
    const refresh = vi.fn(() => Effect.void);

    await expect(
      Effect.runPromise(
        retryOnceAfterAuthenticationRequired(operation, refresh),
      ),
    ).resolves.toBe("done");
    expect(operation).toHaveBeenCalledOnce();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("refreshes and retries once after AuthenticationRequired", async () => {
    const operation = vi
      .fn()
      .mockReturnValueOnce(
        Effect.fail(new AuthenticationRequired({ message: "expired" })),
      )
      .mockReturnValueOnce(Effect.succeed("done"));
    const refresh = vi.fn(() => Effect.void);

    await expect(
      Effect.runPromise(
        retryOnceAfterAuthenticationRequired(operation, refresh),
      ),
    ).resolves.toBe("done");
    expect(operation).toHaveBeenCalledTimes(2);
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("does not retry again after a second AuthenticationRequired", async () => {
    const error = new AuthenticationRequired({ message: "expired" });
    const operation = vi.fn(() => Effect.fail(error));
    const refresh = vi.fn(() => Effect.void);

    const exit = await Effect.runPromiseExit(
      retryOnceAfterAuthenticationRequired(operation, refresh),
    );

    expect(exit._tag).toBe("Failure");
    expect(operation).toHaveBeenCalledTimes(2);
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("does not refresh other failures", async () => {
    const error = new Error("forbidden");
    const operation = vi.fn(() => Effect.fail(error));
    const refresh = vi.fn(() => Effect.void);

    const exit = await Effect.runPromiseExit(
      retryOnceAfterAuthenticationRequired(operation, refresh),
    );

    expect(exit._tag).toBe("Failure");
    expect(operation).toHaveBeenCalledOnce();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("does not retry when refresh fails", async () => {
    const operation = vi.fn(() =>
      Effect.fail(new AuthenticationRequired({ message: "expired" })),
    );
    const refresh = vi.fn(() => Effect.fail(new Error("refresh failed")));

    const exit = await Effect.runPromiseExit(
      retryOnceAfterAuthenticationRequired(operation, refresh),
    );

    expect(exit._tag).toBe("Failure");
    expect(operation).toHaveBeenCalledOnce();
    expect(refresh).toHaveBeenCalledOnce();
  });
});

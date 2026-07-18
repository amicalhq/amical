import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Context, Effect, Exit, Layer, Scope } from "effect";
import {
  TelemetryServiceTag,
  FeatureFlagServiceTag,
  PostHogClientTag,
  SettingsServiceTag,
  EarlyRefsTag,
  AuthServiceTag,
  AppScopeTag,
} from "../../src/main/runtime/tags";
import { TelemetryService } from "../../src/services/telemetry-service";
import { FeatureFlagService } from "../../src/services/feature-flag-service";
import type { AuthService } from "../../src/services/auth-service";
import type { PostHogClient } from "../../src/services/posthog-client";
import type { SettingsService } from "../../src/services/settings-service";

/**
 * The identity inversion (knot 2): auth no longer calls telemetry / feature
 * flags / remote config after sign-in and logout — the consumers subscribe
 * in their Live layers. These tests pin the subscription wiring; the remote
 * config side lives in remote-config-service.test.ts.
 */
describe("identity subscriptions", () => {
  let closeScope: (() => Promise<void>) | null = null;

  afterEach(async () => {
    if (closeScope) {
      await closeScope();
      closeScope = null;
    }
  });

  describe("TelemetryService.Live auth subscription", () => {
    const build = async () => {
      // posthog: null keeps initialize() an early-return no-op; the
      // observable surface is the identified-user calls on the client.
      const clientState = { isIdentified: false };
      const client = {
        posthog: null,
        machineId: "machine-1",
        systemInfo: null,
        identifiedUser: null,
        get isIdentified() {
          return clientState.isIdentified;
        },
        setIdentifiedUser: vi.fn(() => {
          clientState.isIdentified = true;
        }),
        clearIdentifiedUser: vi.fn(() => {
          clientState.isIdentified = false;
        }),
      } as unknown as PostHogClient;
      const settingsService = {} as unknown as SettingsService;
      const authService = new EventEmitter() as unknown as AuthService;

      const scope = Effect.runSync(Scope.make());
      const ctx = await Effect.runPromise(
        Layer.build(
          TelemetryService.Live.pipe(
            Layer.provide(Layer.succeed(PostHogClientTag, client)),
            Layer.provide(Layer.succeed(SettingsServiceTag, settingsService)),
            Layer.provide(Layer.succeed(EarlyRefsTag, {})),
            Layer.provide(Layer.succeed(AuthServiceTag, authService)),
            Layer.provide(Layer.succeed(AppScopeTag, scope)),
          ),
        ).pipe(Scope.extend(scope)),
      );
      closeScope = () => Effect.runPromise(Scope.close(scope, Exit.void));

      return {
        service: Context.get(ctx, TelemetryServiceTag),
        client,
        authEmitter: authService as unknown as EventEmitter,
      };
    };

    it("identifies on authenticated when the token carried a subject", async () => {
      const { client, authEmitter } = await build();

      authEmitter.emit("authenticated", {
        isAuthenticated: true,
        userInfo: { sub: "user-1", email: "u@example.com", name: "U" },
      });

      expect(client.setIdentifiedUser).toHaveBeenCalledWith(
        "user-1",
        "u@example.com",
        "U",
      );
    });

    it("ignores authenticated without a subject", async () => {
      const { client, authEmitter } = await build();

      authEmitter.emit("authenticated", { isAuthenticated: true });

      expect(client.setIdentifiedUser).not.toHaveBeenCalled();
    });

    it("resets on logged-out only when identified", async () => {
      const { client, authEmitter } = await build();

      authEmitter.emit("logged-out");
      expect(client.clearIdentifiedUser).not.toHaveBeenCalled();

      authEmitter.emit("authenticated", {
        isAuthenticated: true,
        userInfo: { sub: "user-1" },
      });
      authEmitter.emit("logged-out");
      expect(client.clearIdentifiedUser).toHaveBeenCalledOnce();
    });

    it("emits identity-changed only after the identity change is applied", async () => {
      const { service, client, authEmitter } = await build();
      // Listeners (feature flags) read client.distinctId synchronously inside
      // the emit — capture what they'd see. Emitting before the client update
      // would refresh flags for the stale identity.
      const identityAtEvent: boolean[] = [];
      service.on("identity-changed", () => {
        identityAtEvent.push(client.isIdentified);
      });

      authEmitter.emit("logged-out"); // not identified: no change
      expect(identityAtEvent).toEqual([]);

      authEmitter.emit("authenticated", {
        isAuthenticated: true,
        userInfo: { sub: "user-1" },
      });
      expect(identityAtEvent).toEqual([true]);

      authEmitter.emit("logged-out");
      expect(identityAtEvent).toEqual([true, false]);
    });

    it("drops the auth subscriptions when the scope closes", async () => {
      const { client, authEmitter } = await build();

      await closeScope!();
      closeScope = null;

      authEmitter.emit("authenticated", {
        isAuthenticated: true,
        userInfo: { sub: "user-1" },
      });
      expect(client.setIdentifiedUser).not.toHaveBeenCalled();
      expect(authEmitter.listenerCount("authenticated")).toBe(0);
      expect(authEmitter.listenerCount("logged-out")).toBe(0);
    });
  });

  describe("FeatureFlagService.Live identity subscription", () => {
    const build = async () => {
      const posthog = {
        getAllFlagsAndPayloads: vi.fn().mockResolvedValue({
          featureFlags: { "some-flag": true },
          featureFlagPayloads: {},
        }),
      };
      const client = {
        posthog,
        distinctId: "machine-1",
        personProperties: undefined,
      } as unknown as PostHogClient;
      // Fresh persisted flags, so initialize() triggers no startup refresh —
      // every getAllFlagsAndPayloads call is attributable to the event.
      const settingsService = {
        getFeatureFlags: vi.fn(async () => ({
          flags: {},
          payloads: {},
          lastFetchedAt: new Date().toISOString(),
        })),
        setFeatureFlags: vi.fn(async () => undefined),
      } as unknown as SettingsService;
      const telemetryService =
        new EventEmitter() as unknown as TelemetryService;

      const scope = Effect.runSync(Scope.make());
      await Effect.runPromise(
        Layer.build(
          FeatureFlagService.Live.pipe(
            Layer.provide(Layer.succeed(PostHogClientTag, client)),
            Layer.provide(Layer.succeed(SettingsServiceTag, settingsService)),
            Layer.provide(Layer.succeed(TelemetryServiceTag, telemetryService)),
            Layer.provide(Layer.succeed(AppScopeTag, scope)),
          ),
        ).pipe(Scope.extend(scope)),
      );
      closeScope = () => Effect.runPromise(Scope.close(scope, Exit.void));

      return {
        posthog,
        telemetryEmitter: telemetryService as unknown as EventEmitter,
      };
    };

    it("refreshes flags on every identity-changed", async () => {
      const { posthog, telemetryEmitter } = await build();

      telemetryEmitter.emit("identity-changed");
      await vi.waitFor(() =>
        expect(posthog.getAllFlagsAndPayloads).toHaveBeenCalledOnce(),
      );

      // Let the first refresh chain settle past its dedupe latch, then EVERY,
      // not just the first — a once()-style subscription must fail here.
      await new Promise((resolve) => setTimeout(resolve, 0));
      telemetryEmitter.emit("identity-changed");
      await vi.waitFor(() =>
        expect(posthog.getAllFlagsAndPayloads).toHaveBeenCalledTimes(2),
      );
    });

    it("drops the subscription when the scope closes", async () => {
      const { posthog, telemetryEmitter } = await build();

      await closeScope!();
      closeScope = null;

      telemetryEmitter.emit("identity-changed");
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(posthog.getAllFlagsAndPayloads).not.toHaveBeenCalled();
      expect(telemetryEmitter.listenerCount("identity-changed")).toBe(0);
    });
  });
});

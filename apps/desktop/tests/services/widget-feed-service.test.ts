import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Effect } from "effect";
import type { AuthService } from "../../src/services/auth-service";
import type { RemoteConfigService } from "../../src/services/remote-config-service";
import { WidgetFeedService } from "../../src/services/widget-feed-service";
import { DESKTOP_WIDGET_FEED_FLAG } from "../../src/types/remote-config";

const MINT_URL = "https://core.test/apps/v1/me/sequenzy-identity-token";
const PLACEMENTS_URL = "https://api.sequenzy.com/api/v1/in-app/feed/placements";
const EVENTS_URL = "https://api.sequenzy.com/api/v1/in-app/feed/events";

const EXPIRES_AT = Date.now() + 86_400_000;

const identityToken = (email: string, n: number) => {
  const claims = { companyId: "c", email, expiresAt: EXPIRES_AT };
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `seq_wid_${payload}.sig${n}`;
};

const placement = (id: string) =>
  Response.json({
    placements: [
      {
        placement: "desktop_widget",
        message: { id, title: `Title ${id}`, body: "", buttons: [], data: {} },
      },
    ],
  });

const rejected = () =>
  Response.json(
    { success: false, code: "invalid_web_tracking_identity" },
    { status: 403 },
  );

describe("WidgetFeedService", () => {
  const fetchMock = vi.fn();
  let flagOn: boolean;
  let mints: number;
  let authService: AuthService;
  let remoteConfigService: RemoteConfigService;
  let placements: () => Response | Promise<Response>;
  let events: () => Response | Promise<Response>;

  const calls = (url: string) =>
    fetchMock.mock.calls.filter(([target]) => String(target) === url);

  beforeEach(() => {
    flagOn = true;
    mints = 0;
    placements = () => placement("item-a");
    events = () => Response.json({ success: true });
    authService = {
      getAuthState: () =>
        Effect.succeed({ isAuthenticated: true, userInfo: { sub: "acc" } }),
      getIdToken: () => Effect.succeed("id-token"),
      refreshTokenIfNeeded: () => Effect.void,
    } as unknown as AuthService;
    remoteConfigService = {
      getConfig: () => ({ flags: { [DESKTOP_WIDGET_FEED_FLAG]: flagOn } }),
    } as unknown as RemoteConfigService;
    fetchMock.mockReset();
    fetchMock.mockImplementation(async (target: URL | string) => {
      const url = String(target);
      if (url === MINT_URL) {
        mints += 1;
        return Response.json({
          identityToken: identityToken("user@example.com", mints),
        });
      }
      if (url === PLACEMENTS_URL) return placements();
      if (url === EVENTS_URL) return events();
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("CORE_API_URL", "https://core.test");
  });

  const services: WidgetFeedService[] = [];
  afterEach(() => {
    for (const service of services.splice(0)) service.clear();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  // Signing in fetches the slot at once.
  const start = async () => {
    const service = new WidgetFeedService(authService, remoteConfigService);
    services.push(service);
    service.activate("acc");
    await vi.waitFor(() => expect(service.get()).not.toBeNull());
    return service;
  };

  it("reads the slot as the signed-in contact, with one token for many reads", async () => {
    const service = await start();
    expect(service.get()?.id).toBe("item-a");

    const [, init] = calls(PLACEMENTS_URL)[0];
    expect(init.headers["x-sequenzy-app-id"]).toBe("ai.amical.desktop");
    expect(JSON.parse(init.body)).toMatchObject({
      email: "user@example.com",
      identityToken: identityToken("user@example.com", 1),
      placements: ["desktop_widget"],
    });
    expect(calls(MINT_URL)[0][1].method).toBe("POST");

    await service.refresh();
    expect(calls(PLACEMENTS_URL)).toHaveLength(2);
    expect(mints).toBe(1);
  });

  it("reads the slot again every 5 min", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    await start();
    expect(calls(PLACEMENTS_URL)).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(5 * 60_000);

    await vi.waitFor(() => expect(calls(PLACEMENTS_URL)).toHaveLength(2));
  });

  it("mints a new token once when Sequenzy rejects the stored one", async () => {
    const service = await start();
    placements = vi
      .fn()
      .mockImplementationOnce(rejected)
      .mockImplementation(() => placement("item-b"));

    await service.refresh();

    expect(service.get()?.id).toBe("item-b");
    expect(mints).toBe(2);
  });

  it("stops asking for an account that the token route refuses", async () => {
    fetchMock.mockImplementation(async () =>
      Response.json({ code: "FORBIDDEN" }, { status: 403 }),
    );
    const service = new WidgetFeedService(authService, remoteConfigService);
    services.push(service);
    service.activate("acc");
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    await service.refresh();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(service.get()).toBeNull();
  });

  it("closes a clicked card with a click, then a dismissal; the next fetch reads the next item", async () => {
    const service = await start();
    placements = () => placement("item-b");

    const closed = service.close("item-a", true);

    // The card goes away at once.
    expect(service.get()).toBeNull();
    await closed;
    const sent = calls(EVENTS_URL).map(([, init]) => JSON.parse(init.body));
    expect(sent.map((body) => [body.type, body.messageId])).toEqual([
      ["clicked", "item-a"],
      ["dismissed", "item-a"],
    ]);

    await service.refresh();
    expect(service.get()?.id).toBe("item-b");
  });

  it("reports `displayed` once per item", async () => {
    const service = await start();

    service.markDisplayed("item-a");
    service.markDisplayed("item-a");

    await vi.waitFor(() => expect(calls(EVENTS_URL)).toHaveLength(1));
    expect(JSON.parse(calls(EVENTS_URL)[0][1].body).type).toBe("displayed");
  });

  it("calls nothing in a build without the Sequenzy key", async () => {
    vi.stubEnv("SEQUENZY_PUBLIC_KEY", "");
    vi.stubGlobal("__BUNDLED_SEQUENZY_PUBLIC_KEY", "");
    const service = new WidgetFeedService(authService, remoteConfigService);
    services.push(service);
    service.activate("acc");
    await service.refresh();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reads nothing while the flag is off, reads when it turns on, and drops the card when it turns off", async () => {
    flagOn = false;
    const service = new WidgetFeedService(authService, remoteConfigService);
    services.push(service);
    service.activate("acc");
    await service.refresh();
    expect(fetchMock).not.toHaveBeenCalled();

    flagOn = true;
    service.onConfigChange();
    await vi.waitFor(() => expect(service.get()?.id).toBe("item-a"));

    flagOn = false;
    service.onConfigChange();
    expect(service.get()).toBeNull();
  });
});

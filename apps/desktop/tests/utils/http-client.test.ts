import { beforeEach, describe, expect, it } from "vitest";
import {
  getApplicationLocale,
  setApplicationLocale,
} from "../../src/i18n/application-locale";
import {
  getAmicalClientHeaders,
  getAmicalClientInfo,
} from "../../src/utils/http-client";

describe("Amical client locale", () => {
  beforeEach(() => {
    setApplicationLocale("en");
  });

  it("uses one application locale for HTTP and gRPC client metadata", () => {
    setApplicationLocale("ja");

    expect(getApplicationLocale()).toBe("ja");
    expect(getAmicalClientHeaders()).toMatchObject({
      "Accept-Language": "ja",
    });
    expect(getAmicalClientInfo()).toMatchObject({
      locale: "ja",
    });
  });

  it("normalizes supported regional locale values", () => {
    expect(setApplicationLocale("ja-JP")).toBe("ja");
    expect(getAmicalClientHeaders()).toMatchObject({
      "Accept-Language": "ja",
    });
  });

  it("falls back safely instead of forwarding an unsupported locale", () => {
    expect(setApplicationLocale("not-a-supported-locale")).toBe("en");
    expect(getAmicalClientInfo()).toMatchObject({ locale: "en" });
    expect(getAmicalClientHeaders()).toMatchObject({
      "Accept-Language": "en",
    });
  });
});

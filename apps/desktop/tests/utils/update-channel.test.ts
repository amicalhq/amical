import { describe, expect, it } from "vitest";
import { inferUpdateChannelFromVersion } from "../../src/utils/update-channel";

describe("inferUpdateChannelFromVersion", () => {
  it("returns stable for regular releases", () => {
    expect(inferUpdateChannelFromVersion("1.2.3")).toBe("stable");
  });

  it("returns beta for beta prerelease versions", () => {
    expect(inferUpdateChannelFromVersion("1.2.3-beta.4")).toBe("beta");
  });

  it("returns alpha for alpha prerelease versions", () => {
    expect(inferUpdateChannelFromVersion("1.2.3-alpha.9")).toBe("alpha");
  });

  it("handles uppercase prerelease labels", () => {
    expect(inferUpdateChannelFromVersion("1.2.3-BETA.1")).toBe("beta");
  });

  it("falls back to stable for unknown prerelease labels", () => {
    expect(inferUpdateChannelFromVersion("1.2.3-rc.1")).toBe("stable");
  });
});


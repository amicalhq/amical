import { describe, expect, it } from "vitest";

import { getPostHogSourceMapOptions } from "../../vite.posthog";

describe("PostHog source-map configuration", () => {
  it("does not configure uploads unless they are explicitly enabled", () => {
    expect(getPostHogSourceMapOptions({})).toBeUndefined();
    expect(
      getPostHogSourceMapOptions({ POSTHOG_SOURCE_MAP_UPLOAD: "false" }),
    ).toBeUndefined();
  });

  it("requires build-only credentials and a commit SHA for release uploads", () => {
    expect(() =>
      getPostHogSourceMapOptions({ POSTHOG_SOURCE_MAP_UPLOAD: "true" }),
    ).toThrow(
      "PostHog source-map upload requires POSTHOG_PERSONAL_API_KEY, POSTHOG_PROJECT_ID, and POSTHOG_RELEASE_SHA",
    );
  });

  it("uses a stable app release and deletes uploaded maps from the bundle", () => {
    expect(
      getPostHogSourceMapOptions({
        POSTHOG_SOURCE_MAP_UPLOAD: "true",
        POSTHOG_PERSONAL_API_KEY: "phx_personal",
        POSTHOG_PROJECT_ID: "12345",
        POSTHOG_HOST: "https://us.posthog.com",
        POSTHOG_RELEASE_SHA: "abcdef1234567890",
      }),
    ).toEqual({
      personalApiKey: "phx_personal",
      projectId: "12345",
      host: "https://us.posthog.com",
      sourcemaps: {
        releaseName: "amical-desktop",
        releaseVersion: "1.12.0-beta.3+abcdef1234567890",
        deleteAfterUpload: true,
      },
    });
  });
});

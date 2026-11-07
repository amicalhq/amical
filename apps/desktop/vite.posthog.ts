import posthogRollupPlugin, {
  type PostHogRollupPluginOptions,
} from "@posthog/rollup-plugin";
import type { PluginOption } from "vite";

import packageJson from "./package.json" with { type: "json" };

export function getPostHogSourceMapOptions(
  environment: NodeJS.ProcessEnv,
): PostHogRollupPluginOptions | undefined {
  if (environment.POSTHOG_SOURCE_MAP_UPLOAD !== "true") {
    return undefined;
  }

  const personalApiKey = environment.POSTHOG_PERSONAL_API_KEY?.trim();
  const projectId = environment.POSTHOG_PROJECT_ID?.trim();
  const commitSha = environment.POSTHOG_RELEASE_SHA?.trim();

  if (!personalApiKey || !projectId || !commitSha) {
    throw new Error(
      "PostHog source-map upload requires POSTHOG_PERSONAL_API_KEY, POSTHOG_PROJECT_ID, and POSTHOG_RELEASE_SHA",
    );
  }

  return {
    personalApiKey,
    projectId,
    host: environment.POSTHOG_HOST?.trim() || undefined,
    sourcemaps: {
      releaseName: "amical-desktop",
      releaseVersion: `${packageJson.version}+${commitSha}`,
      deleteAfterUpload: true,
    },
  };
}

export function posthogSourceMapPlugins(
  environment: NodeJS.ProcessEnv = process.env,
): PluginOption[] {
  const options = getPostHogSourceMapOptions(environment);
  return options ? [posthogRollupPlugin(options)] : [];
}

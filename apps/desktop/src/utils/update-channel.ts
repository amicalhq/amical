export type UpdateChannel = "stable" | "beta" | "alpha";

export function inferUpdateChannelFromVersion(version: string): UpdateChannel {
  const prereleaseMatch = version.match(/-([0-9A-Za-z-]+)/);
  const prereleaseLabel = prereleaseMatch?.[1]?.toLowerCase() ?? "";

  if (prereleaseLabel.startsWith("alpha")) {
    return "alpha";
  }
  if (prereleaseLabel.startsWith("beta")) {
    return "beta";
  }

  // Intentionally treat unknown prerelease labels (including rc/canary/etc.)
  // as stable so users only enter non-stable channels when explicitly selected.
  return "stable";
}

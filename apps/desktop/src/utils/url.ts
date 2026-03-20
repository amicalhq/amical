export function isInternalUrl(url: string): boolean {
  return url.startsWith("/") && !url.startsWith("//");
}

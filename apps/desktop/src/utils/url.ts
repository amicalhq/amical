export function isInternalUrl(url: string): boolean {
  return url.startsWith("/") && !url.startsWith("//");
}

const HOST_DELIMITER_PATTERN = /[/?#]/;
const SCHEME_PATTERN = /^[a-z][a-z\d+.-]*:/i;

function stripCredentials(authority: string): string {
  const atIndex = authority.lastIndexOf("@");
  return atIndex === -1 ? authority : authority.slice(atIndex + 1);
}

function stripPort(authority: string): string {
  if (!authority) {
    return authority;
  }

  if (authority.startsWith("[")) {
    const endBracketIndex = authority.indexOf("]");
    return endBracketIndex === -1
      ? authority
      : authority.slice(1, endBracketIndex);
  }

  const colonMatches = authority.match(/:/g);
  if (!colonMatches?.length) {
    return authority;
  }

  if (colonMatches.length === 1) {
    return authority.slice(0, authority.indexOf(":"));
  }

  // Unbracketed IPv6 literals are ambiguous with ports, so preserve them.
  return authority;
}

function looksLikeProtocolLessHost(authority: string): boolean {
  if (!authority || /\s/.test(authority)) {
    return false;
  }

  if (
    authority.includes(".") ||
    authority.startsWith("localhost") ||
    authority.startsWith("[")
  ) {
    return true;
  }

  return /^[^:\s]+:\d+$/.test(authority);
}

export function extractHostnameFromBrowserUrl(
  rawUrl: string | null | undefined,
): string | null {
  const value = rawUrl?.trim();
  if (!value) {
    return null;
  }

  let authority: string;
  const schemeSeparatorIndex = value.indexOf("://");
  const authorityCandidate = value.split(HOST_DELIMITER_PATTERN, 1)[0];

  if (schemeSeparatorIndex >= 0) {
    authority = value
      .slice(schemeSeparatorIndex + 3)
      .split(HOST_DELIMITER_PATTERN, 1)[0];
  } else if (value.startsWith("//")) {
    authority = value.slice(2).split(HOST_DELIMITER_PATTERN, 1)[0];
  } else if (looksLikeProtocolLessHost(authorityCandidate)) {
    authority = authorityCandidate;
  } else if (SCHEME_PATTERN.test(value)) {
    return null;
  } else {
    authority = authorityCandidate;
  }

  const hostname = stripPort(stripCredentials(authority).trim())
    .trim()
    .replace(/\.+$/, "")
    .toLowerCase();

  if (!hostname || /\s/.test(hostname)) {
    return null;
  }

  return hostname;
}

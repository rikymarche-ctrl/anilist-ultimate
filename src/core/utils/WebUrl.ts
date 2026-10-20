/** Web URL parsing shared by DOM URL bindings and CSS image values. */
export function parseWebUrl(value: unknown, base = 'https://anilist.co/'): URL | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value, base);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url : null;
  } catch { return null; }
}

/** Serialize an image URL as one CSS string, never as new declarations. */
export function cssImageUrl(value: unknown): string {
  const url = parseWebUrl(value);
  // URL.href percent-encodes control characters; JSON quoting escapes quotes/backslashes.
  return url ? `url(${JSON.stringify(url.href)})` : 'none';
}

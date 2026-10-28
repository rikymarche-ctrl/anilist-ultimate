/**
 * @file ExtensionPage.ts
 * @description Recognizes this extension's own pages across browsers.
 *
 * Chromium serves extension pages from chrome-extension://<extension id>/, while
 * Firefox uses moz-extension://<per-install UUID>/ whose host is NOT runtime.id.
 * The base URL is therefore read from runtime.getURL() instead of being rebuilt
 * from the extension ID.
 */

function extensionBase(): URL | null {
  const candidates = [chrome.runtime.getURL?.('/'), `chrome-extension://${chrome.runtime.id}/`];
  for (const candidate of candidates) {
    try {
      const url = new URL(candidate ?? '');
      if (url.host) return url;
    } catch {
      /* Try the next candidate. */
    }
  }
  return null;
}

/** True when `value` points at a page served by this extension (popup, settings, worker). */
export function isExtensionPageUrl(value: string | undefined): boolean {
  const base = extensionBase();
  if (!base || !value) return false;
  try {
    const url = new URL(value);
    return url.protocol === base.protocol && url.host === base.host;
  } catch {
    return false;
  }
}

/** True when the current script runs in one of this extension's own pages. */
export function isExtensionPageContext(): boolean {
  return typeof location !== 'undefined' && isExtensionPageUrl(location.href);
}

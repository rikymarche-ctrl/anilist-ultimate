/**
 * @file SpaNavigate.ts
 * @description In-app navigation for AniList's Vue router without a full page reload.
 *
 * AniList renders routes on popstate, so a path change is a pushState followed by a synthetic popstate.
 * Only same-origin, path-absolute targets are accepted; anything else must be left to the browser.
 */

const installedContainers = new WeakSet<HTMLElement>();

function isPathAbsolute(path: string): boolean {
  return path.startsWith('/') && !path.startsWith('//') && !path.startsWith('/\\');
}

/** Navigates to a same-origin path inside the current document. Throws for any other target. */
export function navigateInApp(path: string): void {
  if (typeof path !== 'string' || !isPathAbsolute(path)) {
    throw new Error(`Refusing non-internal navigation: ${String(path)}`);
  }
  const resolved = new URL(path, location.href);
  if (resolved.origin !== location.origin) {
    throw new Error(`Refusing cross-origin navigation: ${path}`);
  }
  history.pushState(null, '', path);
  window.dispatchEvent(new PopStateEvent('popstate', { state: null }));
}

function hasModifier(event: MouseEvent): boolean {
  return event.ctrlKey || event.metaKey || event.shiftKey || event.altKey;
}

function shouldLeaveToBrowser(anchor: HTMLAnchorElement): boolean {
  const target = anchor.getAttribute('target');
  return (!!target && target !== '_self') || anchor.hasAttribute('download');
}

/**
 * Routes same-origin link clicks inside the container through navigateInApp.
 * Modified clicks, other buttons, new-tab targets, downloads and foreign origins are left alone.
 * Returns a cleanup function; installing twice on one container is a no-op.
 */
export function interceptInternalLinks(container: HTMLElement): () => void {
  if (installedContainers.has(container)) return () => undefined;
  installedContainers.add(container);

  const onClick = (event: MouseEvent): void => {
    if (event.defaultPrevented || event.button !== 0 || hasModifier(event)) return;
    if (!(event.target instanceof Element)) return;
    const anchor = event.target.closest<HTMLAnchorElement>('a[href]');
    if (!anchor || !container.contains(anchor) || shouldLeaveToBrowser(anchor)) return;
    const href = anchor.getAttribute('href');
    if (href === null) return;
    let url: URL;
    try {
      url = new URL(href, location.href);
    } catch {
      return;
    }
    if (url.origin !== location.origin) return;
    try {
      navigateInApp(`${url.pathname}${url.search}${url.hash}`);
      event.preventDefault();
    } catch {
      // Not expressible as an in-app path (for example a protocol-relative pathname): let the browser handle it.
    }
  };

  container.addEventListener('click', onClick);
  return () => {
    container.removeEventListener('click', onClick);
    installedContainers.delete(container);
  };
}

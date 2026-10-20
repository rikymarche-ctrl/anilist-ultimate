/** Shared locator for the native Following column and its profile links; used by every Following enhancer. */

/** Finds the native Following section on the overview and social routes. */
export function findFollowingSection(): HTMLElement | null {
  const section = document.querySelector<HTMLElement>('.following');
  if (section && !/\/social\/?$/.test(location.pathname)) return section;
  const header = [...document.querySelectorAll('h2, h3, .section-header')].find(
    (node) => node.textContent?.trim().toLowerCase() === 'following'
  );
  if (!header) return section;
  const sectionByHeader = header.closest<HTMLElement>('.grid-section, section');
  if (sectionByHeader?.querySelector('a[href*="/user/"]')) return sectionByHeader;
  const next = header.nextElementSibling as HTMLElement | null;
  if (next?.querySelector('a[href*="/user/"]')) return next;
  return header.parentElement?.querySelector('a[href*="/user/"]') ? header.parentElement : null;
}

/** Username from a same-origin `/user/<name>` link, or null when the link is not a profile link. */
export function followingUsername(link: HTMLAnchorElement): string | null {
  try {
    const url = new URL(link.getAttribute('href') || '', location.origin);
    const match = /^\/user\/([^/]+)\/?$/.exec(url.pathname);
    const name = match ? decodeURIComponent(match[1]) : '';
    return url.origin === location.origin && name.trim() && name.length <= 100 ? name : null;
  } catch {
    return null;
  }
}

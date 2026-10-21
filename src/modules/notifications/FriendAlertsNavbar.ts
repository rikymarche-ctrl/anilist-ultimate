/** A separate unread counter beside the profile, leaving room for AniList's own counter. */
export class FriendAlertsNavbar {
  private host: HTMLElement | null = null;
  private badge: HTMLAnchorElement | null = null;
  private sizes: ResizeObserver | null = null;
  private nativeCounters: Element[] = [];
  private positioned = false;

  constructor(private readonly openInbox: (event: MouseEvent) => void) {}

  update(unread: number): void {
    const user = document.querySelector<HTMLElement>('.nav .user, #nav .user');
    // Never put a link inside the native profile link.
    const host = user?.tagName === 'A' ? user.parentElement : user;
    if (!unread || !host) {
      this.clear();
      return;
    }
    if (this.host !== host || !this.badge?.isConnected) {
      this.clear();
      this.host = host;
      const margin = Number.parseFloat(getComputedStyle(host).marginRight) || 0;
      host.style.setProperty('--au-friend-alerts-nav-margin', `${margin}px`);
      this.positioned = getComputedStyle(host).position === 'static';
      host.classList.add('au-friend-alerts-nav-host');
      if (this.positioned) host.classList.add('au-friend-alerts-nav-positioned');
      this.badge = document.createElement('a');
      this.badge.className = 'au-friend-alerts-nav-badge';
      this.badge.href = '/notifications/#friend-alerts';
      this.badge.setAttribute('aria-live', 'polite');
      this.badge.addEventListener('click', this.click);
      host.append(this.badge);
      if (typeof ResizeObserver !== 'undefined') {
        this.sizes = new ResizeObserver(this.layout);
        this.sizes.observe(host);
        this.sizes.observe(this.badge);
      }
      window.addEventListener('resize', this.layout);
    }
    const text = unread > 99 ? '99+' : String(unread);
    const label = `${unread} unread friend alert${unread === 1 ? '' : 's'}`;
    if (this.badge!.textContent !== text) this.badge!.textContent = text;
    if (this.badge!.getAttribute('aria-label') !== label) {
      this.badge!.setAttribute('aria-label', label);
      this.badge!.title = label;
    }
    const counters = [...host.querySelectorAll('.notification-dot, .notification-count, .notification-badge')];
    for (const previous of this.nativeCounters) if (!counters.includes(previous)) this.sizes?.unobserve(previous);
    for (const counter of counters) if (!this.nativeCounters.includes(counter)) this.sizes?.observe(counter);
    this.nativeCounters = counters;
    this.layout();
  }

  private readonly click = (event: MouseEvent): void => {
    event.stopPropagation();
    this.openInbox(event);
  };

  private readonly layout = (): void => {
    if (!this.host?.isConnected || !this.badge?.isConnected) return;
    const edge = this.host.getBoundingClientRect().right;
    const nativeEdge = Math.max(edge, ...this.nativeCounters.map(counter => counter.getBoundingClientRect().right));
    // AniList's dropdown arrow extends past the profile even without a red counter.
    const offset = Math.max(32, nativeEdge - edge + 8);
    const width = this.badge.getBoundingClientRect().width || 28;
    for (const [name, value] of [
      ['--au-friend-alerts-nav-offset', `${offset}px`],
      ['--au-friend-alerts-nav-reserve', `${offset + width}px`],
    ]) {
      if (this.host.style.getPropertyValue(name) !== value) this.host.style.setProperty(name, value);
    }
  };

  clear(): void {
    this.sizes?.disconnect();
    this.sizes = null;
    this.nativeCounters = [];
    window.removeEventListener('resize', this.layout);
    this.badge?.removeEventListener('click', this.click);
    this.badge?.remove();
    this.badge = null;
    this.host?.classList.remove('au-friend-alerts-nav-host');
    if (this.positioned) this.host?.classList.remove('au-friend-alerts-nav-positioned');
    for (const name of ['margin', 'offset', 'reserve']) this.host?.style.removeProperty(`--au-friend-alerts-nav-${name}`);
    this.host = null;
    this.positioned = false;
  }
}

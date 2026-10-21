import { afterEach, describe, expect, it, vi } from 'vitest';
import { FriendAlertsNavbar } from './FriendAlertsNavbar';

const nav = () => {
  document.body.innerHTML = '<nav class="nav"><div class="user" style="position: relative; margin-right: 15px">'
    + '<a class="avatar" href="/user/Me/">Me</a><a class="notification-dot" href="/notifications">2</a></div></nav>';
  return document.querySelector<HTMLElement>('.user')!;
};
const rect = (right: number, width = 20): DOMRect => ({ right, width } as DOMRect);
afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); });

describe('friend alerts navbar counter', () => {
  it('reserves room beyond the native red badge, including changes to its width', () => {
    const host = nav(); const native = host.querySelector<HTMLElement>('.notification-dot')!;
    const badge = new FriendAlertsNavbar(() => {});
    vi.spyOn(host, 'getBoundingClientRect').mockReturnValue(rect(100));
    const nativeRect = vi.spyOn(native, 'getBoundingClientRect').mockReturnValue(rect(130));
    badge.update(3);
    expect(host.style.getPropertyValue('--au-friend-alerts-nav-offset')).toBe('38px');
    const blue = host.querySelector<HTMLAnchorElement>('.au-friend-alerts-nav-badge')!;
    expect(blue.textContent).toBe('3');
    expect(blue.pathname + blue.hash).toBe('/notifications/#friend-alerts');
    expect(native.textContent).toBe('2');
    nativeRect.mockReturnValue(rect(160, 50));
    badge.update(3);
    expect(host.style.getPropertyValue('--au-friend-alerts-nav-offset')).toBe('68px');
    expect(host.querySelectorAll('.au-friend-alerts-nav-badge')).toHaveLength(1);
    // When the red counter disappears, the native profile arrow still needs its own space.
    native.remove();
    badge.update(3);
    expect(host.style.getPropertyValue('--au-friend-alerts-nav-offset')).toBe('32px');
    host.append(native);
    badge.clear();
    expect(host.className).toBe('user');
    expect(host.style.marginRight).toBe('15px');
    expect(host.querySelector('.notification-dot')).toBe(native);
  });
  it('caps the visible count while retaining the exact accessible label and removes itself at zero', () => {
    const host = nav(); const badge = new FriendAlertsNavbar(() => {});
    badge.update(123);
    expect(document.querySelector('.au-friend-alerts-nav-badge')?.textContent).toBe('99+');
    expect(document.querySelector('.au-friend-alerts-nav-badge')?.getAttribute('aria-label')).toBe('123 unread friend alerts');
    badge.update(0);
    expect(document.querySelector('.au-friend-alerts-nav-badge')).toBeNull();
    expect(host.style.getPropertyValue('--au-friend-alerts-nav-reserve')).toBe('');
  });
  it('reattaches to a replaced navbar and does not bubble clicks into the profile controls', () => {
    const original = nav(); const opened = vi.fn(); const profile = vi.fn();
    const badge = new FriendAlertsNavbar(event => { event.preventDefault(); opened(); });
    badge.update(1);
    const replacement = original.cloneNode(true) as HTMLElement;
    // Simulate Vue replacing the native subtree without keeping injected content.
    replacement.querySelector('.au-friend-alerts-nav-badge')?.remove();
    replacement.className = 'user';
    original.replaceWith(replacement);
    replacement.addEventListener('click', profile);
    badge.update(1);
    replacement.querySelector<HTMLAnchorElement>('.au-friend-alerts-nav-badge')!.click();
    expect(opened).toHaveBeenCalledOnce();
    expect(profile).not.toHaveBeenCalled();
    expect(document.querySelectorAll('.au-friend-alerts-nav-badge')).toHaveLength(1);
    badge.clear();
  });
});

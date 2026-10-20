import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SocialRenderer } from './SocialRenderer';
import { MediaListStatus, type FriendActivity } from '@core/types';

const activity = (name = 'Friend'): FriendActivity => ({ id: 1, status: MediaListStatus.CURRENT, score: 80, progress: 3, user: { id: 1, name, avatar: { medium: 'https://example.com/a.png' } } });

describe('social renderer owned controls', () => {
  beforeEach(() => vi.stubGlobal('AbortController', window.AbortController));
  afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
  function fixture() {
    const preferences = { socialEnabled: true, socialShowAvatars: true };
    const renderer = new SocialRenderer({ getPreferences: () => preferences } as never);
    const card = document.createElement('article'); document.body.appendChild(card);
    const controller = renderer.attachPortal(card, 7, 'Title', [activity()], 'ANIME');
    const open = vi.fn(); window.addEventListener('au-open-social-sidebar', open);
    card.dispatchEvent(new MouseEvent('mouseenter'));
    return { renderer, card, controller, preferences, open, cleanup: () => window.removeEventListener('au-open-social-sidebar', open) };
  }
  it('encodes profile navigation and isolates the opener', () => {
    const f = fixture(); const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    const avatars = f.renderer.getAvatarsElement([activity('name/with ?#')])!; document.body.appendChild(avatars);
    avatars.querySelector<HTMLElement>('img')!.click();
    expect(open).toHaveBeenCalledWith('/user/name%2Fwith%20%3F%23', '_blank', 'noopener,noreferrer');
    f.controller.abort(); f.cleanup();
  });
  it('does not let a retained portal button or avatar act after abort', () => {
    const f = fixture(); const profile = vi.spyOn(window, 'open').mockImplementation(() => null);
    const button = document.querySelector<HTMLElement>('.au-social-button')!;
    const avatar = document.querySelector<HTMLElement>('.friend-avatar')!;
    f.controller.abort(); button.click(); avatar.click();
    expect(f.open).not.toHaveBeenCalled(); expect(profile).not.toHaveBeenCalled(); f.cleanup();
  });
  it('does not open a sidebar for a removed card or while social is disabled', () => {
    const f = fixture(); const button = document.querySelector<HTMLElement>('.au-social-button')!;
    f.preferences.socialEnabled = false; button.click(); expect(f.open).not.toHaveBeenCalled();
    f.preferences.socialEnabled = true; f.card.remove(); button.click(); expect(f.open).not.toHaveBeenCalled();
    f.controller.abort(); f.cleanup();
  });

  it('recreates an externally removed bubble and releases its old controls', () => {
    const f = fixture(); const old = document.querySelector<HTMLElement>('.au-social-bubble-portal')!;
    const button = old.querySelector<HTMLElement>('.au-social-button')!;
    old.remove(); f.card.dispatchEvent(new MouseEvent('mouseenter'));
    expect(document.querySelector('.au-social-bubble-portal')).not.toBe(old);
    button.click(); expect(f.open).not.toHaveBeenCalled();
    document.querySelector<HTMLElement>('.au-social-button')!.click(); expect(f.open).toHaveBeenCalledTimes(1);
    f.controller.abort(); f.cleanup();
  });

  it('ignores avatar clicks for a removed owner and uses no source for an executable image URL', () => {
    const f = fixture(); const profile = vi.spyOn(window, 'open').mockImplementation(() => null);
    const avatar = document.querySelector<HTMLElement>('.friend-avatar')!;
    f.card.remove(); avatar.click(); expect(profile).not.toHaveBeenCalled();
    const unsafe = activity(); unsafe.user.avatar.medium = 'javascript:alert(1)';
    const avatars = f.renderer.getAvatarsElement([unsafe])!;
    expect(avatars.querySelector('img')?.hasAttribute('src')).toBe(false);
    f.controller.abort(); f.cleanup();
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { AstraPillManager } from './AstraPillManager';
import { installNativeListEditorBridge } from '@core/navigation/NativeListEditor';
import { PillUIBuilder } from '../ui/PillUIBuilder';

const config = { isFeatureEnabled: () => true } as never;

const managers: AstraPillManager[] = [];
afterEach(() => {
  for (const manager of managers.splice(0)) manager.stop();
  vi.clearAllTimers();
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('Astra pill progress errors', () => {
  it.each([
    { error: new Error('Progress rejected'), message: 'Progress rejected' },
    { error: { message: 'Offline' }, message: 'Offline' },
    { error: null, message: 'Failed to update progress' },
    { error: 'Offline', message: 'Failed to update progress' },
    { error: { message: 42 }, message: 'Failed to update progress' },
    { error: new Error(''), message: 'Failed to update progress' },
  ])('reports a usable message for $error', async ({ error, message }) => {
    vi.useFakeTimers();
    const incrementProgress = vi.fn().mockRejectedValue(error);
    const toast = { error: vi.fn(), success: vi.fn() };
    const manager = new AstraPillManager({ incrementProgress } as never, {} as never, toast as never, config);
    managers.push(manager);
    manager.start();
    document.body.innerHTML = '<div class="au-pill-wrapper" data-au-media-id="10"><button data-action="mark-watched"></button></div>';

    document.querySelector('button')!.click();
    await Promise.resolve();
    await Promise.resolve();

    expect(incrementProgress).toHaveBeenCalledWith(10);
    expect(toast.error).toHaveBeenCalledExactlyOnceWith(message);
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('attaches the just-watched episode to the success toast so its Diary note field can save', async () => {
    const incrementProgress = vi.fn().mockResolvedValue({ mediaId: 10, title: 'Cyberpunk: Edgerunners', progress: 7 });
    const toast = { error: vi.fn(), success: vi.fn() };
    const manager = new AstraPillManager({ incrementProgress } as never, {} as never, toast as never, config);
    managers.push(manager);
    manager.start();
    document.body.innerHTML = '<div class="au-pill-wrapper" data-au-media-id="10"><button data-action="mark-watched"></button></div>';

    document.querySelector('button')!.click();
    await Promise.resolve();
    await Promise.resolve();

    expect(toast.success).toHaveBeenCalledExactlyOnceWith(
      '✓ Cyberpunk: Edgerunners → Ep 7',
      { mediaId: 10, progress: 7 }
    );
  });
});

describe('Astra pill quick-edit routing', () => {
  it('opens quick edit from a media card inside a generic header wrapper', async () => {
    vi.useFakeTimers();
    const open = vi.fn().mockResolvedValue(undefined);
    const manager = new AstraPillManager({} as never, { open } as never, { error: vi.fn() } as never, config);
    managers.push(manager);
    manager.start();
    document.body.innerHTML = '<div class="header"><div class="au-pill-wrapper" data-au-media-id="16498"><button data-action="edit-entry"></button></div></div>';

    document.querySelector<HTMLButtonElement>('[data-action="edit-entry"]')!.click();
    await Promise.resolve();

    expect(open).toHaveBeenCalledExactlyOnceWith(16498);
  });

  it.each([
    { href: '/manga/30013', type: 'MANGA' },
    { href: '/anime/16498', type: 'ANIME' },
  ])('derives the social sidebar type from the card link ($href)', async ({ href, type }) => {
    vi.useFakeTimers();
    const manager = new AstraPillManager({} as never, { open: vi.fn() } as never, { error: vi.fn() } as never, config);
    managers.push(manager);
    manager.start();
    document.body.innerHTML = `<div class="au-astra-card"><a class="title" href="${href}">Title</a><div class="au-pill-wrapper" data-au-media-id="${href.split('/').pop()}"><button data-action="social-activity"></button></div></div>`;
    const listener = vi.fn();
    window.addEventListener('au-open-social-sidebar', listener);

    document.querySelector<HTMLButtonElement>('[data-action="social-activity"]')!.click();
    window.removeEventListener('au-open-social-sidebar', listener);

    expect(listener).toHaveBeenCalledOnce();
    expect(listener.mock.calls[0][0].detail).toMatchObject({ mediaId: Number(href.split('/').pop()), type });
  });

  it('does not hijack a pill accidentally rendered in the actual navigation', async () => {
    vi.useFakeTimers();
    const open = vi.fn();
    const manager = new AstraPillManager({} as never, { open } as never, { error: vi.fn() } as never, config);
    managers.push(manager);
    manager.start();
    document.body.innerHTML = '<nav class="nav"><div class="au-pill-wrapper" data-au-media-id="16498"><button data-action="edit-entry"></button></div></nav>';

    document.querySelector<HTMLButtonElement>('[data-action="edit-entry"]')!.click();
    await Promise.resolve();

    expect(open).not.toHaveBeenCalled();
  });

  it.each([16498, 30013])('retains the pencil and opens the native editor for %s when Astra is OFF', mediaId => {
    const open = vi.fn();
    const enabled = vi.fn(() => false);
    const manager = new AstraPillManager({} as never, { open } as never, {} as never, { isFeatureEnabled: enabled } as never);
    managers.push(manager); manager.start();
    const app = document.createElement('div'); app.id = 'app'; document.body.append(app);
    const dispatch = vi.fn().mockResolvedValue(undefined);
    Object.assign(app, { __vue__: { $store: { dispatch } } });
    const release = installNativeListEditorBridge();
    try {
      new PillUIBuilder().inject(app, { mediaId, astraEnabled: false, isUserListCard: true, socialEnabled: false, socialShowAvatars: false });
      const pencil = app.querySelector<HTMLElement>('[data-action="edit-entry"]')!;
      expect(pencil.querySelector('.fa-pencil')).not.toBeNull(); pencil.click();
      expect(dispatch).toHaveBeenCalledExactlyOnceWith('medialistEditor/open', mediaId);
      expect(open).not.toHaveBeenCalled();
      // Existing controls must switch immediately when settings change.
      enabled.mockReturnValue(true); pencil.click();
      expect(open).toHaveBeenCalledExactlyOnceWith(mediaId);
      expect(dispatch).toHaveBeenCalledOnce();
    } finally { release(); }
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { createThemeRatingControl } from './ThemeRatingControl';
import { ToastService } from '@core/services/ToastService';
import { EventBus } from '@core/events/EventBus';
import type { IThemeRatingPrompt } from '@core/interfaces/IThemeRatingPrompt';

const slide = (root: HTMLElement, value: string) => {
  const slider = root.querySelector('input')!;
  slider.value = value;
  slider.dispatchEvent(new Event('input'));
  slider.dispatchEvent(new Event('change'));
};

describe('ThemeRatingControl', () => {
  it('saves on release, with 0 meaning unrated', async () => {
    const onRate = vi.fn(async () => {});
    const root = createThemeRatingControl({ label: 'Rate', score: null, onRate });
    expect(root.querySelector('output')!.textContent).toBe('—');
    slide(root, '7.3');
    await vi.waitFor(() => expect(onRate).toHaveBeenCalledWith(7.3));
    expect(root.classList.contains('au-theme-rate--set')).toBe(true);
    slide(root, '0');
    await vi.waitFor(() => expect(onRate).toHaveBeenLastCalledWith(null));
  });

  it('reverts and flags the control when saving fails', async () => {
    const root = createThemeRatingControl({
      label: 'Rate',
      score: 6,
      onRate: async () => {
        throw new Error('offline');
      },
    });
    slide(root, '9');
    await vi.waitFor(() => expect(root.classList.contains('au-theme-rate--error')).toBe(true));
    expect(root.querySelector('input')!.value).toBe('6');
    expect(root.querySelector('output')!.textContent).toBe('6.0');
  });
});

describe('progress toast with new themes', () => {
  let service: ToastService | null = null;
  afterEach(() => {
    service?.destroy();
    service = null;
    document.body.innerHTML = '';
  });

  function setup(songs: Awaited<ReturnType<IThemeRatingPrompt['findNewThemes']>>) {
    const prompt = {
      availability: vi.fn(async () => ({ enabled: true, kinds: { OP: 'linked' as const, ED: 'linked' as const } })),
      findNewThemes: vi.fn(async () => songs),
      getScores: vi.fn(),
      rate: vi.fn(async () => {}),
    };
    service = new ToastService(new EventBus(), { updateNotes: vi.fn() } as never, prompt);
    return prompt;
  }

  it('adds one slider per new song and rates through the prompt', async () => {
    const prompt = setup([{ id: '5:OP:2:second', kind: 'OP', title: 'Second', artist: 'A' }]);
    service!.success('Ep 14', { mediaId: 5, progress: 14, previousProgress: 13 });
    await vi.waitFor(() => expect(document.querySelector('.au-toast__themes')).not.toBeNull());
    expect(prompt.findNewThemes).toHaveBeenCalledWith(5, 13, 14);
    expect(document.querySelector('.au-toast__theme-label')!.textContent).toContain(
      'New OP · Second — A'
    );
    slide(document.querySelector('.au-toast__themes')!, '8');
    await vi.waitFor(() =>
      expect(prompt.rate).toHaveBeenCalledWith(
        5,
        expect.objectContaining({ id: '5:OP:2:second' }),
        8
      )
    );
  });

  it('leaves the toast unchanged without new songs or previous progress', async () => {
    const prompt = setup([]);
    service!.success('Ep 15', { mediaId: 5, progress: 15, previousProgress: 14 });
    service!.success('Ep 16', { mediaId: 5, progress: 16 });
    await vi.waitFor(() => expect(prompt.findNewThemes).toHaveBeenCalledTimes(1));
    await Promise.resolve();
    expect(document.querySelector('.au-toast__themes')).toBeNull();
    expect(document.querySelectorAll('.au-toast__note-input')).toHaveLength(2);
  });
});

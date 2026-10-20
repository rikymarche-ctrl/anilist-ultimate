import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Module loading under CPU contention can exceed the 5s default in jsdom.
vi.setConfig({ testTimeout: 20_000 });

const { config } = vi.hoisted(() => ({
  config: {
    load: vi.fn(async () => undefined),
    get: vi.fn((_key: string) => ({ accentColor: '#3dbbee' })),
    set: vi.fn(async () => undefined),
    setFeature: vi.fn(async () => undefined),
    isFeatureEnabled: vi.fn(() => true),
  },
}));

vi.mock('@core/di/container', () => ({
  container: {
    registerInstance: vi.fn(),
    registerSingleton: vi.fn(),
    resolve: vi.fn(() => config),
  },
}));
vi.mock('@core/config/ConfigClient', () => ({ ConfigClient: class {} }));
vi.mock('@core/storage/StorageManager', () => ({ StorageManager: class {} }));
vi.mock('@core/events/EventBus', () => ({ EventBus: class {} }));
vi.mock('@core/ui/Icons', () => ({}));
vi.mock('./RecoveryPanel', () => ({ RecoveryPanel: class {} }));
vi.mock('@core/constants', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@core/constants')>()),
  APP_VERSION: '9.9.9-test',
}));

/** Loads a fresh settings page controller into a clean #settings-app root. */
async function openSettings(): Promise<void> {
  document.body.innerHTML = '<div id="settings-app"></div>';
  vi.resetModules();
  await import('./settings');
  await vi.waitFor(() =>
    expect(document.querySelector('input[data-module="listEditor"]')).not.toBeNull()
  );
}

function saveIndicator(): HTMLElement {
  return document.getElementById('save-indicator') as HTMLElement;
}

describe('settings save feedback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.documentElement.style.removeProperty('--astra-accent');
  });
  afterEach(() => {
    document.body.replaceChildren();
  });

  it('reverts a module toggle and shows an error when the setting cannot be saved', async () => {
    config.setFeature.mockRejectedValueOnce(new Error('quota exceeded'));
    await openSettings();
    const toggle = document.querySelector<HTMLInputElement>('input[data-module="listEditor"]')!;
    expect(toggle.checked).toBe(true);

    toggle.checked = false;
    toggle.dispatchEvent(new Event('change'));

    await vi.waitFor(() => expect(toggle.checked).toBe(true));
    expect(config.setFeature).toHaveBeenCalledWith('listEditor', false);
    expect(saveIndicator().classList.contains('visible')).toBe(true);
    expect(saveIndicator().querySelector('.fa-triangle-exclamation')).not.toBeNull();
    expect(saveIndicator().querySelector('span')!.textContent).toBe(
      'Could not save. Please try again.'
    );
  });

  it('keeps a saved module toggle and shows the success indicator', async () => {
    await openSettings();
    const toggle = document.querySelector<HTMLInputElement>('input[data-module="listEditor"]')!;

    toggle.checked = false;
    toggle.dispatchEvent(new Event('change'));

    await vi.waitFor(() => expect(saveIndicator().classList.contains('visible')).toBe(true));
    expect(toggle.checked).toBe(false);
    expect(saveIndicator().querySelector('.fa-circle-check')).not.toBeNull();
    expect(saveIndicator().querySelector('span')!.textContent).toBe('Configuration updated');
  });

  it('rolls the accent preview back to the persisted colour when the save fails', async () => {
    config.set.mockRejectedValueOnce(new Error('quota exceeded'));
    await openSettings();
    const picker = document.getElementById('accent-color-picker') as HTMLInputElement;

    picker.value = '#ff0000';
    picker.dispatchEvent(new Event('input'));
    expect(document.getElementById('color-value')!.textContent).toBe('#FF0000');
    picker.dispatchEvent(new Event('change'));

    await vi.waitFor(() => expect(picker.value).toBe('#3dbbee'));
    expect(document.getElementById('color-value')!.textContent).toBe('#3DBBEE');
    expect(document.documentElement.style.getPropertyValue('--astra-accent')).toBe('#3dbbee');
    expect(saveIndicator().querySelector('.fa-triangle-exclamation')).not.toBeNull();
  });
});

describe('settings about section', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    document.body.replaceChildren();
  });

  it('links to the repository, drops the Discord placeholder and shows the shared app version', async () => {
    await openSettings();
    const about = document.getElementById('section-about') as HTMLElement;
    const github = about.querySelector<HTMLAnchorElement>('a[href*="github.com"]')!;
    const profile = about.querySelector<HTMLAnchorElement>('a[href="https://anilist.co/user/ExAstra/"]')!;

    expect(github.getAttribute('href')).toBe('https://github.com/rikymarche-ctrl/anilist-ultimate');
    expect(github.getAttribute('target')).toBe('_blank');
    expect(github.getAttribute('rel')).toBe('noopener noreferrer');
    expect(profile.textContent).toBe('ExAstra');
    expect(profile.getAttribute('target')).toBe('_blank');
    expect(profile.getAttribute('rel')).toBe('noopener noreferrer');
    expect(about.querySelectorAll('a[href="#"]')).toHaveLength(0);
    expect(about.textContent).not.toContain('Discord');
    expect(about.textContent).toContain('AniList Ultimate v9.9.9-test');
  });

  it('describes the bulk editor as operating on the own lists of the logged-in user', async () => {
    await openSettings();
    const card = document.querySelector('.module-card:has(input[data-module="listEditor"])')!;

    expect(card.textContent).toContain(
      'Edit status and custom list memberships on your own anime and manga lists.'
    );
    expect(card.textContent).not.toContain('ExAstra');
  });
});

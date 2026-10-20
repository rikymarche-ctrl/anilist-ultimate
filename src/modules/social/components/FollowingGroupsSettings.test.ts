import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { logger } from '@core/logger';
import type { FollowingGroupsConfig } from '../FollowingGrouping';
import { FollowingGroupsSettings } from './FollowingGroupsSettings';

const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

function fixture(initial: FollowingGroupsConfig, listNames: string[]) {
  let config = structuredClone(initial);
  const listeners = new Set<() => void>();
  const groups = {
    init: vi.fn(async (): Promise<void> => undefined),
    getConfig: vi.fn(() => structuredClone(config)),
    onChange: vi.fn((listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    }),
    setGroupEnabled: vi.fn(async (): Promise<void> => undefined),
    moveGroup: vi.fn(async (): Promise<void> => undefined),
    setCollapsed: vi.fn(async (): Promise<void> => undefined),
  };
  const toast = { error: vi.fn() };
  const settings = new FollowingGroupsSettings(groups as never, toast as never, listNames);
  const parent = document.createElement('div');
  document.body.append(parent);
  settings.mount(parent);
  return {
    settings,
    groups,
    toast,
    parent,
    listeners,
    names: () =>
      [...parent.querySelectorAll<HTMLElement>('.au-fg-name')].map(
        (element) => element.textContent
      ),
    checked: (name: string) =>
      parent.querySelector<HTMLInputElement>(`[data-fg-toggle="${name}"]`)!.checked,
    arrow: (name: string, direction: 'up' | 'down') =>
      parent.querySelector<HTMLButtonElement>(`[aria-label="Move ${name} ${direction}"]`),
    update: (next: FollowingGroupsConfig) => {
      config = structuredClone(next);
      listeners.forEach((listener) => listener());
    },
  };
}

describe('following groups settings', () => {
  beforeEach(() => {
    vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => {
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it('shows enabled groups first in configured order, then the remaining lists unchecked', async () => {
    const view = fixture(
      { groups: ['Trusted', 'Friends'], collapsed: [], othersCollapsed: false },
      ['Friends', 'Team', 'Trusted']
    );
    await flush();
    expect(view.names()).toEqual(['Trusted', 'Friends', 'Team']);
    expect(['Trusted', 'Friends', 'Team'].map((name) => view.checked(name))).toEqual([
      true,
      true,
      false,
    ]);
    expect(view.arrow('Team', 'up')).toBeNull();
    expect(view.parent.textContent).toContain('Others — always last');
  });

  it('hides configured names that no longer exist as lists', () => {
    const view = fixture({ groups: ['Gone', 'Friends'], collapsed: [], othersCollapsed: false }, [
      'Friends',
    ]);
    expect(view.names()).toEqual(['Friends']);
  });

  it('calls the service for checkbox changes', () => {
    const view = fixture({ groups: [], collapsed: [], othersCollapsed: false }, ['Team']);
    const checkbox = view.parent.querySelector<HTMLInputElement>('[data-fg-toggle="Team"]')!;
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change', { bubbles: true }));
    expect(view.groups.setGroupEnabled).toHaveBeenCalledWith('Team', true);
  });

  it('calls moveGroup for arrows and disables the arrows at the edges', async () => {
    const view = fixture(
      { groups: ['Trusted', 'Friends'], collapsed: [], othersCollapsed: false },
      ['Friends', 'Trusted']
    );
    await flush();
    expect(view.arrow('Trusted', 'up')!.disabled).toBe(true);
    expect(view.arrow('Friends', 'down')!.disabled).toBe(true);
    view.arrow('Friends', 'up')!.click();
    view.arrow('Trusted', 'down')!.click();
    expect(view.groups.moveGroup).toHaveBeenNthCalledWith(1, 'Friends', -1);
    expect(view.groups.moveGroup).toHaveBeenNthCalledWith(2, 'Trusted', 1);
  });

  it('re-renders when the stored config changes', async () => {
    const view = fixture({ groups: [], collapsed: [], othersCollapsed: false }, [
      'Friends',
      'Team',
    ]);
    await flush();
    view.update({ groups: ['Team'], collapsed: [], othersCollapsed: false });
    expect(view.names()).toEqual(['Team', 'Friends']);
    expect(view.checked('Team')).toBe(true);
  });

  it('shows a toast and restores the stored state when a write fails', async () => {
    const view = fixture({ groups: [], collapsed: [], othersCollapsed: false }, ['Team']);
    view.groups.setGroupEnabled.mockRejectedValueOnce(new Error('Write failed'));
    const checkbox = view.parent.querySelector<HTMLInputElement>('[data-fg-toggle="Team"]')!;
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change', { bubbles: true }));
    await flush();
    expect(view.toast.error).toHaveBeenCalledWith('Failed to save following groups. Please retry.');
    expect(view.checked('Team')).toBe(false);
    expect(logger.error).toHaveBeenCalled();
  });

  it('unsubscribes from config changes on unmount', () => {
    const view = fixture({ groups: [], collapsed: [], othersCollapsed: false }, ['Team']);
    view.settings.unmount();
    expect(view.listeners.size).toBe(0);
  });
});

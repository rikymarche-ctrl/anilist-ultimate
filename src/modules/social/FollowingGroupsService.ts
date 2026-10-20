import { injectable, singleton } from 'tsyringe';
import { STORAGE_PREFIX } from '@core/constants';
import { logger } from '@core/logger';
import { localStorageOperation } from '@core/storage/LocalStorageBridge';
import { validListName } from './CustomListService';
import type { FollowingGroupsConfig } from './FollowingGrouping';

/** Local display preference only: nothing stored here is sent to AniList. */
export const FOLLOWING_GROUPS_KEY = `${STORAGE_PREFIX}following_groups_v1`;
const MAX_GROUPS = 100;

const defaultConfig = (): FollowingGroupsConfig => ({
  groups: [],
  collapsed: [],
  othersCollapsed: false,
});
const isNameList = (value: unknown): value is string[] =>
  Array.isArray(value) &&
  value.length <= MAX_GROUPS &&
  value.every(validListName) &&
  new Set(value).size === value.length;
const sameList = (left: string[], right: string[]): boolean =>
  left.length === right.length && left.every((name, index) => name === right[index]);
const sameConfig = (left: FollowingGroupsConfig, right: FollowingGroupsConfig): boolean =>
  left.othersCollapsed === right.othersCollapsed &&
  sameList(left.groups, right.groups) &&
  sameList(left.collapsed, right.collapsed);

/** Accepts only bounded, unique lists of valid names plus a boolean Others flag. */
export function validateFollowingGroups(data: unknown): asserts data is FollowingGroupsConfig {
  const record = data as Record<string, unknown> | null;
  if (
    !record ||
    typeof record !== 'object' ||
    Array.isArray(record) ||
    !isNameList(record.groups) ||
    !isNameList(record.collapsed) ||
    typeof record.othersCollapsed !== 'boolean'
  )
    throw new Error('Invalid following groups; original data preserved');
}

/** Durable local config for Following groups: serialized writes, and state is published only after a save succeeds. */
@injectable()
@singleton()
export class FollowingGroupsService {
  private config: FollowingGroupsConfig = defaultConfig();
  private ready: Promise<void> | null = null;
  private writes: Promise<unknown> = Promise.resolve();
  private readonly listeners = new Set<() => void>();
  private disposed = false;
  private readonly storageEvents = chrome.storage.onChanged;
  private readonly storageListener = (
    changes: Record<string, chrome.storage.StorageChange>,
    area: string
  ): void => {
    if (
      this.disposed ||
      area !== 'local' ||
      !Object.prototype.hasOwnProperty.call(changes, FOLLOWING_GROUPS_KEY)
    )
      return;
    const value: unknown = changes[FOLLOWING_GROUPS_KEY].newValue;
    try {
      validateFollowingGroups(value);
    } catch {
      return;
    } // Invalid or removed values are ignored.
    this.replace(structuredClone(value));
  };

  constructor() {
    this.storageEvents?.addListener(this.storageListener);
  }

  /** Loads once; concurrent callers share the load, and a failed load is retried by the next call. */
  init(): Promise<void> {
    if (!this.ready)
      this.ready = this.load().catch((error: unknown) => {
        this.ready = null;
        throw error;
      });
    return this.ready;
  }

  private async load(): Promise<void> {
    const data = (await localStorageOperation('get', FOLLOWING_GROUPS_KEY))[FOLLOWING_GROUPS_KEY];
    if (data === undefined || data === null) return;
    try {
      validateFollowingGroups(data);
    } catch (error) {
      logger.warn('[FollowingGroups] Ignoring invalid stored groups; defaults kept', error);
      return;
    }
    this.replace(structuredClone(data));
  }

  getConfig(): FollowingGroupsConfig {
    return structuredClone(this.config);
  }

  /** Subscribe to config changes (own writes and other tabs). Returns the unsubscribe. */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  setGroupEnabled(name: string, enabled: boolean): Promise<void> {
    if (!validListName(name) || typeof enabled !== 'boolean')
      return Promise.reject(new Error('Invalid following group'));
    return this.edit((current) => {
      if (!enabled)
        return {
          ...current,
          groups: current.groups.filter((entry) => entry !== name),
          collapsed: current.collapsed.filter((entry) => entry !== name),
        };
      return current.groups.includes(name)
        ? current
        : { ...current, groups: [...current.groups, name] };
    });
  }

  moveGroup(name: string, direction: -1 | 1): Promise<void> {
    if (!validListName(name) || (direction !== -1 && direction !== 1))
      return Promise.reject(new Error('Invalid following group move'));
    return this.edit((current) => {
      const index = current.groups.indexOf(name);
      const target = index + direction;
      if (index === -1 || target < 0 || target >= current.groups.length) return current;
      const groups = [...current.groups];
      [groups[index], groups[target]] = [groups[target], groups[index]];
      return { ...current, groups };
    });
  }

  /** `null` addresses the Others group. */
  setCollapsed(name: string | null, collapsed: boolean): Promise<void> {
    if ((name !== null && !validListName(name)) || typeof collapsed !== 'boolean')
      return Promise.reject(new Error('Invalid following group state'));
    return this.edit((current) => {
      if (name === null)
        return current.othersCollapsed === collapsed
          ? current
          : { ...current, othersCollapsed: collapsed };
      if (current.collapsed.includes(name) === collapsed) return current;
      return {
        ...current,
        collapsed: collapsed
          ? [...current.collapsed, name]
          : current.collapsed.filter((entry) => entry !== name),
      };
    });
  }

  /** Stops listening to other tabs; own writes remain serialized. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.listeners.clear();
    this.storageEvents?.removeListener(this.storageListener);
  }

  private edit(change: (current: FollowingGroupsConfig) => FollowingGroupsConfig): Promise<void> {
    const pending = this.writes.then(async () => {
      await this.init();
      const next = change(structuredClone(this.config));
      if (sameConfig(next, this.config)) return;
      await this.save(next);
    });
    this.writes = pending.catch(() => undefined);
    return pending;
  }

  private async save(next: FollowingGroupsConfig): Promise<void> {
    validateFollowingGroups(next);
    await localStorageOperation('set', { [FOLLOWING_GROUPS_KEY]: next });
    this.replace(next);
  }

  private replace(next: FollowingGroupsConfig): void {
    if (sameConfig(next, this.config)) return;
    this.config = structuredClone(next);
    for (const listener of [...this.listeners]) {
      try {
        listener();
      } catch (error) {
        logger.error('[FollowingGroups] Change listener failed', error);
      }
    }
  }
}

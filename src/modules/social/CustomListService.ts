import { injectable, singleton } from 'tsyringe';
import { localStorageOperation } from '@core/storage/LocalStorageBridge';

export interface CustomListUser {
  id: number;
  name: string;
  avatar: string;
}
export interface CustomLists {
  [listName: string]: CustomListUser[];
}
const key = 'custom_lists_account_local';
const hasOwn = (target: object, property: string): boolean =>
  Object.prototype.hasOwnProperty.call(target, property);
/** Own-property read only: inherited names such as 'toString' must never resolve to Object.prototype members. */
const ownMembers = (lists: CustomLists, name: string): CustomListUser[] =>
  hasOwn(lists, name) ? lists[name] : [];
/** Rejects names that collide with Object.prototype members ('toString', '__proto__', ...) and 'prototype'. */
export const validListName = (name: string) =>
  typeof name === 'string' &&
  name.trim().length > 0 &&
  name.length <= 200 &&
  name !== 'prototype' &&
  !(name in Object.prototype);
export const validListUser = (user: unknown): user is CustomListUser =>
  !!user &&
  typeof user === 'object' &&
  Number.isSafeInteger((user as CustomListUser).id) &&
  (user as CustomListUser).id > 0 &&
  typeof (user as CustomListUser).name === 'string' &&
  (user as CustomListUser).name.length <= 200 &&
  typeof (user as CustomListUser).avatar === 'string' &&
  (user as CustomListUser).avatar.length <= 2048;

export function validateCustomLists(data: unknown): asserts data is CustomLists {
  if (
    !data ||
    typeof data !== 'object' ||
    Array.isArray(data) ||
    Object.keys(data).length > 100 ||
    !Object.entries(data).every(
      ([name, users]) =>
        validListName(name) &&
        Array.isArray(users) &&
        users.length <= 10000 &&
        users.every(validListUser)
    )
  )
    throw new Error('Invalid custom lists; original data preserved');
}

/** Durable list edits: failed reads/writes never publish defaults or modified state. */
@injectable()
@singleton()
export class CustomListService {
  protected lists: CustomLists = {};
  private ready: Promise<void> | null = null;
  private writes: Promise<unknown> = Promise.resolve();
  constructor(private storageKey = key) {}

  init(): Promise<void> {
    if (!this.ready)
      this.ready = this.load().catch((error) => {
        this.ready = null;
        throw error;
      });
    return this.ready;
  }
  private async load(): Promise<void> {
    const data = (await localStorageOperation('get', this.storageKey))[this.storageKey];
    if (data !== undefined && data !== null) {
      validateCustomLists(data);
      this.lists = structuredClone(data as CustomLists);
      return;
    }
    await this.save({ 'Best Friends': [] });
  }
  getLists(): CustomLists {
    return structuredClone(this.lists);
  }
  getList(name: string): CustomListUser[] {
    return structuredClone(ownMembers(this.lists, name));
  }
  isUserInList(name: string, userId: number): boolean {
    return ownMembers(this.lists, name).some((user) => user.id === userId);
  }
  private edit(change: (lists: CustomLists) => void): Promise<void> {
    const pending = this.writes.then(async () => {
      await this.init();
      const next = structuredClone(this.lists);
      change(next);
      await this.save(next);
    });
    this.writes = pending.catch(() => undefined);
    return pending;
  }
  async toggleUserInList(name: string, user: CustomListUser, active: boolean): Promise<void> {
    if (!validListName(name) || !validListUser(user) || typeof active !== 'boolean')
      throw new Error('Invalid list membership');
    const copy = structuredClone(user);
    return this.edit((lists) => {
      const members = ownMembers(lists, name);
      lists[name] = active
        ? members.some((entry) => entry.id === copy.id)
          ? members
          : [...members, copy]
        : members.filter((entry) => entry.id !== copy.id);
    });
  }
  createList(name: string): Promise<void> {
    if (!validListName(name)) return Promise.reject(new Error('Invalid list name'));
    return this.edit((lists) => {
      if (!hasOwn(lists, name)) lists[name] = [];
    });
  }
  deleteList(name: string): Promise<void> {
    if (!validListName(name)) return Promise.reject(new Error('Invalid list name'));
    return this.edit((lists) => {
      delete lists[name];
    });
  }
  private async save(next: CustomLists): Promise<void> {
    validateCustomLists(next);
    await localStorageOperation('set', { [this.storageKey]: next });
    this.lists = structuredClone(next);
  }
}

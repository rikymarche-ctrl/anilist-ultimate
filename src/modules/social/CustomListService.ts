/**
 * Custom List Service
 * Manages local storage for custom user lists (Best Friends, Haters, etc.)
 */

import { log } from '@core/logger';

export interface CustomListUser {
  id: number;
  name: string;
  avatar: string;
}

export interface CustomLists {
  [listName: string]: CustomListUser[];
}

export class CustomListService {
  private static instance: CustomListService;
  private STORAGE_KEY = 'au_custom_user_lists';
  private lists: CustomLists = {};

  private constructor() {}

  public static getInstance(): CustomListService {
    if (!CustomListService.instance) {
      CustomListService.instance = new CustomListService();
    }
    return CustomListService.instance;
  }

  /**
   * Initializes the service by loading data from storage
   */
  public async init(): Promise<void> {
    try {
      const data = await chrome.storage.local.get(this.STORAGE_KEY);

      if (!data[this.STORAGE_KEY] || Object.keys(data[this.STORAGE_KEY]).length === 0) {
        // First time - create default list
        this.lists = { 'Best Friends': [] };
        await this.save(); // Save to storage immediately
        log.info('[CustomListService] Created default "Best Friends" list');
      } else {
        this.lists = data[this.STORAGE_KEY];
        log.debug('[CustomListService] Loaded lists', Object.keys(this.lists));
      }
    } catch (e) {
      log.error('[CustomListService] Load failed', e);
      this.lists = { 'Best Friends': [] };
      await this.save();
    }
  }

  public getLists(): CustomLists {
    return this.lists;
  }

  public getList(name: string): CustomListUser[] {
    return this.lists[name] || [];
  }

  /**
   * Updates a user's presence in a specific list
   */
  public async toggleUserInList(listName: string, user: CustomListUser, isActive: boolean): Promise<void> {
    if (!this.lists[listName]) {
      this.lists[listName] = [];
    }

    if (isActive) {
      // Add if not present
      if (!this.lists[listName].some(u => u.id === user.id)) {
        this.lists[listName].push(user);
      }
    } else {
      // Remove
      this.lists[listName] = this.lists[listName].filter(u => u.id !== user.id);
    }

    await this.save();
  }

  public async createList(name: string): Promise<void> {
    if (!this.lists[name]) {
      this.lists[name] = [];
      await this.save();
    }
  }

  public async deleteList(name: string): Promise<void> {
    if (this.lists[name]) {
      delete this.lists[name];
      await this.save();
    }
  }

  private async save(): Promise<void> {
    try {
      await chrome.storage.local.set({ [this.STORAGE_KEY]: this.lists });
    } catch (e) {
      log.error('[CustomListService] Save failed', e);
    }
  }

  /**
   * Checks if a user is in a specific list
   */
  public isUserInList(listName: string, userId: number): boolean {
    return this.lists[listName]?.some(u => u.id === userId) || false;
  }
}

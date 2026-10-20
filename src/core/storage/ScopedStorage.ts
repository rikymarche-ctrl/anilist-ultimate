import type { IStorageService } from '@core/interfaces/IStorageService';

/** Fixed namespace adapter. It never follows a mutable current-account value. */
export class ScopedStorage implements IStorageService {
  constructor(private storage: IStorageService, private prefix: string) {}
  get<T>(key: string): Promise<T | null> { return this.storage.get(this.prefix + key); }
  set<T>(key: string, value: T): Promise<boolean> { return this.storage.set(this.prefix + key, value); }
  remove(key: string): Promise<boolean> { return this.storage.remove(this.prefix + key); }
  async clear(): Promise<boolean> { throw new Error('Scoped storage must be cleared through its repository'); }
  async has(key: string): Promise<boolean> { return (await this.get(key)) !== null; }
  async getMultiple<T extends Record<string, unknown>>(keys: string[]): Promise<Partial<T>> {
    const data = await this.storage.getMultiple(keys.map(key => this.prefix + key));
    return Object.fromEntries(Object.entries(data).map(([key, value]) => [key.slice(this.prefix.length), value])) as Partial<T>;
  }
  setMultiple<T extends Record<string, unknown>>(items: Partial<T>): Promise<boolean> {
    return this.storage.setMultiple(Object.fromEntries(Object.entries(items).map(([key, value]) => [this.prefix + key, value])));
  }
  onChange<T>(key: string, callback: (newValue: T | null, oldValue: T | null) => void): () => void { return this.storage.onChange(this.prefix + key, callback); }
}

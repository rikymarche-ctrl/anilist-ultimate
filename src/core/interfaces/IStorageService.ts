/**
 * Storage Service Interface
 * Contract for persistent storage operations
 */

export interface IStorageService {
  /**
   * Get a value from storage
   */
  get<T>(key: string): Promise<T | null>;

  /**
   * Set a value in storage
   */
  set<T>(key: string, value: T): Promise<boolean>;

  /**
   * Remove a value from storage
   */
  remove(key: string): Promise<boolean>;

  /**
   * Clear all storage
   */
  clear(): Promise<boolean>;

  /**
   * Check if a key exists
   */
  has(key: string): Promise<boolean>;

  /**
   * Get multiple values at once
   */
  getMultiple<T extends Record<string, any>>(keys: string[]): Promise<Partial<T>>;

  /**
   * Set multiple values at once
   */
  setMultiple<T extends Record<string, any>>(items: Partial<T>): Promise<boolean>;

  /**
   * Watch for storage changes
   */
  onChange<T>(
    key: string,
    callback: (newValue: T | null, oldValue: T | null) => void
  ): () => void;
}

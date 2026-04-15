/**
 * Key-value store abstraction. The real app uses AsyncStorage; tests swap
 * in an in-memory implementation. This keeps the persistence layer testable
 * in Node without any React Native bindings.
 */

export interface KvStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

/** In-memory KvStore. Used in tests and as a safety fallback. */
export class MemoryKvStore implements KvStore {
  private readonly map = new Map<string, string>();

  async getItem(key: string): Promise<string | null> {
    return this.map.has(key) ? this.map.get(key)! : null;
  }

  async setItem(key: string, value: string): Promise<void> {
    this.map.set(key, value);
  }

  async removeItem(key: string): Promise<void> {
    this.map.delete(key);
  }
}

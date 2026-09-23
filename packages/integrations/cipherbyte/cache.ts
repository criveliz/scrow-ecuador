interface CacheItem<T> {
  value: T;
  expiresAt: number;
}

export class CipherByteCache {
  private cache = new Map<string, CacheItem<unknown>>();
  private defaultTtlMs: number;

  constructor(defaultTtlMs: number = 15 * 60 * 1000) {
    this.defaultTtlMs = defaultTtlMs;
  }

  get<T>(key: string): T | null {
    const item = this.cache.get(key);
    if (!item) {
      return null;
    }

    if (Date.now() > item.expiresAt) {
      this.cache.delete(key);
      return null;
    }

    return item.value as T;
  }

  set<T>(key: string, value: T, ttlMs?: number): void {
    const expiresAt = Date.now() + (ttlMs ?? this.defaultTtlMs);
    this.cache.set(key, { value, expiresAt });
  }

  clear(): void {
    this.cache.clear();
  }
}

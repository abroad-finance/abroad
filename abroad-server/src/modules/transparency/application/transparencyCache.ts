type CacheEntry<T> = {
  refreshedAtMs: number
  value: T
}

export class TransparencyCache<T> {
  private entry: CacheEntry<T> | null = null
  private refreshPromise: null | Promise<T> = null

  public constructor(private readonly ttlMs: number) {}

  public getFresh(now = Date.now()): null | T {
    if (!this.entry || now - this.entry.refreshedAtMs > this.ttlMs) return null
    return this.entry.value
  }

  public getWithin(maxAgeMs: number, now = Date.now()): null | T {
    if (!this.entry || now - this.entry.refreshedAtMs > maxAgeMs) return null
    return this.entry.value
  }

  public async refresh(loader: () => Promise<T>): Promise<T> {
    if (this.refreshPromise) return this.refreshPromise

    const refresh = loader()
    this.refreshPromise = refresh
    try {
      const value = await refresh
      this.entry = {
        refreshedAtMs: Date.now(),
        value,
      }
      return value
    }
    finally {
      if (this.refreshPromise === refresh) this.refreshPromise = null
    }
  }
}

export interface ILockManager {
  /**
   * Runs `fn` while holding a distributed lock for `key`.
   * The lock is automatically renewed while the function runs.
   */
  withLock<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T>
}

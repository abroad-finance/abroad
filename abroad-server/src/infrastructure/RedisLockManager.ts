import { inject, injectable } from 'inversify'
import IORedis from 'ioredis'
import Redlock from 'redlock'

import { ILockManager } from '../interfaces/ILockManager'
import { ISecretManager } from '../interfaces/ISecretManager'
import { TYPES } from '../types'

@injectable()
export class RedisLockManager implements ILockManager {
  private redis?: IORedis
  private redlock?: Redlock

  constructor(@inject(TYPES.ISecretManager) private secretManager: ISecretManager) {}

  async withLock<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
    await this.init()
    const resource = `lock:stellar:${key}`
    return this.redlock!.using([resource], ttlMs, async () => {
      return await fn()
    })
  }

  private async init(): Promise<void> {
    if (this.redlock) return

    // Prefer a single REDIS_URL; fall back to host/port/password secrets or envs.
    const redisUrl = await this.secretManager.getSecret('REDIS_URL')

    this.redis = new IORedis(redisUrl, {
      enableReadyCheck: true,
      // For GCP Memorystore, these defaults are fine; set tls:{} if using a managed TLS endpoint
      maxRetriesPerRequest: null,
    })

    this.redis.once('ready', () => {
      console.info('[Redlock] Redis connection ready')
    })

    this.redlock = new Redlock([this.redis!], {
      // Auto-extend while your critical section is running
      automaticExtensionThreshold: 5000, // extend if <5s remains
      driftFactor: 0.01,
      // Reasonable defaults; tune if you see contention
      retryCount: 20,
      retryDelay: 100, // ms
      retryJitter: 50,
    })

    // Redlock emits non-fatal errors (e.g., transient Redis hiccups)
    this.redlock.on('error', (err) => {
      console.warn('[Redlock] non-fatal error:', err?.message || err)
    })
  }
}

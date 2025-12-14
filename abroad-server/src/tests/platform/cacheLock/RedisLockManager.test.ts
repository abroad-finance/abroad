import IORedis from 'ioredis'
import Redlock from 'redlock'

import type { ISecretManager } from '../../../platform/secrets/ISecretManager'

import { RedisLockManager } from '../../../platform/cacheLock/redisLockManager'
import { createMockLogger } from '../../setup/mockFactories'

jest.mock('ioredis')
jest.mock('redlock')

describe('RedisLockManager', () => {
  const redisUrl = 'redis://localhost:6379'
  const redisInstance = {
    once: jest.fn(),
  }
  const redlockUsing = jest.fn()
  const redlockOn = jest.fn()
  const redlockInstances: Array<{ clients: unknown[], options: unknown }> = []

  let secretManager: ISecretManager
  const logger = createMockLogger()

  beforeEach(() => {
    jest.clearAllMocks()
    redlockInstances.length = 0
    redlockUsing.mockReset()
    redlockOn.mockReset()
    secretManager = {
      getSecret: jest.fn(async () => redisUrl),
      getSecrets: jest.fn(),
    }

    ;(IORedis as unknown as jest.Mock).mockImplementation(() => redisInstance)
    ;(Redlock as unknown as jest.Mock).mockImplementation((clients: unknown[], options: unknown) => {
      redlockInstances.push({ clients, options })
      return {
        on: redlockOn,
        settings: { retryDelay: 100 },
        using: redlockUsing,
      }
    })
  })

  it('initializes once and executes the provided callback within a lock', async () => {
    const manager = new RedisLockManager(secretManager, logger)
    const work = jest.fn(async () => 'ok')
    redlockUsing.mockImplementation(async (_resources: string[], _ttl: number, opts: { retryCount: number }, fn: () => Promise<unknown>) => {
      return fn()
    })

    const result = await manager.withLock('account-1', 5000, work)
    const second = await manager.withLock('account-1', 5000, work)

    expect(result).toBe('ok')
    expect(second).toBe('ok')

    expect(secretManager.getSecret).toHaveBeenCalledTimes(1)
    expect(IORedis).toHaveBeenCalledWith(redisUrl, expect.objectContaining({ enableReadyCheck: true, maxRetriesPerRequest: null }))
    expect(redlockInstances).toHaveLength(1)
    expect(redlockInstances[0]?.clients[0]).toBe(redisInstance)
    expect(redlockInstances[0]?.options).toEqual(expect.objectContaining({ automaticExtensionThreshold: 5000, retryDelay: 100 }))

    expect(redlockUsing).toHaveBeenCalledTimes(2)
    const [, ttlMs, retryOptions] = redlockUsing.mock.calls[0]
    const [resources] = redlockUsing.mock.calls[0]
    expect(resources).toEqual(['lock:stellar:account-1'])
    expect(ttlMs).toBe(5000)
    expect(retryOptions).toEqual({ retryCount: 50 })
  })

  it('falls back to a minimum retry count of 1 when retryDelay is falsy', async () => {
    const manager = new RedisLockManager(secretManager, logger)
    redlockUsing.mockImplementation(async (_resources: string[], _ttl: number, opts: { retryCount: number }, fn: () => Promise<unknown>) => fn())
    ;(Redlock as unknown as jest.Mock).mockImplementation((clients: unknown[], options: unknown) => {
      redlockInstances.push({ clients, options })
      return {
        on: redlockOn,
        settings: { retryDelay: 0 },
        using: redlockUsing,
      }
    })

    await manager.withLock('idempotent', 10, async () => 'value')

    const [, , opts] = redlockUsing.mock.calls[0]
    expect(opts).toEqual({ retryCount: 10 })
  })
})

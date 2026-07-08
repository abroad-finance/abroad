import { Pool } from 'pg'

import { PostgresAdvisoryLockManager } from '../../../platform/cacheLock/postgresAdvisoryLockManager'
import { ISecretManager } from '../../../platform/secrets/ISecretManager'

// jest.mock is hoisted above the imports by ts-jest, so the class binds to this mock.
jest.mock('pg', () => {
  const query = jest.fn()
  const release = jest.fn()
  const client = { query, release }
  const connect = jest.fn(async () => client)
  const on = jest.fn()
  const PoolMock = jest.fn((config: unknown) => {
    ;(PoolMock as unknown as { lastConfig?: unknown }).lastConfig = config
    return { connect, on }
  })
  ;(PoolMock as unknown as { mocks: unknown }).mocks = { client, connect, on, query, release }
  return { Pool: PoolMock }
})

type PgMocks = {
  connect: jest.Mock
  on: jest.Mock
  query: jest.Mock
  release: jest.Mock
}
const pgMocks = (Pool as unknown as { mocks: PgMocks }).mocks
const getLastPoolConfig = () => (Pool as unknown as { lastConfig?: Record<string, unknown> }).lastConfig

function makeSecretManager(url = 'postgres://u:pw@10.0.0.1:5432/abroad?connection_limit=10&pool_timeout=20'): ISecretManager {
  return {
    getSecret: jest.fn(async () => url),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    getSecrets: jest.fn(async () => ({} as any)),
  }
}

const logger = { error: jest.fn(), info: jest.fn(), warn: jest.fn() }

let order: string[]

beforeEach(() => {
  jest.clearAllMocks()
  order = []
  pgMocks.query.mockImplementation(async (sql: string) => {
    order.push(sql)
    return { rows: [] }
  })
  pgMocks.connect.mockResolvedValue((Pool as unknown as { mocks: { client: unknown } }).mocks.client)
})

describe('PostgresAdvisoryLockManager', () => {
  it('acquires a session lock BEFORE fn, runs fn, then unlocks and releases the connection', async () => {
    const mgr = new PostgresAdvisoryLockManager(makeSecretManager(), logger)

    const result = await mgr.withLock('GSOURCE', 20_000, async () => {
      order.push('fn')
      return 'tx-hash'
    })

    expect(result).toBe('tx-hash')
    // SET lock_timeout, then acquire, then fn, then unlock — strictly ordered.
    expect(order).toEqual([
      expect.stringMatching(/SET lock_timeout = \d+/),
      expect.stringContaining('pg_advisory_lock'),
      'fn',
      expect.stringContaining('pg_advisory_unlock'),
    ])
    expect(pgMocks.release).toHaveBeenCalledWith() // clean release on success
  })

  it('does NOT wrap fn in a transaction (no BEGIN/COMMIT — no timeout cliff)', async () => {
    const mgr = new PostgresAdvisoryLockManager(makeSecretManager(), logger)
    await mgr.withLock('GSOURCE', 20_000, async () => 'ok')

    const sqls = pgMocks.query.mock.calls.map(c => String(c[0]).toUpperCase())
    expect(sqls.some(s => s.includes('BEGIN'))).toBe(false)
    expect(sqls.some(s => s.includes('COMMIT'))).toBe(false)
  })

  it('passes the namespaced key + fixed lock class as bound parameters', async () => {
    const mgr = new PostgresAdvisoryLockManager(makeSecretManager(), logger)
    await mgr.withLock('GSOURCE', 20_000, async () => 'ok')

    const acquire = pgMocks.query.mock.calls.find(c => String(c[0]).includes('pg_advisory_lock'))
    expect(acquire?.[0]).toContain('hashtext($2)')
    expect(acquire?.[1]).toEqual([expect.any(Number), 'stellar-lock:GSOURCE'])
  })

  it('bounds acquisition with lock_timeout derived from ttlMs', async () => {
    const mgr = new PostgresAdvisoryLockManager(makeSecretManager(), logger)
    await mgr.withLock('GSOURCE', 20_000, async () => 'ok')

    const setStmt = pgMocks.query.mock.calls.map(c => String(c[0])).find(s => /SET lock_timeout = \d+/.test(s))
    expect(setStmt).toBe('SET lock_timeout = 20000')
  })

  it('propagates fn errors AND still unlocks + releases the connection', async () => {
    const mgr = new PostgresAdvisoryLockManager(makeSecretManager(), logger)

    await expect(
      mgr.withLock('GSOURCE', 20_000, async () => {
        throw new Error('submit failed')
      }),
    ).rejects.toThrow('submit failed')

    expect(pgMocks.query.mock.calls.some(c => String(c[0]).includes('pg_advisory_unlock'))).toBe(true)
    expect(pgMocks.release).toHaveBeenCalled()
  })

  it('destroys the connection if unlock fails (never returns a locked connection to the pool)', async () => {
    const mgr = new PostgresAdvisoryLockManager(makeSecretManager(), logger)

    pgMocks.query.mockImplementation(async (sql: string) => {
      order.push(sql)
      if (sql.includes('pg_advisory_unlock')) throw new Error('connection reset')
      return { rows: [] }
    })

    await mgr.withLock('GSOURCE', 20_000, async () => 'ok')

    expect(pgMocks.release).toHaveBeenCalledWith(true) // destroy
    expect(logger.error).toHaveBeenCalled()
  })

  it('does NOT attempt unlock and releases cleanly if acquisition fails (e.g. lock_timeout)', async () => {
    const mgr = new PostgresAdvisoryLockManager(makeSecretManager(), logger)

    pgMocks.query.mockImplementation(async (sql: string) => {
      order.push(sql)
      if (sql.includes('pg_advisory_lock')) throw new Error('55P03 canceling statement due to lock timeout')
      return { rows: [] }
    })

    await expect(mgr.withLock('GSOURCE', 20_000, async () => 'ok')).rejects.toThrow(/lock timeout/)

    expect(pgMocks.query.mock.calls.some(c => String(c[0]).includes('pg_advisory_unlock'))).toBe(false)
    expect(pgMocks.release).toHaveBeenCalledWith() // clean release, not destroy
  })

  it('uses a dedicated, bounded pool and strips Prisma-only query params from the URL', async () => {
    const mgr = new PostgresAdvisoryLockManager(makeSecretManager(), logger)
    await mgr.withLock('GSOURCE', 20_000, async () => 'ok')

    const cfg = getLastPoolConfig()
    expect(cfg?.connectionString).toBe('postgres://u:pw@10.0.0.1:5432/abroad') // no ?connection_limit
    expect(typeof cfg?.max).toBe('number')
    expect(cfg?.max as number).toBeLessThanOrEqual(5) // small, isolated from Prisma
  })
})

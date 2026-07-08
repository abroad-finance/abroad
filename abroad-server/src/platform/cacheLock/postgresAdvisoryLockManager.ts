import { inject, injectable } from 'inversify'
import { Pool } from 'pg'

import { TYPES } from '../../app/container/types'
import { ILogger } from '../../core/logging/types'
import { ISecretManager } from '../secrets/ISecretManager'
import { ILockManager } from './ILockManager'

/**
 * Fixed 32-bit namespace ("class") for all of abroad's advisory locks, paired with
 * hashtext(key) as the 32-bit "object" id. Namespacing means our locks can never
 * collide with any other (current or future) pg_advisory_* user on this database.
 */
const ADVISORY_LOCK_CLASS = 1398032715 // 0x53544C4B — "STLK"
const DEFAULT_POOL_MAX = 3
const POOL_IDLE_TIMEOUT_MS = 30_000
const POOL_CONNECT_TIMEOUT_MS = 15_000

/**
 * Distributed lock backed by PostgreSQL SESSION-level advisory locks
 * (`pg_advisory_lock` / `pg_advisory_unlock`) on a SMALL, DEDICATED connection pool,
 * separate from the Prisma pool. Replaces the single-node Memorystore Redlock.
 *
 * Why session-level on a dedicated pool (this shape is correctness-critical — an
 * adversarial review rejected the earlier transaction-based version; do not revert):
 *  - Advisory locks are per-CONNECTION, so acquire and release run on the SAME
 *    checked-out client. The lock is held until we explicitly unlock (after `fn`
 *    resolves) or the connection dies — there is NO transaction and therefore NO
 *    statement/transaction-timeout "cliff" that could release the lock mid-Horizon-
 *    submit and let a concurrent withdrawal reuse the sequence number. `fn` may run
 *    as long as it needs while the lock is held (parity with Redlock's auto-extend).
 *  - A DEDICATED pool (isolated from Prisma) means blocked waiters can never consume
 *    Prisma connections, so a burst of same-account sends can't starve outbox / flow
 *    writes. The pool is tiny and lazily created; excess waiters fail fast + retriable.
 *  - A process crash closes the connection, which makes Postgres auto-release the
 *    session lock — a crash can never leak the lock.
 *  - `SET lock_timeout` bounds how long we block trying to ACQUIRE; on contention
 *    beyond that, pg raises 55P03 which the caller treats as retriable (Redlock parity).
 */
@injectable()
export class PostgresAdvisoryLockManager implements ILockManager {
  private pool?: Pool
  private poolPromise?: Promise<Pool>

  constructor(
    @inject(TYPES.ISecretManager) private readonly secretManager: ISecretManager,
    @inject(TYPES.ILogger) private readonly logger: ILogger,
  ) {}

  async withLock<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
    const pool = await this.getPool()
    const acquireTimeoutMs = Math.max(1_000, Math.floor(ttlMs))
    const namespacedKey = `stellar-lock:${key}`

    const client = await pool.connect()
    let acquired = false
    try {
      // Fail fast (retriable) if the lock can't be acquired within acquireTimeoutMs.
      await client.query(`SET lock_timeout = ${acquireTimeoutMs}`)
      // Blocking, cross-process, session-scoped lock. Held until we unlock below.
      await client.query('SELECT pg_advisory_lock($1::int, hashtext($2))', [ADVISORY_LOCK_CLASS, namespacedKey])
      acquired = true
      return await fn()
    }
    finally {
      if (acquired) {
        try {
          await client.query('SELECT pg_advisory_unlock($1::int, hashtext($2))', [ADVISORY_LOCK_CLASS, namespacedKey])
          client.release()
        }
        catch (unlockErr) {
          // Unlock failed (e.g. the connection died mid-fn). Destroy the connection so
          // Postgres auto-releases the session lock; never return it to the pool locked.
          this.logger.error(
            '[pg-lock] advisory unlock failed; destroying connection',
            unlockErr instanceof Error ? unlockErr : new Error(String(unlockErr)),
          )
          client.release(true)
        }
      }
      else {
        // Lock was never acquired (SET / acquire threw, e.g. lock_timeout). Connection is clean.
        client.release()
      }
    }
  }

  private async createPool(): Promise<Pool> {
    const url = await this.secretManager.getSecret('DATABASE_URL')
    // Drop Prisma-only query params (connection_limit / pool_timeout) that libpq/pg
    // does not understand; the dedicated pool sets its own sizing below.
    const connectionString = url.split('?')[0]

    const pool = new Pool({
      application_name: 'abroad-advisory-lock',
      connectionString,
      connectionTimeoutMillis: POOL_CONNECT_TIMEOUT_MS,
      idleTimeoutMillis: POOL_IDLE_TIMEOUT_MS,
      keepAlive: true,
      max: DEFAULT_POOL_MAX,
    })

    pool.on('error', (err) => {
      // Errors on idle clients in the pool are non-fatal; log and let pg recycle them.
      this.logger.error('[pg-lock] idle pool client error', err instanceof Error ? err : new Error(String(err)))
    })

    this.pool = pool
    return pool
  }

  private getPool(): Promise<Pool> {
    if (this.pool) {
      return Promise.resolve(this.pool)
    }
    if (!this.poolPromise) {
      this.poolPromise = this.createPool().catch((err) => {
        // Allow a later retry to re-create the pool if init failed.
        this.poolPromise = undefined
        throw err
      })
    }
    return this.poolPromise
  }
}

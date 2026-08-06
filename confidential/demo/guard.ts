/**
 * Refuses to run anywhere but a local demo database.
 *
 * These scripts create corridors, enable a confidential asset and delete flow
 * step definitions. Pointed at a real environment by an inherited DATABASE_URL
 * they would enable a payment path or destroy live payout configuration, so
 * every one of them calls this first — the same posture as `seed-dev.ts`.
 */
export function assertLocalDemoDatabase(): void {
  const url = process.env.DATABASE_URL
  if (!url) {
    throw new Error('DATABASE_URL is not set; refusing to guess at a database')
  }

  const host = (() => {
    try {
      return new URL(url).hostname
    }
    catch {
      return ''
    }
  })()

  const isLocal = host === 'localhost' || host === '127.0.0.1' || host === '::1'
  if (!isLocal) {
    throw new Error(`refusing to mutate a non-local database (host ${host || 'unparseable'})`)
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error('refusing to run with NODE_ENV=production')
  }
}

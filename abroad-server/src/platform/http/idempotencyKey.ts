import { createHash } from 'crypto'

/**
 * Transfero Ultra rejects an Idempotency-Key longer than 255 characters, so a
 * key built from an unbounded business identifier has to degrade to a digest.
 *
 * The identifier is the only segment that can grow without bound, so it is the
 * only segment hashed. Every other segment is a fixed vocabulary term and stays
 * literal, which keeps the key readable in provider dashboards and keeps the
 * suffix (for example an attempt phase) distinguishing retries even after the
 * identifier collapses to a digest.
 *
 * The produced string is part of the provider's duplicate-detection contract:
 * the same operation must always yield the same key, and two different
 * operations must never collide. Changing the separator, the prefix vocabulary,
 * the 255 threshold, or the digest algorithm silently changes which provider
 * calls are treated as replays. Do not "tidy" any of them.
 */
export function buildIdempotencyKey(
  prefixSegments: readonly string[],
  identifier: string,
  suffixSegments: readonly string[] = [],
): string {
  const join = (middle: string): string =>
    [...prefixSegments, middle, ...suffixSegments].join(':')

  const candidate = join(identifier)
  if (candidate.length <= MAX_IDEMPOTENCY_KEY_LENGTH) {
    return candidate
  }

  return join(createHash('sha256').update(identifier).digest('hex'))
}

const MAX_IDEMPOTENCY_KEY_LENGTH = 255

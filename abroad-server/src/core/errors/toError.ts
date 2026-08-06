/**
 * Narrows an unknown caught value to an Error.
 *
 * `catch` binds `unknown`, but the logger and Sentry both want a real Error so
 * a stack survives. Ten call sites had written the same ternary inline.
 *
 * Deliberately NOT a general error-to-message helper. Several adapters keep
 * their own `describeError`, and those differ on purpose: each returns a
 * provider-specific fallback string that ends up in a failure `reason` a caller
 * can branch on. Collapsing them would change those values.
 */
export function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value))
}

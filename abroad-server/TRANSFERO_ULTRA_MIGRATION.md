# Transfero Ultra cutover

This release is a direct cutover. It contains no legacy Transfero authentication,
endpoint, wallet, callback, or status fallback. Do not run old and new application
versions against the migrated flow definitions at the same time.

## Provisioning prerequisites

Create these Secret Manager values before deploying:

| Secret | Required value |
| --- | --- |
| `TRANSFERO_ULTRA_BASE_URL` | `https://ultra.transfero.tools` in production; use the staging host only in staging |
| `TRANSFERO_ULTRA_KEY_ID` | Ultra API key ID |
| `TRANSFERO_ULTRA_API_SECRET` | Raw API secret shown at key creation, not the derived signing key |
| `TRANSFERO_ULTRA_WEBHOOK_URL` | Exact public URL ending in `/webhook/transfero` |
| `TRANSFERO_ULTRA_WEBHOOK_SECRET` | Endpoint secret returned once when the Ultra webhook endpoint is created |

The application hashes `TRANSFERO_ULTRA_API_SECRET` exactly once when signing.
Saving Ultra's already-derived signing key in this secret would double-hash it
and make every request fail authentication.

Optional runtime tuning uses only Ultra-prefixed environment variables:
`TRANSFERO_ULTRA_REQUEST_TIMEOUT_MS` (default `8000`),
`TRANSFERO_ULTRA_MAX_SEND_ATTEMPTS` (default `3`), and
`TRANSFERO_ULTRA_RETRY_DELAY_MS` (default `250`), and
`TRANSFERO_ULTRA_RATE_LIMIT_COOLDOWN_MS` (default `60000`). Legacy
`TRANSFERO_*` retry variables are intentionally ignored.

The API key must authorize all runtime operations used by Abroad:

- balance reads;
- PIX BR-code preview and withdrawal creation;
- OTC price reads, D0 SELL session creation/confirmation, and settlement from holdings;
- Polygon vault-address reads;
- webhook endpoint reads for startup verification.

Apply the Ultra API-key and partner-account IP allowlists before cutover when
those controls are enabled.

## Webhook endpoint

Provision the endpoint through Ultra before deployment and persist the returned
secret immediately. Subscribe the endpoint to all six events:

- `pix.withdrawal.submitted`
- `pix.withdrawal.settled`
- `pix.withdrawal.returned`
- `pix.withdrawal.failed`
- `crypto.deposit.confirmed`
- `crypto.deposit.credit_failed`

Startup is verification-only because Ultra reveals the endpoint secret once.
It will log an error if the configured URL is missing, inactive, malformed, or
does not have exactly those six events. It never creates or rotates a webhook
endpoint.

## Direct production release sequence

1. Provision the production Ultra API key, webhook endpoint, exact
   subscriptions, and all five production Secret Manager values.
2. Confirm the production account exposes a mainnet Polygon USDC vault address
   and has the PIX limits, BRZ liquidity, OTC permissions, and stablecoin
   holdings required by the live corridors.
3. Stop admission of new Transfero-backed BRL flows.
4. Let every retained legacy payout and every `SOL` bridge batch or leg reach a
   terminal state. The migration aborts while any retained payout remains
   active; legacy snapshots older than the provider's 15-day retention window
   are retired internally without inventing a transaction outcome.
5. Push the validated `main` SHA and run the normal production backend trigger
   against that exact SHA. Cloud Build applies the migration atomically before
   starting the Ultra-only runtime.
6. Verify the production key, balances, OTC prices, Polygon vault address,
   webhook endpoint, Cloud Run revision, and GKE worker images.
7. Re-enable all migrated BRL corridors and confirm normal production webhook
   delivery and persisted flow state.

The migration rewrites future direct Transfero flow definitions to the
Binance-first route and moves future pooled bridge legs from Binance network
`SOL` to `MATIC` (Polygon). Historical terminal records remain unchanged.

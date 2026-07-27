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
`TRANSFERO_ULTRA_RETRY_DELAY_MS` (default `250`). Legacy `TRANSFERO_*` retry
variables are intentionally ignored.

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

## Cutover sequence

1. Provision and test the Ultra API key, Polygon vault addresses, webhook
   endpoint, subscriptions, and all five secrets in staging.
2. Ensure the Ultra account has the BRZ payout liquidity and stablecoin holdings
   required by the live corridors.
3. Stop admission of new Transfero-backed BRL flows.
4. Drain every non-terminal legacy Transfero flow and every `SOL` bridge batch
   or leg. The database migration aborts if any remain.
5. Take a database backup and deploy during a maintenance window. Cloud Build
   applies the guarded migration before starting the new application version.
6. Re-enable the BRL corridors only after startup reports that the Ultra webhook
   configuration is verified and a staging-equivalent smoke payout has
   completed.
7. Monitor PIX withdrawal failures, OTC partial-settlement failures, confirmed
   Polygon deposits, bridge batches, and webhook delivery attempts.

The migration rewrites future direct Transfero flow definitions to the
Binance-first route and moves future pooled bridge legs from Binance network
`SOL` to `MATIC` (Polygon). Historical terminal records remain unchanged.

## Rollback boundary

There is no in-process fallback to the legacy API. After the database migration,
rolling only the application image back is unsafe. A rollback requires stopping
traffic and restoring the pre-cutover database definitions and application
version together.

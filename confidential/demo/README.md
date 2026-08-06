# Local demo harness

Runs the confidential deposit path end to end on a laptop: Postgres and RabbitMQ
in podman, the Abroad workers against them, and a stubbed payout provider — with
the deposit itself a **real** transfer on Stellar testnet.

```bash
podman run -d --name abroad-pg -e POSTGRES_PASSWORD=postgres -e POSTGRES_USER=postgres \
  -e POSTGRES_DB=postgres -p 5432:5432 docker.io/library/postgres:16-alpine
podman run -d --name abroad-rabbit -p 5672:5672 -p 15672:15672 \
  docker.io/library/rabbitmq:3-management-alpine

cd abroad-server
npx prisma migrate deploy
npm run seed:dev                       # partners, quotes, crypto assets, providers

npx tsx ../confidential/demo/seed-corridor.ts   # USDC/STELLAR → BRL, SUPPORTED
npx tsx ../confidential/demo/seed-flow.ts       # clone the Solana→BRL flow onto Stellar
npx tsx ../confidential/demo/trim-flow.ts       # keep the customer-facing steps
npx tsx ../confidential/demo/seed-deposit.ts    # enable the asset, arm the transaction

npx tsx ../confidential/demo/transfero-mock.ts  # payout provider, port 4599
npx tsx src/app/workers/listeners/server.ts
npx tsx src/app/workers/consumers/server.ts
npx tsx src/app/workers/outbox/server.ts
```

`abroad-server/.env` needs `NODE_ENV=development` — that is what makes the secret
manager read from the environment instead of GCP — plus the database and queue
URLs, the three `STELLAR_CONFIDENTIAL_*` / `SOROBAN_RPC_URL` values, and
`TRANSFERO_ULTRA_BASE_URL=http://localhost:4599`.

Then send the deposit from `../client` and watch it land:

```bash
npx tsx ../confidential/demo/status.ts
```

## Notes

- **The workers exit on any secret they cannot resolve.** Every provider secret
  the workers touch needs a value in `.env`, even a stub, or an unhandled
  rejection from the GCP client takes the process down.
- **The flow is trimmed to `PAYOUT_SEND` and `AWAIT_PROVIDER_STATUS`.** Those are
  what carry a transaction to `PAYMENT_COMPLETED` with a PIX end-to-end id. The
  treasury steps that follow would need Binance and bridge mocks too.
- **The asset is labelled USDC** because `CryptoCurrency` has no XLM, while the
  testnet token wraps native XLM. Say so on camera, or issue a test USDC and
  redeploy the token and wrapper against its SAC — every script takes the
  addresses as environment variables.

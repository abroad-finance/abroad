---
sidebar_position: 3
---

# Integration Basics

The essentials you need before wiring Abroad into your stack.

## Base URL

| Environment | Base URL |
| :--- | :--- |
| Production | `https://api.abroad.finance` |

All endpoints live directly under the base URL (for example: `POST /quote`).

## Authentication & headers

- Partner auth: include `X-API-Key: <your key>` on every call.  
- Wallet/user auth (where required): `Authorization: Bearer <token>`.
- Always send JSON payloads: `Content-Type: application/json`.
- Endpoints may accept either scheme; sending both is safe.

See [Authentication](./authentication) for concrete examples.

## IDs, time, and memos

- `quote_id` is a UUID.  
- `transaction_reference` is the Base64 form of the transaction ID; use it verbatim as the memo/notes field when sending **Stellar** payments. It is also returned as `payment_context.memo`.  
- For **Solana** and **Celo** there is no memo; after broadcasting, POST the hash to `/payments/notify` (see [Send Funds](./workflows/send-funds)).  
- `expiration_time` is an epoch timestamp in milliseconds. Quotes are valid for **1 hour** from creation.

## Reading the deposit target

`POST /transaction` returns a `payment_context` object with the deposit address, exact amount, memo, token mint, decimals, chain ID, and whether a notify call is required. Read it per transaction rather than storing addresses in your configuration.

## Supported values (request enums)

| Field | Allowed values |
| :--- | :--- |
| `crypto_currency` | `USDC`, `USDT` |
| `network` | `STELLAR`, `SOLANA`, `CELO` |
| `payment_method` | `BREB`, `PIX` |
| `target_currency` | `COP`, `BRL` |

Not every combination of these is a live route. Call `GET /public/corridors` for the enabled matrix at any moment, or see [Supported Assets](./resources/supported-assets) for the current overview. A request for a route that is not configured returns `corridor_unavailable`.

:::note Removed fields
`bank_code` is no longer part of any request, and `GET /payments/banks` no longer exists. Rails are resolved server-side. Transaction responses return `kycRequired` (boolean) instead of the former `kycLink` URL.
:::

## Operational tips

- Quotes expire; if funds arrive after the `expiration_time`, you will see `PAYMENT_EXPIRED` when checking the transaction.  
- Start with small amounts while validating KYC flows, account details, and error handling.  
- Configure your webhook receiver and verify the `X-Abroad-Webhook-Secret` header before relying on callbacks.  
- Treat webhooks as at-least-once: store the latest `status` per transaction and make handlers idempotent.

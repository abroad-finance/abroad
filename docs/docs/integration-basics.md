---
sidebar_position: 3
---

# Integration Basics

The essentials you need before wiring Abroad into your stack.

## Base URLs

| Environment | Base URL |
| :--- | :--- |
| Production | `https://api.abroad.com` |
| Sandbox | `https://api-sandbox.abroad.com` |

All endpoints live directly under the base URL (for example: `POST /quote`).

## Authentication & headers

- Partner auth: include `X-API-Key: <your key>` on every call.  
- Wallet/user auth (where required): `Authorization: Bearer <token>`.
- Always send JSON payloads: `Content-Type: application/json`.
- Endpoints may accept either scheme; sending both is safe.

See [Authentication](./authentication) for concrete examples.

## IDs, time, and memos

- `quote_id` is a UUID.  
- `transaction_reference` is the Base64 form of the transaction ID; use it verbatim as the memo/notes field when sending crypto.  
- `expiration_time` is an epoch timestamp in milliseconds. Quotes are valid until that time (currently up to 1 hour).

## Supported values (request enums)

| Field | Allowed values |
| :--- | :--- |
| `crypto_currency` | `USDC` |
| `network` | `STELLAR`, `SOLANA` |
| `payment_method` | `NEQUI`, `MOVII`, `PIX` |
| `target_currency` | `COP`, `BRL` |

Check [Supported Assets](./resources/supported-assets) for the full matrix and payment method availability.

## Sandbox tips

- Quotes expire; if you do not send funds in time you will see `PAYMENT_EXPIRED` when checking the transaction.  
- Start with small amounts while testing KYC flows and error handling.  
- Configure your webhook receiver and verify the `X-Abroad-Webhook-Secret` header before relying on callbacks.

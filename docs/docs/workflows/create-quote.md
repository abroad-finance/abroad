---
sidebar_position: 2
---

# 1. Create a Quote

The first step in any transaction is to get a quote. This tells you exactly how much the recipient will get, or how much the sender needs to send.

## Endpoint

`POST /quote`

## Request

This endpoint expects a **target amount** in local currency. If you prefer to quote by crypto amount, use [Reverse Quote](../reference/api#reverse-quote-post-quotereverse).

### Example: delivering 400,000 COP

```json
{
  "amount": 400000,
  "crypto_currency": "USDC",
  "network": "STELLAR",
  "payment_method": "BREB",
  "target_currency": "COP"
}
```

### Parameters

| Parameter | Type | Description |
| :--- | :--- | :--- |
| `amount` | `number` | Target amount the recipient should receive (in `target_currency`). |
| `crypto_currency` | `string` | The source cryptocurrency (e.g., `USDC`). |
| `network` | `string` | The blockchain network (e.g., `STELLAR`, `SOLANA`, `CELO`). |
| `payment_method` | `string` | The payout method (e.g., `BREB`, `PIX`). |
| `target_currency` | `string` | The target fiat currency (e.g., `COP`, `BRL`). |

## Response

The response includes the `quote_id`, which you will need for the next step, the expiration time, and an exact fee snapshot in the source asset.

```json
{
  "expiration_time": 1893456000000,
  "fee": {
    "amount": "0.5",
    "currency": "USDC",
    "type": "combined"
  },
  "quote_id": "uuid-string",
  "value": 100.5
}
```

- `value` is the total crypto amount you need to send before `expiration_time` (Unix epoch milliseconds).
- `fee.amount` is the fee portion already included in that quoted source amount. Do not add it to `value` again.
- `fee.currency` identifies the source asset, and `fee.type` is `none`, `percentage`, `fixed`, or `combined`.

The fee object is additive response metadata. Quote request fields and the transaction-acceptance request remain unchanged, including optional `tax_id` behavior.

:::warning Expiration
Quotes are valid until `expiration_time` (currently up to 1 hour). You must accept the transaction and fund it before the quote expires.
:::

## Troubleshooting

### Quote Expired?
If you receive a `400 Bad Request` when trying to accept a transaction, check if the `expiration_time` has passed. You will need to request a new quote.

### Invalid Currency Pair?
Ensure that the `target_currency` is supported for the selected `payment_method`. See [Supported Assets](../resources/supported-assets).

### Actionable quote errors

Quote failures return a bounded error body instead of provider details:

```json
{
  "code": "minimum",
  "reason": "The minimum allowed amount for BRL is 1 BRL",
  "retryable": false
}
```

`code` is one of `authentication_failed`, `invalid_request`, `corridor_unavailable`, `minimum`, `maximum`, `quote_unavailable`, or `server_error`. Retry only when `retryable` is `true`; otherwise correct the request or choose a supported route first.

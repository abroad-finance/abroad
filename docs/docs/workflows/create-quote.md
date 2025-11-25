---
sidebar_position: 2
---

# 1. Create a Quote

The first step in any transaction is to get a quote. This tells you exactly how much the recipient will get, or how much the sender needs to send.

## Endpoint

`POST /quote`

## Request

You can request a quote by specifying the **source amount** (how much you want to send) or the **target amount** (how much you want the recipient to receive).

### Example: sending 100 USDC

```json
{
  "amount": 100,
  "crypto_currency": "USDC",
  "network": "STELLAR",
  "payment_method": "NEQUI",
  "target_currency": "COP"
}
```

### Parameters

| Parameter | Type | Description |
| :--- | :--- | :--- |
| `amount` | `number` | The amount of crypto to convert. |
| `crypto_currency` | `string` | The source cryptocurrency (e.g., `USDC`). |
| `network` | `string` | The blockchain network (e.g., `STELLAR`, `SOLANA`). |
| `payment_method` | `string` | The payout method (e.g., `NEQUI`, `MOVII`, `PIX`). |
| `target_currency` | `string` | The target fiat currency (e.g., `COP`, `BRL`). |

## Response

The response includes the `quote_id`, which you will need for the next step, and the expiration time.

```json
{
  "expiration_time": 1732520000,
  "quote_id": "uuid-string",
  "source_amount": 100,
  "target_amount": 400000,
  "exchange_rate": 4000
}
```

> **Note**: Quotes are valid for a limited time (typically 5-15 minutes). You must accept the transaction before the quote expires.

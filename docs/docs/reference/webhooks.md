---
sidebar_position: 2
---

# Webhooks

Abroad sends webhooks to notify your application about transaction status changes.

## Event Structure

```json
{
  "event": "TRANSACTION_CREATED",
  "data": {
    "id": "transaction-uuid",
    "status": "AWAITING_PAYMENT",
    "quoteId": "quote-uuid",
    ...
  }
}
```

## Events

| Event Name | Description |
| :--- | :--- |
| `TRANSACTION_CREATED` | A new transaction has been created. |
| `TRANSACTION_UPDATED` | The status of a transaction has changed (e.g., to `PAYMENT_COMPLETED`). |

## Security

Webhooks are signed with a secret key. You should verify the signature to ensure the request came from Abroad.

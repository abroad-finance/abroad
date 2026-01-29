---
sidebar_position: 2
---

# Webhooks

Abroad sends JSON webhooks to notify your application about transaction lifecycle changes.

## Events

| Event name | When it is sent | Notes |
| :--- | :--- | :--- |
| `transaction.created` | A transaction was accepted and is waiting for funds, or the system detected an on-chain payment (including wrong-amount cases). | May fire multiple times for the same `id` as the transaction progresses. |
| `transaction.updated` | The transaction status changed (processing, completed, failed, or expired). | Used for payout and expiry updates. |

## Payload structure

```json
{
  "event": "transaction.updated",
  "data": {
    "id": "f4a96c4c-4d1e-4ab2-a6ec-2e1b5070c5db",
    "status": "PROCESSING_PAYMENT",
    "quoteId": "550e8400-e29b-41d4-a716-446655440000",
    "accountNumber": "3001234567",
    "bankCode": "9101",
    "onChainId": "2bebb7...",
    "refundOnChainId": null,
    "taxId": "123456789",
    "externalId": null,
    "partnerUserId": "10d9f483-d048-4e55-a75b-e7ebd475d737"
  }
}
```

`data` mirrors the transaction record and may include nested quote fields on some events. To derive the memo for reconciliation, compute `transaction_reference` from `id` (Base64) or call `GET /transaction/{id}`.
For Stellar and Celo payments, `onChainId` is the transaction hash. For Solana payments, it is the transaction signature.

## Authenticating webhooks

When configured, Abroad sends an `X-Abroad-Webhook-Secret` header. Verify it against your expected value before processing the payload.

```javascript
app.post('/webhooks/abroad', express.json(), (req, res) => {
  const secret = process.env.ABROAD_WEBHOOK_SECRET;
  if (req.header('X-Abroad-Webhook-Secret') !== secret) {
    return res.status(401).send('Invalid signature');
  }

  const { event, data } = req.body;
  // TODO: handle event + data

  res.sendStatus(200); // Acknowledge quickly
});
```

## Handling & retries

- Respond with `2xx` as soon as you validate the signature; do downstream work asynchronously if possible.  
- If your receiver is down, senders currently do not automatically retry. Use `GET /transaction/{id}` and `GET /transactions/list` as a fallback to catch up on missed events.  
- Store the latest `status` per transaction and ignore duplicates; events may be sent more than once.

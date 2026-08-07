---
sidebar_position: 2
---

# Webhooks

Abroad sends JSON webhooks to notify your application about transaction lifecycle changes.

## Events

| Event name | When it is sent | Notes |
| :--- | :--- | :--- |
| `transaction.created` | A transaction was accepted and is waiting for funds, or the system detected an on-chain payment (including wrong-amount cases). | May fire multiple times for the same `id` as the transaction progresses. |
| `transaction.updated` | The transaction status changed (processing, completed, failed, or expired), **or** a refund for it completed. | Used for payout, expiry, and refund updates. |

## Refunds

A refund does not have its own event or its own status — it arrives as a second `transaction.updated`.

When a transaction fails, expires, or is paid in the wrong amount, you first get a `transaction.updated` carrying that status. Abroad then returns the funds, and once the return settles you get **another** `transaction.updated` for the same `id`. The status is unchanged between the two; what changes is `refundOnChainId`, which is `null` in the first and carries the refund's identifier in the second:

- crypto sent back to its sender — the refund's on-chain transaction hash or signature;
- a fiat deposit returned to its payer (onramp) — the provider's refund id.

So treat a non-null `refundOnChainId` as "the money is back", not the status field. Handlers must already be idempotent for repeated events on one `id` — this is one of those repeats.

## Payload structure

```json
{
  "event": "transaction.updated",
  "data": {
    "id": "f4a96c4c-4d1e-4ab2-a6ec-2e1b5070c5db",
    "status": "PROCESSING_PAYMENT",
    "quoteId": "550e8400-e29b-41d4-a716-446655440000",
    "accountNumber": "3001234567",
    "onChainId": "2bebb7...",
    "refundOnChainId": null,
    "taxId": "123456789",
    "externalId": null,
    "partnerUserId": "10d9f483-d048-4e55-a75b-e7ebd475d737"
  }
}
```

`data` mirrors the transaction record and may include nested quote fields on some events. Internal routing fields are stripped from every payload: `bankCode` and `origin` are never sent.

To derive the memo for reconciliation, compute `transaction_reference` from `id` (Base64) or call `GET /transaction/{id}`.
For Stellar and Celo payments, `onChainId` is the transaction hash. For Solana payments, it is the transaction signature.

## Configuring the destination

Administrators manage the webhook destination and its signing secret from **Integration** in the partner portal. The flow is staged rather than immediate:

1. **Stage** a draft URL.
2. **Test** the draft — Abroad sends a test delivery so you can confirm your receiver accepts it before it takes live traffic.
3. **Activate** the draft to promote it to the live destination, or discard it.

You can rotate the signing secret independently of the URL. Both the secret and the URL change take effect without redeploying anything on the Abroad side.

## Authenticating webhooks

Abroad sends an `X-Abroad-Webhook-Secret` header. Verify it against your expected value before processing the payload.

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

Deliveries go through a durable outbox, so a failed delivery is retried automatically:

- Up to **5 attempts** per event.
- Exponential backoff between attempts (roughly 2s, 4s, 8s, 16s…), capped at **60 seconds**.
- Only retryable failures are re-attempted. A rejected target or an unavailable signing credential fails immediately.

Practical guidance:

- Respond with `2xx` as soon as you validate the secret; do downstream work asynchronously.  
- Make handlers **idempotent** — retries and lifecycle transitions mean the same `id` can arrive more than once. Store the latest `status` per transaction and ignore stale or duplicate events.  
- Abroad follows no redirects and caps the response body it will read, so answer directly with a small `2xx` body.  
- If your receiver was down past the retry budget, reconcile with `GET /transaction/{id}` and `GET /transactions/list`.

## Delivery diagnostics

Delivery health — attempt counts, HTTP status, and duration per event — is visible in the partner portal, and an administrator can redeliver a failed event from there. A connected AI assistant with the `webhooks:read` permission can read aggregate delivery health (never payloads, URLs, or secrets); see [Connect Abroad to AI](../ai-integration).

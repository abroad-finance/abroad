---
sidebar_position: 4
---

# 3. Send Funds

The final step for you (or your user) is to send the crypto funds to Abroad's deposit address.

## Where to send: `payment_context`

`POST /transaction` returns a `payment_context` object with everything the transfer needs. Read the deposit target from it on every transaction — addresses differ per chain and can be rotated, so a hard-coded address will eventually send funds nowhere.

```json
{
  "amount": 100.5,
  "blockchain": "SOLANA",
  "chainFamily": "solana",
  "chainId": "solana:mainnet",
  "cryptoCurrency": "USDC",
  "decimals": 6,
  "depositAddress": "7x...",
  "memo": null,
  "memoType": null,
  "mintAddress": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  "notify": { "endpoint": "/payments/notify", "required": true },
  "rpcUrl": "https://api.mainnet-beta.solana.com"
}
```

Send exactly `amount` of `cryptoCurrency` to `depositAddress`. On Solana and Celo, transfer the token at `mintAddress` using `decimals` for the smallest-unit conversion.

## How to tell us about the payment

### Stellar: use the memo

Include `payment_context.memo` — identical to `transaction_reference` — as the transaction memo. `memoType` is `text`.

:::danger Critical: Missing Memo
If you send Stellar funds without the correct memo/reference, our system **cannot** automatically match the deposit to your transaction. This will result in delays or potential loss of funds.
:::

Stellar deposits are picked up automatically; there is nothing to notify.

### Solana and Celo: notify us

There is no memo. `payment_context.notify.required` is `true`, so after broadcasting call the notify endpoint with the chain and hash:

```bash
curl -X POST https://api.abroad.finance/payments/notify \
  -H "X-API-Key: YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "blockchain": "SOLANA",
    "transaction_id": "TRANSACTION_ID_FROM_ACCEPT",
    "on_chain_tx": "SOLANA_TRANSACTION_SIGNATURE"
  }'
```

Set `blockchain` to `CELO` and pass the transaction hash for Celo. A successful call returns `202` with `{ "enqueued": true }`. A `404` means we could not find that transfer on-chain yet — retry after the transaction confirms.

:::note Per-chain endpoints
`POST /solana/payments/notify` and `POST /celo/payments/notify` still work and omit the `blockchain` field. Prefer `/payments/notify` for new integrations.
:::

## Track status

Monitor the transaction until the local payout completes:

```bash
curl -X GET https://api.abroad.finance/transaction/{transactionId} \
  -H "X-API-Key: YOUR_API_KEY"
```

Statuses and recommended actions are listed in [Status lifecycle](./status-lifecycle).

Status flow:
1.  `AWAITING_PAYMENT`: Waiting for the on-chain deposit.
2.  `PROCESSING_PAYMENT`: Deposit received, processing payout.
3.  `PAYMENT_COMPLETED`: Fiat funds sent to user.
4.  `PAYMENT_FAILED`: Something went wrong (e.g., invalid account number).
5.  `WRONG_AMOUNT`: Deposit did not match the quoted source amount; refund attempted.
6.  `PAYMENT_EXPIRED`: Quote expired before the deposit was matched.

## When things go wrong

- **Quote expired:** You will see `PAYMENT_EXPIRED` if funds arrive after the `expiration_time`. Create a fresh quote and transaction.  
- **Wrong amount:** If fewer funds arrive than quoted, the transaction moves to `WRONG_AMOUNT` and we attempt to refund the crypto to the sender address. Create a new quote/transaction for the corrected amount.  
- **Missing memo:** If the Stellar memo/reference is missing or incorrect, the funds cannot be matched automatically. Contact support with the on-chain hash to reconcile.
- **OPS recovery:** Operations can trigger hash-based reconciliation via `POST /ops/transactions/reconcile-hash` using `X-OPS-API-KEY`.

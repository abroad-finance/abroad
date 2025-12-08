---
sidebar_position: 4
---

# 3. Send Funds

The final step for you (or your user) is to send the crypto funds to Abroad's wallet address.

## How to tell us about the payment

When sending funds on Stellar you **must** include the `transaction_reference` from the previous step as the memo.

:::danger Critical: Missing Memo
If you send Stellar funds without the correct memo/reference, our system **cannot** automatically match the deposit to your transaction. This will result in delays or potential loss of funds.
:::

For Solana there is no memo. After broadcasting the transaction, call the Solana payment notification endpoint so we can confirm it on-chain and start the payout:

```bash
curl -X POST https://api.abroad.finance/solana/payments/notify \
  -H "X-API-Key: YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "transaction_id": "TRANSACTION_ID_FROM_ACCEPT",
    "on_chain_tx": "SOLANA_TRANSACTION_SIGNATURE"
  }'
```

## Deposit Addresses

| Network | Asset | Address |
| :--- | :--- | :--- |
| **Stellar** | USDC | `G... (Your Stellar Deposit Address)` |
| **Solana** | USDC | `... (Your Solana Deposit Address)` |

*Note: Please contact support or check your dashboard for the current production deposit addresses.*

## Track status

Monitor the transaction until the local payout completes:

```bash
curl -X GET https://api.abroad.finance/transaction/{transactionId} \
  -H "X-API-Key: YOUR_API_KEY"
```

Statuses and recommended actions are listed in [Status lifecycle](./status-lifecycle).

Status flow:
1.  `AWAITING_PAYMENT`: Waiting for on-chain deposit (or KYC completion if `kycLink` was returned).
2.  `PROCESSING_PAYMENT`: Deposit received, processing payout.
3.  `PAYMENT_COMPLETED`: Fiat funds sent to user.
4.  `PAYMENT_FAILED`: Something went wrong (e.g., invalid account number).
5.  `WRONG_AMOUNT`: Deposit did not match the quoted source amount; refund attempted.
6.  `PAYMENT_EXPIRED`: Quote expired before the deposit was matched.

## When things go wrong

- **Quote expired:** You will see `PAYMENT_EXPIRED` if funds arrive after the `expiration_time`. Create a fresh quote and transaction.  
- **Wrong amount:** If fewer funds arrive than quoted, the transaction moves to `WRONG_AMOUNT` and we attempt to refund the crypto to the sender address. Create a new quote/transaction for the corrected amount.  
- **Missing memo:** If the Stellar memo/reference is missing or incorrect, the funds cannot be matched automatically. Contact support with the on-chain hash to reconcile.

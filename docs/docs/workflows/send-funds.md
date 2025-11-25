---
sidebar_position: 4
---

# 3. Send Funds

The final step for you (or your user) is to send the crypto funds to Abroad's wallet address.

## The Importance of the Memo

When sending funds on networks like Stellar or Solana (if using a centralized deposit address), you **MUST** include the `transaction_reference` from the previous step as the **Memo** (Stellar) or **Note**.

:::danger Critical: Missing Memo
If you send funds without the correct Memo/Reference, our system **cannot** automatically match the deposit to your transaction. This will result in delays or potential loss of funds.
:::

## Deposit Addresses

| Network | Asset | Address |
| :--- | :--- | :--- |
| **Stellar** | USDC | `G... (Your Stellar Deposit Address)` |
| **Solana** | USDC | `... (Your Solana Deposit Address)` |

*Note: Please contact support or check your dashboard for the current production deposit addresses.*

## Track status

Monitor the transaction until the local payout completes:

```bash
curl -X GET https://api-sandbox.abroad.com/transaction/{transactionId} \
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
- **Missing memo:** If the memo/reference is missing or incorrect, the funds cannot be matched automatically. Contact support with the on-chain hash to reconcile.

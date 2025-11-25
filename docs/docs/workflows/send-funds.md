---
sidebar_position: 4
---

# 3. Send Funds

The final step for you (or your user) is to send the crypto funds to Abroad's wallet address.

## The Importance of the Memo

When sending funds on networks like Stellar or Solana (if using a centralized deposit address), you **MUST** include the `transaction_reference` from the previous step as the **Memo** (Stellar) or **Note**.

> **WARNING**: If you send funds without the correct Memo/Reference, our system cannot automatically match the deposit to your transaction. This will result in delays or potential loss of funds.

## Deposit Addresses

| Network | Asset | Address |
| :--- | :--- | :--- |
| **Stellar** | USDC | `G... (Your Stellar Deposit Address)` |
| **Solana** | USDC | `... (Your Solana Deposit Address)` |

*Note: Please contact support or check your dashboard for the current production deposit addresses.*

## Monitoring Status

After sending the funds, you can poll the transaction status or listen for webhooks.

`GET /transaction/{transactionId}`

Status flow:
1.  `AWAITING_PAYMENT`: Waiting for on-chain deposit.
2.  `PROCESSING_PAYMENT`: Deposit received, processing payout.
3.  `PAYMENT_COMPLETED`: Fiat funds sent to user.
4.  `PAYMENT_FAILED`: Something went wrong (e.g., invalid account number).

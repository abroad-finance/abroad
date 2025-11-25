---
sidebar_position: 5
---

# Status lifecycle

Use this table to interpret `status` values from `GET /transaction/{id}` or webhook payloads.

| Status | When it happens | Your action | Webhook event |
| :--- | :--- | :--- | :--- |
| `AWAITING_PAYMENT` | The transaction was accepted and is waiting for the on-chain deposit that includes the `transaction_reference` memo. | Send the quoted crypto amount before the `expiration_time`. | `transaction.created` |
| `PROCESSING_PAYMENT` | Abroad detected the on-chain transfer and is preparing or sending the local payout. | No action; continue polling or wait for the next webhook. | `transaction.updated` |
| `PAYMENT_COMPLETED` | Local payout succeeded. | Mark the transfer as settled in your system. | `transaction.updated` |
| `PAYMENT_FAILED` | Payout failed (e.g., invalid account, provider error). | Show the error to the user, correct the account, then create a new transaction. | `transaction.updated` |
| `PAYMENT_EXPIRED` | The quote expired before funds arrived. | Create a fresh quote and transaction, then resend funds. | `transaction.updated` (after expiry job) |
| `WRONG_AMOUNT` | Funds arrived but were below the quoted amount; we attempt an on-chain refund. | Inform the sender and create a new quote/transaction with the correct amount. | `transaction.created` |

If `kycLink` is present in the transaction payload, the user must complete KYC before the payout continues.

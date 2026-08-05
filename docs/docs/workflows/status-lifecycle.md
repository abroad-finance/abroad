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

These six values are the complete set; a transaction is always in exactly one of them.

If `kycRequired` is `true` on the acceptance response, no transaction was created and there is no status to track yet — the user must complete [KYC](../reference/api#submit-kyc-post-kyc) first, after which you retry with a fresh quote.

## Reading these on an onramp

The same statuses describe a [PIX onramp](./buy-crypto), with the legs swapped:

| Status | On an onramp it means |
| :--- | :--- |
| `AWAITING_PAYMENT` | The BR Code has been issued and is waiting for your user's PIX. |
| `PROCESSING_PAYMENT` | The PIX settled and Abroad is delivering the crypto. |
| `PAYMENT_COMPLETED` | The crypto reached the destination wallet; `on_chain_tx_hash` is the delivery. |
| `PAYMENT_FAILED` | The delivery could not be made; the BRL is returned to the payer. |
| `PAYMENT_EXPIRED` | The BR Code expired before it was paid. |

`WRONG_AMOUNT` does not occur on an onramp: the BR Code encodes an exact amount.

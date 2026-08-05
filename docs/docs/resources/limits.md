---
sidebar_position: 2
---

# Limits and validation

Abroad enforces payment-method limits and compliance checks during quote creation and transaction acceptance. When a rule is violated, the API responds with `400` and a `reason` string.

## Quote validity

- Quotes include `expiration_time` (epoch ms) and are currently valid for up to **1 hour**.  
- Expired quotes cause transactions to move to `PAYMENT_EXPIRED`. Create a new quote if you receive that status.

## Payment method caps (defaults)

| Payment method | Max per transaction | Max per user per day | Max per payment method per day | Max transactions per user per day |
| :--- | :--- | :--- | :--- | :--- |
| `BREB` | 5,000,000 COP | 25,000,000 COP | 25,000,000 COP | 15 |
| `PIX` | No internal cap | No internal cap | No internal cap | No internal cap |

> These values are enforced server-side via `MAX_*` constraints per payment service. Providers may still reject or delay payouts if their own limits are lower.

## Additional validation

- **Available liquidity:** If liquidity for a payment method is lower than the quoted target amount, the request is rejected with `reason: "We cannot process this payout because liquidity for this method is below the requested amount. Try a smaller amount or choose another payment method."`.  
- **Recipient account checks:** An invalid account number (and bank code, if supplied) returns `400` with `reason: "We could not verify the account number and bank code provided. Please double-check the details and try again."`.  
- **Payment rail availability:** If a payment rail is temporarily unavailable, the API responds with `reason: "Payments via <METHOD> are temporarily unavailable. Please try another method or retry shortly."`.  
- **Daily caps:** When per-user or payment-method daily limits are exceeded, responses use phrases such as `reason: "This payment method already reached today's payout limit. Please try again tomorrow or use another method."` or `reason: "You reached the maximum number of transactions allowed today. Please try again tomorrow."`.  
- **Partner KYB cap:** Partners without KYB approval are limited to a cumulative **100 units of source currency** across completed transactions. Exceeding that threshold returns `reason: "This partner is limited to a total of $100 until KYB is approved. Please complete KYB to raise the limit."`  
- **Disabled users:** A user disabled by Abroad operations returns `403` with code `user_disabled`. Retrying will not clear it.

## KYC gating

KYC enforcement is configured per partner and can be toggled by Abroad operations. When it is enabled for your partner:

- A user can move up to **$25 of source volume in the current calendar month** without verifying. The threshold is measured in the source asset, which maps 1:1 to USD.
- Above that, `POST /transaction` returns `kycRequired: true` and **creates no transaction** — `id`, `transaction_reference`, and `payment_context` are all `null`.
- Submit the user's identity details and document to [`POST /kyc`](../reference/api#submit-kyc-post-kyc). A complete submission is **approved immediately**; there is no manual review queue and no redirect to an external verification provider.
- Check [`GET /kyc/status`](../reference/api#get-kyc-status-get-kycstatus) before presenting the form, and retry acceptance with a **fresh quote** once the status is `APPROVED`.

:::note Replaces `kycLink`
Earlier versions returned a `kycLink` URL pointing at a hosted third-party verification flow. That field no longer exists — the boolean `kycRequired` plus the self-service `POST /kyc` form replace it entirely.
:::

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
| `NEQUI` | 500,000 COP | 10,000,000 COP | 10,000,000 COP | 15 |
| `MOVII` | 5,000,000 COP | 25,000,000 COP | 25,000,000 COP | 15 |
| `BREB` | 5,000,000 COP | 25,000,000 COP | 25,000,000 COP | 15 |
| `PIX` | No internal cap | No internal cap | No internal cap | No internal cap |

> These values are enforced server-side via `MAX_*` constraints per payment service. Providers may still reject or delay payouts if their own limits are lower.

## Additional validation

- **Available liquidity:** If liquidity for a payment method is lower than the quoted target amount, the request is rejected with `reason: "We cannot process this payout because liquidity for this method is below the requested amount. Try a smaller amount or choose another payment method."`.  
- **Recipient account checks:** An invalid account number/bank code pair returns `400` with `reason: "We could not verify the account number and bank code provided. Please double-check the details and try again."`. MOVII payments also require a bank code; missing it yields a friendly prompt to include the code.  
- **Payment rail availability:** If a payment rail is temporarily unavailable, the API responds with `reason: "Payments via <METHOD> are temporarily unavailable. Please try another method or retry shortly."`.  
- **Daily caps:** When per-user or payment-method daily limits are exceeded, responses use phrases such as `reason: "This payment method already reached today's payout limit. Please try again tomorrow or use another method."` or `reason: "You reached the maximum number of transactions allowed today. Please try again tomorrow."`.  
- **Partner KYB cap:** Partners without KYB approval are limited to a cumulative **100 units of source currency** across completed transactions. Exceeding that threshold returns `reason: "This partner is limited to a total of $100 until KYB is approved. Please complete KYB to raise the limit."`  
- **KYC gating:** If `needsKyc` is enabled for your partner, users can move up to **$25 in source volume (rolling 30 days)** without KYC. Once above that threshold, a `kycLink` is returned and the transaction will not progress until the user completes that flow.

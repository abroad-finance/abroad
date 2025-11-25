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
| `PIX` | No internal cap | No internal cap | No internal cap | No internal cap |

> These values are enforced server-side via `MAX_*` constraints per payment service. Providers may still reject or delay payouts if their own limits are lower.

## Additional validation

- **Available liquidity:** If liquidity for a payment method is lower than the quoted target amount, the request is rejected.  
- **Recipient account checks:** An invalid account number/bank code pair returns `400` with `"User account is invalid."`.  
- **Partner KYB cap:** Partners without KYB approval are limited to a cumulative **100 units of source currency** across completed transactions.  
- **KYC gating:** If `needsKyc` is enabled for your partner, large or frequent payouts can return a `kycLink`. The transaction will not progress until the user completes that flow.

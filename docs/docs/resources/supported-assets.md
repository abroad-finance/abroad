---
sidebar_position: 1
---

# Supported Assets

Abroad supports a specific set of blockchains, cryptocurrencies, and fiat currencies.

:::tip Check coverage programmatically
Routes are configured per corridor and change without a documentation release. `GET /public/corridors` is the authoritative, unauthenticated list of what is enabled right now — including per-corridor `minAmount`/`maxAmount` and whether a notify call is required. Use it instead of hard-coding the tables below. A request for a route that is not enabled returns `corridor_unavailable`.
:::

## Cryptocurrencies

| Asset | Symbol | Networks | Notes |
| :--- | :--- | :--- | :--- |
| USD Coin | **USDC** | Stellar, Solana, Celo | Primary asset used for quotes. |
| Tether | **USDT** | Celo | Supported. USDT routes convert to USDC internally before settlement; this is invisible to you. |

An asset/network pair is quotable only when it has an active token mint configured, which `GET /public/corridors` reflects.

## Fiat Currencies

| Country | Currency | Symbol | Payment Methods |
| :--- | :--- | :--- | :--- |
| Colombia | Colombian Peso | **COP** | BreB |
| Brazil | Brazilian Real | **BRL** | PIX |

## Payment methods at a glance

| Method | Payout currency | Recipient location | Recipient identifier |
| :--- | :--- | :--- | :--- |
| `BREB` | COP | Colombia | `account_number` (BreB key) |
| `PIX` | BRL | Brazil | `account_number` (PIX key) or `qr_code` |

The `network` you send in the quote defines which crypto rail you will fund on-chain. The payout is still in the local currency for the selected `payment_method`.

`NEQUI` and `MOVII` appear in historical records only; they are not accepted in new requests.

## Direction

| Direction | Currencies | Networks |
| :--- | :--- | :--- |
| Crypto to fiat (payout) | USDC to COP via `BREB`, USDC to BRL via `PIX` | Stellar, Solana, Celo |
| Fiat to crypto (onramp) | BRL via `PIX` to USDC | Stellar, Solana, Celo |

Onramp is Brazil-only today. See [Buy crypto with PIX](../workflows/buy-crypto).

## Coming soon

### Countries and currencies

- Argentina (ARS)
- Peru (PEN)
- Philippines (PHP)
- Thailand (THB)
- Vietnam (VND)

### Payment methods

- Transferencias 3.0 in Argentina
- Yape in Peru
- PromptPay in Thailand
- PHQR in Philippines
- VietQR in Vietnam

## Limits

Per-corridor minimums and maximums are configured per route and returned by `GET /public/corridors` as `minAmount` and `maxAmount`, expressed in the corridor's `targetCurrency`. A `null` value means no bound is configured for that route.

Breaching a bound at quote time returns a structured error:

```json
{
  "code": "minimum",
  "reason": "The minimum allowed amount for BRL is 1 BRL",
  "retryable": false
}
```

Separate from corridor bounds, each payment method enforces per-transaction and per-day caps, and partners without KYB approval have a cumulative cap. See [Limits and validation](./limits) for those and for KYC gating.

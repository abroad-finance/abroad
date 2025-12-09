---
sidebar_position: 1
---

import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

# API Reference

Base URL: `https://api.abroad.finance`. Add `X-API-Key` to every call. See [Integration basics](../integration-basics) for headers and enums.

For a live, grouped view of every endpoint, open the Swagger UI at `https://api.abroad.finance/docs`.

## Quotes

### Create Quote (`POST /quote`)

Calculate the crypto amount you need to send to deliver a target fiat amount.

#### Request body

| Field | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `amount` | `number` | Yes | Target amount in the fiat currency you want the recipient to receive. |
| `crypto_currency` | `string` | Yes | Source cryptocurrency (`USDC`). |
| `network` | `string` | Yes | Blockchain network (`STELLAR` or `SOLANA`). |
| `payment_method` | `string` | Yes | Payout method (`NEQUI`, `MOVII`, `BREB`, `PIX`). |
| `target_currency` | `string` | Yes | Target fiat currency (`COP` or `BRL`). |

#### Example

<Tabs>
<TabItem value="curl" label="cURL">

```bash
curl -X POST https://api.abroad.finance/quote \
  -H "X-API-Key: YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "amount": 400000,
    "crypto_currency": "USDC",
    "network": "STELLAR",
    "payment_method": "NEQUI",
    "target_currency": "COP"
  }'
```

</TabItem>
<TabItem value="js" label="JavaScript">

```javascript
const response = await fetch('https://api.abroad.finance/quote', {
  method: 'POST',
  headers: {
    'X-API-Key': 'YOUR_API_KEY',
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    amount: 400000,
    crypto_currency: 'USDC',
    network: 'STELLAR',
    payment_method: 'NEQUI',
    target_currency: 'COP'
  })
});
const data = await response.json();
```

</TabItem>
</Tabs>

#### Response

```json
{
  "expiration_time": 1732520000,
  "quote_id": "550e8400-e29b-41d4-a716-446655440000",
  "value": 100.5
}
```

`value` is the crypto amount (USDC) you must send before the quote expires.

---

### Reverse Quote (`POST /quote/reverse`)

Calculate how much the recipient will receive for a specific crypto amount.

#### Request body

| Field | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `source_amount` | `number` | Yes | Crypto amount you plan to send (for example, `100` USDC). |
| `crypto_currency` | `string` | Yes | Source cryptocurrency. |
| `network` | `string` | Yes | Blockchain network. |
| `payment_method` | `string` | Yes | Payout method. |
| `target_currency` | `string` | Yes | Target fiat currency. |

#### Response

```json
{
  "expiration_time": 1732520000,
  "quote_id": "550e8400-e29b-41d4-a716-446655440000",
  "value": 398500
}
```

`value` is the estimated fiat amount (e.g., COP) after fees.

---

## Transactions

### Accept Transaction (`POST /transaction`)

Create a transaction from a quote. Returns the memo you must attach to the on-chain transfer.

#### Request body

| Field | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `quote_id` | `string` | Yes | The ID of the quote to execute. |
| `user_id` | `string` | Yes | Your internal user ID. |
| `account_number` | `string` | Yes | Recipient's account number. |
| `bank_code` | `string` | Yes | Bank code (e.g., `NEQUI`). |
| `tax_id` | `string` | No | User's tax ID. |
| `redirectUrl` | `string` | No | Optional redirect after KYC. |
| `qr_code` | `string` | No | QR code string, when applicable. |

#### Response

```json
{
  "id": "f4a96c4c-4d1e-4ab2-a6ec-2e1b5070c5db",
  "transaction_reference": "9KlsTE0eSrKm7C4bUHDF2w==",
  "kycLink": null
}
```

:::info KYC Requirement
If `kycLink` is not null, you **MUST** redirect the user to this URL to complete their identity verification. The transaction will remain in `AWAITING_PAYMENT` (or a pre-payment state) until KYC is approved.
:::

---

### Get Transaction Status (`GET /transaction/{id}`)

Retrieve the latest status and memo for a transaction. Status values are described in [Status lifecycle](../workflows/status-lifecycle).

#### Response

```json
{
  "id": "f4a96c4c-4d1e-4ab2-a6ec-2e1b5070c5db",
  "status": "AWAITING_PAYMENT",
  "transaction_reference": "9KlsTE0eSrKm7C4bUHDF2w==",
  "on_chain_tx_hash": null,
  "kycLink": null,
  "user_id": "test-user-01"
}
```

---

### List Transactions (`GET /transactions/list`)

Paginated list scoped to your partner and a single external user.

| Query param | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `externalUserId` | `string` | Yes | The `user_id` you provided during transaction creation. |
| `page` | `number` | No | Page number (default `1`). |
| `pageSize` | `number` | No | Page size (default `20`, max `100`). |

**Response (shape):**

```json
{
  "page": 1,
  "pageSize": 20,
  "total": 2,
  "transactions": [
    {
      "id": "f4a96c4c-4d1e-4ab2-a6ec-2e1b5070c5db",
      "status": "PAYMENT_COMPLETED",
      "accountNumber": "3001234567",
      "bankCode": "NEQUI",
      "quote": {
        "id": "550e8400-e29b-41d4-a716-446655440000",
        "cryptoCurrency": "USDC",
        "network": "STELLAR",
        "paymentMethod": "NEQUI",
        "sourceAmount": 100.5,
        "targetAmount": 400000,
        "targetCurrency": "COP"
      }
    }
  ]
}
```

---

## Payment metadata

### List banks (`GET /payments/banks`)

Retrieve the bank list for a payment method (defaults to `MOVII` if omitted).

| Query param | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `paymentMethod` | `string` | No | One of `NEQUI`, `MOVII`, `BREB`, `PIX`. |

**Response:**

```json
{
  "banks": [
    { "bankCode": 1007, "bankName": "Bancolombia" },
    { "bankCode": 1507, "bankName": "NEQUI" }
  ]
}
```

For `BREB`, the bank list maps to its payout rails:

- `9101` (`ENT`) — intra-BreB accounts  
- `9102` (`TFY`) — Transfiya rail

### Check liquidity (`GET /payments/liquidity`)

Returns the latest known liquidity for a payment method.

| Query param | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `paymentMethod` | `string` | No | One of `NEQUI`, `MOVII`, `BREB`, `PIX`. |

**Response:**

```json
{
  "liquidity": 10000000,
  "message": "Liquidity retrieved successfully",
  "success": true
}
```

---

## Error Codes

| Status Code | Description |
| :--- | :--- |
| `400` | **Bad Request**: Invalid parameters, exceeded limits, invalid account, or expired quote. |
| `401` | **Unauthorized**: Missing/invalid `X-API-Key` or bearer token. |
| `404` | **Not Found**: Resource not found or not associated with your partner. |
| `500` | **Internal Server Error**: Something went wrong on our end. |

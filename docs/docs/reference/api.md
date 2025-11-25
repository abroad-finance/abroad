---
sidebar_position: 1
---

import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

# API Reference

Base URL: `https://api.abroad.com` (Production) / `https://api-sandbox.abroad.com` (Sandbox)

## Quotes

### Create Quote

`POST /quote`

Calculate exchange rate and fees for a specific amount.

#### Request Body

| Field | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `amount` | `number` | Yes | The amount of source currency to convert. |
| `crypto_currency` | `string` | Yes | Source cryptocurrency (e.g., `USDC`). |
| `network` | `string` | Yes | Blockchain network (e.g., `STELLAR`, `SOLANA`). |
| `payment_method` | `string` | Yes | Payout method (e.g., `NEQUI`, `PIX`). |
| `target_currency` | `string` | Yes | Target fiat currency (e.g., `COP`, `BRL`). |

#### Example

<Tabs>
<TabItem value="curl" label="cURL">

```bash
curl -X POST https://api.abroad.com/quote \
  -H "X-API-Key: YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "amount": 100,
    "crypto_currency": "USDC",
    "network": "STELLAR",
    "payment_method": "NEQUI",
    "target_currency": "COP"
  }'
```

</TabItem>
<TabItem value="js" label="JavaScript">

```javascript
const response = await fetch('https://api.abroad.com/quote', {
  method: 'POST',
  headers: {
    'X-API-Key': 'YOUR_API_KEY',
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    amount: 100,
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
  "source_amount": 100,
  "target_amount": 400000,
  "exchange_rate": 4000
}
```

---

### Reverse Quote

`POST /quote/reverse`

Calculate the source amount needed to achieve a specific target amount.

#### Request Body

| Field | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `source_amount` | `number` | Yes | The desired target amount (fiat). |
| `crypto_currency` | `string` | Yes | Source cryptocurrency. |
| `network` | `string` | Yes | Blockchain network. |
| `payment_method` | `string` | Yes | Payout method. |
| `target_currency` | `string` | Yes | Target fiat currency. |

---

## Transactions

### Accept Transaction

`POST /transaction`

Create a transaction from a quote.

#### Request Body

| Field | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `quote_id` | `string` | Yes | The ID of the quote to execute. |
| `user_id` | `string` | Yes | Your internal user ID. |
| `account_number` | `string` | Yes | Recipient's account number. |
| `bank_code` | `string` | Yes | Bank code (e.g., `NEQUI`). |
| `tax_id` | `string` | No | User's tax ID. |

#### Response

```json
{
  "id": "tx-123456",
  "transaction_reference": "R28gQWJyZ...",
  "kycLink": "https://kyc.abroad.com/..."
}
```

:::info KYC Requirement
If `kycLink` is not null, you **MUST** redirect the user to this URL to complete their identity verification. The transaction will remain in `AWAITING_PAYMENT` (or a pre-payment state) until KYC is approved.
:::

---

### Get Transaction Status

`GET /transaction/{id}`

#### Response

```json
{
  "id": "tx-123456",
  "status": "PAYMENT_COMPLETED",
  "transaction_reference": "R28gQWJyZ...",
  "on_chain_tx_hash": "0x...",
  "kycLink": null
}
```

## Error Codes

| Status Code | Description |
| :--- | :--- |
| `400` | **Bad Request**: Invalid parameters or quote expired. |
| `401` | **Unauthorized**: Invalid or missing API Key. |
| `404` | **Not Found**: Resource (Quote/Transaction) not found. |
| `500` | **Internal Server Error**: Something went wrong on our end. |

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
| `crypto_currency` | `string` | Yes | Source cryptocurrency (`USDC` or `USDT`). |
| `network` | `string` | Yes | Blockchain network (`STELLAR`, `SOLANA`, or `CELO`). |
| `payment_method` | `string` | Yes | Payout method (`BREB`, `PIX`). |
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
    "payment_method": "BREB",
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
    payment_method: 'BREB',
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
  "expiration_time": 1893456000000,
  "fee": {
    "amount": "0.5",
    "currency": "USDC",
    "type": "combined"
  },
  "quote_id": "550e8400-e29b-41d4-a716-446655440000",
  "value": 100.5
}
```

`value` is the total crypto amount you must send before the quote expires. `expiration_time` is Unix epoch milliseconds. `fee.amount` is the exact fee portion already included in `value`; do not add it again. `fee.currency` is the source asset and `fee.type` is `none`, `percentage`, `fixed`, or `combined`.

---

### Onramp Quote (`POST /quote/onramp`)

Prices the reverse direction: your user pays fiat and receives crypto. See
[Buy crypto with PIX](../workflows/buy-crypto) for the full flow.

**Request**

| Field | Type | Description |
| :--- | :--- | :--- |
| `fiat_amount` | number | The local currency your user pays. |
| `target_currency` | string | `BRL`. |
| `crypto_currency` | string | Asset the user receives, e.g. `USDC`. |
| `network` | string | `STELLAR`, `SOLANA`, or `CELO`. |
| `payment_method` | string | `PIX`. |

```bash
curl -X POST https://api.abroad.finance/quote/onramp \
  -H "X-API-Key: YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "fiat_amount": 500,
    "target_currency": "BRL",
    "crypto_currency": "USDC",
    "network": "CELO",
    "payment_method": "PIX"
  }'
```

**Response** — identical in shape to `POST /quote`, but `value` is the crypto
amount the user receives and `fee` is denominated in that crypto.

### Reverse Quote (`POST /quote/reverse`)

Calculate how much the recipient will receive for a specific crypto amount.

#### Request body

| Field | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `source_amount` | `number` | Yes | Crypto amount you plan to send (for example, `100` USDC). |
| `crypto_currency` | `string` | Yes | Source cryptocurrency (`USDC` or `USDT`). |
| `network` | `string` | Yes | Blockchain network (`STELLAR`, `SOLANA`, or `CELO`). |
| `payment_method` | `string` | Yes | Payout method (`BREB`, `PIX`). |
| `target_currency` | `string` | Yes | Target fiat currency. |

#### Response

```json
{
  "expiration_time": 1893456000000,
  "fee": {
    "amount": "0.5",
    "currency": "USDC",
    "type": "combined"
  },
  "quote_id": "550e8400-e29b-41d4-a716-446655440000",
  "value": 398500
}
```

`value` is the quoted fiat amount (for example, COP) after fees. The fee snapshot is denominated in the source asset and is already reflected in the quote.

#### Quote error response

Both quote endpoints return the same safe error shape for HTTP `400`, `401`, and `500` responses:

```json
{
  "code": "quote_unavailable",
  "reason": "A quote is temporarily unavailable",
  "retryable": true
}
```

Supported `code` values are `authentication_failed`, `invalid_request`, `corridor_unavailable`, `minimum`, `maximum`, `quote_unavailable`, and `server_error`. Use `retryable` to decide whether the same request may be attempted again; the response never exposes raw provider errors.

`authentication_failed` is returned with HTTP `401` — the credential was rejected, so re-authenticate rather than changing the request. Every other `code` uses `400` or `500`.

The `fee` and structured error fields are additive response metadata. Partner request fields, transaction statuses, webhook payloads, and optional `tax_id` behavior are unchanged.

---

## Transactions

### Accept Transaction (`POST /transaction`)

Create a transaction from a quote. Returns the memo you must attach to the on-chain transfer.

#### Request body

| Field | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `quote_id` | `string` | Yes | The ID of the quote to execute. |
| `user_id` | `string` | Yes | Your internal user ID. |
| `account_number` | `string` | Conditional | Recipient's account key. Required unless you send `qr_code`. |
| `qr_code` | `string` | Conditional | PIX QR payload. Required unless you send `account_number`. |
| `tax_id` | `string` | No | User's tax ID (CPF/NIT). |
| `redirectUrl` | `string` | No | Optional redirect used by hosted KYC flows. |

At least one of `account_number` or `qr_code` must carry a non-empty value; a request with neither is rejected with `400`.

:::caution `bank_code` was removed
Earlier versions accepted a `bank_code` field. It is no longer part of the request contract — the rail is resolved server-side from the account key and the quote's `payment_method`. Any `bank_code` you send is ignored.
:::

#### Response

```json
{
  "id": "f4a96c4c-4d1e-4ab2-a6ec-2e1b5070c5db",
  "kycRequired": false,
  "transaction_reference": "9KlsTE0eSrKm7C4bUHDF2w==",
  "payment_context": {
    "amount": 100.5,
    "blockchain": "STELLAR",
    "chainFamily": "stellar",
    "chainId": "stellar:pubnet",
    "cryptoCurrency": "USDC",
    "decimals": 7,
    "depositAddress": "GA...",
    "memo": "9KlsTE0eSrKm7C4bUHDF2w==",
    "memoType": "text",
    "mintAddress": null,
    "notify": { "endpoint": null, "required": false },
    "rpcUrl": "https://horizon.stellar.org"
  }
}
```

| Field | Type | Description |
| :--- | :--- | :--- |
| `id` | `string \| null` | Transaction ID. `null` when `kycRequired` is `true`. |
| `kycRequired` | `boolean` | `true` when the user must complete KYC before a transaction can be created. |
| `transaction_reference` | `string \| null` | Base64 form of the transaction ID; the Stellar memo. `null` when `kycRequired` is `true`. |
| `payment_context` | `object \| null` | Everything needed to fund the transaction on-chain. Omitted when `kycRequired` is `true`. |

:::info KYC requirement
When `kycRequired` is `true`, **no transaction is created** — `id`, `transaction_reference`, and `payment_context` are all null. Collect the user's identity details and submit them to [`POST /kyc`](#submit-kyc-post-kyc), then retry the acceptance with a fresh quote. This replaces the former `kycLink` redirect field.
:::

#### `payment_context`

Read the deposit target from this object rather than hard-coding addresses; they differ per chain and can be rotated.

| Field | Type | Description |
| :--- | :--- | :--- |
| `amount` | `number` | Exact source amount to send. Matches the quote's `value`. |
| `blockchain` | `string` | `STELLAR`, `SOLANA`, or `CELO`. |
| `chainFamily` | `string` | `stellar`, `solana`, or `evm`. |
| `chainId` | `string` | CAIP-style chain ID (`stellar:pubnet`, `solana:mainnet`, `eip155:42220`). |
| `cryptoCurrency` | `string` | `USDC` or `USDT`. |
| `decimals` | `number \| null` | Token decimals for the active mint. |
| `depositAddress` | `string` | Address to send the funds to. |
| `memo` | `string \| null` | Stellar memo. Equals `transaction_reference` on Stellar, `null` elsewhere. |
| `memoType` | `"text" \| null` | `text` on Stellar, `null` elsewhere. |
| `mintAddress` | `string \| null` | Token contract/mint address on Solana and Celo. |
| `notify` | `object` | `{ endpoint, required }`. On Stellar, `required` is `false` and `endpoint` is `null`; on Solana and Celo, `required` is `true` and `endpoint` is `/payments/notify`. |
| `rpcUrl` | `string \| null` | Suggested RPC/Horizon endpoint for broadcasting. |

---

### Notify a payment (`POST /payments/notify`)

Report a Solana or Celo transfer so Abroad can verify it on-chain and start the payout. Stellar deposits are detected automatically and are rejected here.

Call this whenever `payment_context.notify.required` is `true`.

#### Request body

| Field | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `blockchain` | `string` | Yes | `SOLANA` or `CELO`. `STELLAR` returns `400`. |
| `on_chain_tx` | `string` | Yes | Transaction hash (Celo) or signature (Solana). |
| `transaction_id` | `string` | Yes | The Abroad transaction UUID from `POST /transaction`. |

```bash
curl -X POST https://api.abroad.finance/payments/notify \
  -H "X-API-Key: YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "blockchain": "SOLANA",
    "on_chain_tx": "5V...signature",
    "transaction_id": "f4a96c4c-4d1e-4ab2-a6ec-2e1b5070c5db"
  }'
```

#### Response

`202 Accepted`

```json
{ "enqueued": true }
```

Returns `400` when the payload or on-chain data does not validate, and `404` when the transfer cannot be found on-chain.

:::note Per-chain endpoints
`POST /solana/payments/notify` and `POST /celo/payments/notify` still exist and take only `on_chain_tx` and `transaction_id`. Prefer `POST /payments/notify`, which covers both chains behind one contract.
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
  "kycRequired": false,
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
      "onChainId": "2bebb7...",
      "quote": {
        "id": "550e8400-e29b-41d4-a716-446655440000",
        "cryptoCurrency": "USDC",
        "network": "STELLAR",
        "paymentMethod": "BREB",
        "sourceAmount": 100.5,
        "targetAmount": 400000,
        "targetCurrency": "COP"
      }
    }
  ]
}
```

Each item mirrors the transaction record minus internal routing fields: `bankCode` and `origin` are stripped from every partner-facing response.

---

## KYC

Only relevant when KYC is enabled for your partner. See [Limits and validation](../resources/limits#kyc-gating) for when a user is asked to verify.

### Get KYC status (`GET /kyc/status`)

Check whether a user is already approved before you present the form.

| Query param | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `userId` | `string` | Yes | The `user_id` you use when accepting transactions. |

```json
{
  "hasApproved": true,
  "status": "APPROVED"
}
```

`status` is `PENDING`, `PENDING_APPROVAL`, `APPROVED`, `REJECTED`, or `null` when the user has never submitted.

### Submit KYC (`POST /kyc`)

Submit the self-service KYC form. This is a `multipart/form-data` request: identity fields plus one document image. A submission that passes every check is approved immediately.

| Field | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `document` | `file` | Yes | Identity document. Accepts `image/jpeg`, `image/png`, `image/webp`, `image/heic`, `application/pdf`. |
| `userId` | `string` | Yes | Your internal user ID. |
| `fullName` | `string` | Yes | Full legal name. |
| `documentType` | `string` | Yes | `NATIONAL_ID`, `PASSPORT`, `DRIVERS_LICENSE`, `FOREIGN_ID`, or `OTHER`. |
| `documentNumber` | `string` | Yes | Document number. |
| `dateOfBirth` | `string` | Yes | Date in the past, parseable as a date. |
| `nationality` | `string` | Yes | Nationality. |
| `city` | `string` | Yes | City of residence. |
| `address` | `string` | Yes | Street address. |
| `email` | `string` | Yes | Valid email address. |
| `phone` | `string` | Yes | Contact phone. |

```bash
curl -X POST https://api.abroad.finance/kyc \
  -H "X-API-Key: YOUR_API_KEY" \
  -F "userId=test-user-01" \
  -F "fullName=Ana Gómez" \
  -F "documentType=NATIONAL_ID" \
  -F "documentNumber=1020304050" \
  -F "dateOfBirth=1990-05-14" \
  -F "nationality=CO" \
  -F "city=Bogotá" \
  -F "address=Calle 100 #1-1" \
  -F "email=ana@example.com" \
  -F "phone=+573001234567" \
  -F "document=@id-front.jpg"
```

Returns `201` with the resulting status:

```json
{ "status": "APPROVED" }
```

Retry the transaction acceptance once the status is `APPROVED`. Document images are stored in a private bucket and are never returned by the API.

---

## Discovery

### List corridors (`GET /public/corridors`)

Unauthenticated. Returns every asset/network/payout combination that is currently enabled, with its amount bounds and notify requirement. Use it instead of hard-coding the supported matrix.

```json
{
  "corridors": [
    {
      "blockchain": "STELLAR",
      "chainFamily": "stellar",
      "chainId": "stellar:pubnet",
      "cryptoCurrency": "USDC",
      "maxAmount": null,
      "minAmount": null,
      "paymentMethod": "BREB",
      "targetCurrency": "COP",
      "notify": { "endpoint": null, "required": false },
      "walletConnect": {
        "chainId": "stellar:pubnet",
        "events": [],
        "methods": ["stellar_signXDR"],
        "namespace": "stellar"
      }
    }
  ]
}
```

A corridor is listed only when its flow definition is enabled, its asset has an active mint, and the route is not explicitly marked unsupported.

### Decode a PIX QR (`GET /qr-decoder/br`)

Parse a PIX QR payload before accepting a transaction, so you can show the recipient details for confirmation.

| Query param | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `qrCode` | `string` | Yes | The raw PIX QR payload. |

```json
{
  "decoded": {
    "account": "recipient-pix-key",
    "amount": "150.00",
    "currency": "BRL",
    "name": "Recipient Name",
    "taxId": "12345678901"
  }
}
```

Fields are populated only when the QR carries them. An unparseable payload returns `400` with a `reason`.

---

## OPS Reconciliation

These endpoints are for operations tooling and require the `X-OPS-API-KEY` header.

### Reconcile Transaction By Hash (`POST /ops/transactions/reconcile-hash`)

Reconcile a blockchain transaction hash/signature and enqueue processing when a valid pending transaction is found.

#### Request body

| Field | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `blockchain` | `string` | Yes | One of `STELLAR`, `SOLANA`, `CELO`. |
| `on_chain_tx` | `string` | Yes | Blockchain transaction hash/signature. |
| `transaction_id` | `string` | No | Abroad transaction id. Required for unresolved `SOLANA` / `CELO` hashes. |

#### Example

```bash
curl -X POST https://api.abroad.finance/ops/transactions/reconcile-hash \
  -H "X-OPS-API-KEY: YOUR_OPS_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "blockchain": "STELLAR",
    "on_chain_tx": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  }'
```

#### Response

```json
{
  "blockchain": "STELLAR",
  "on_chain_tx": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "result": "enqueued",
  "transaction_id": "550e8400-e29b-41d4-a716-446655440000",
  "transaction_status": "AWAITING_PAYMENT",
  "reason": null
}
```

Result values:

- `alreadyProcessed`: hash already linked to a processed transaction.
- `enqueued`: reconciliation was accepted and queued.
- `unresolved`: no heuristic matching is performed (typically missing `transaction_id` for `SOLANA`/`CELO`).
- `invalid`: payload/chain data did not validate.
- `notFound`: hash was not found on-chain or in expected context.
- `failed`: reconciliation execution failed unexpectedly.

---

## Payment metadata

:::caution `GET /payments/banks` was removed
The bank-listing endpoint no longer exists. Rails are resolved server-side from the account key and the quote's `payment_method`, so there is no bank list to fetch and no `bank_code` to send.
:::

### Check liquidity (`GET /payments/liquidity`)

Returns the latest known liquidity for a payment method.

| Query param | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `paymentMethod` | `string` | No | One of `BREB`, `PIX`. |

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
| `400` | **Bad Request**: Invalid parameters, exceeded limits, invalid account, expired quote, or an unavailable route. Quote responses include `code`, `reason`, and `retryable`. |
| `401` | **Unauthorized**: Missing/invalid `X-API-Key` or bearer token. |
| `403` | **Forbidden**: The end user is disabled (`user_disabled`). Operations can disable a user from the ops console; no transaction can be accepted for them. |
| `404` | **Not Found**: Resource not found, not associated with your partner, or an on-chain transfer that could not be located. |
| `429` | **Too Many Requests**: Rate limit reached. Applies to the MCP endpoint and abuse-protected routes; honor `Retry-After`. |
| `500` | **Internal Server Error**: Something went wrong on our end. Quote responses include a safe `code`, `reason`, and `retryable` value. |

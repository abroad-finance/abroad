---
sidebar_position: 3
---

# 2. Accept Transaction

Once you have a valid `quote_id` and the user has confirmed the details, you create the transaction. This step registers the user's payment details and prepares Abroad to receive the funds.

## Endpoint

`POST /transaction`

## Request

You must provide the `quote_id`, the user's identification (`user_id`), and where the payout should land — either an `account_number` or a `qr_code`.

```json
{
  "quote_id": "uuid-from-previous-step",
  "user_id": "your-internal-user-id",
  "account_number": "3001234567",
  "tax_id": "123456789"
}
```

### Parameters

| Parameter | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `quote_id` | `string` | Yes | The ID of the quote to execute. |
| `user_id` | `string` | Yes | Your internal user ID for compliance tracking. |
| `account_number` | `string` | Conditional | The recipient's account key. Required unless you send `qr_code`. |
| `qr_code` | `string` | Conditional | PIX QR payload. Required unless you send `account_number`. Decode it first with `GET /qr-decoder/br` if you want to confirm the recipient. |
| `tax_id` | `string` | No | The user's tax ID (NIT/CPF) if required. |
| `redirectUrl` | `string` | No | Optional redirect used by hosted KYC flows. |

:::caution `bank_code` was removed
The request no longer accepts a `bank_code`. Abroad resolves the payout rail from the account key and the quote's `payment_method`. A `bank_code` in your payload is ignored.
:::

## Response

The response carries the `transaction_reference` — the memo for Stellar transfers — and a `payment_context` with the deposit target for the chosen network.

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

Field-by-field detail for `payment_context` lives in the [API reference](../reference/api#payment_context).

### KYC checks

If the user must verify their identity first, the response is:

```json
{
  "id": null,
  "kycRequired": true,
  "transaction_reference": null,
  "payment_context": null
}
```

:::important Action required
No transaction exists yet. Collect the user's identity details, submit them to `POST /kyc`, and then create a **new quote** and retry the acceptance. Earlier versions returned a `kycLink` URL to redirect to; that field is gone, replaced by the self-service form described in the [API reference](../reference/api#submit-kyc-post-kyc).
:::

### Disabled users

A user disabled by Abroad operations returns `403` with code `user_disabled`. Acceptance will keep failing until the user is re-enabled; do not retry automatically.

## Troubleshooting

### "We could not verify the account number and bank code provided. Please double-check the details and try again."
Abroad could not validate the provided payout details. Confirm the `account_number` and resend the request.

### "We could not find a valid quote for this request. Please generate a new quote and try again."
The supplied `quote_id` is missing or no longer valid (likely expired). Create a fresh quote and retry the transaction.

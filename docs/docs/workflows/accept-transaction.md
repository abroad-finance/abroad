---
sidebar_position: 3
---

# 2. Accept Transaction

Once you have a valid `quote_id` and the user has confirmed the details, you create the transaction. This step registers the user's payment details and prepares Abroad to receive the funds.

## Endpoint

`POST /transaction`

## Request

You must provide the `quote_id`, the user's identification (`user_id`), and their payout details. Bank code is only required for `MOVII`; other payment methods infer rails automatically.

```json
{
  "quote_id": "uuid-from-previous-step",
  "user_id": "your-internal-user-id",
  "account_number": "3001234567",
  "bank_code": "NEQUI",
  "tax_id": "123456789"
}
```

### Parameters

| Parameter | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `quote_id` | `string` | Yes | The ID of the quote to execute. |
| `user_id` | `string` | Yes | Your internal user ID for compliance tracking. |
| `account_number` | `string` | Yes | The recipient's bank account or mobile wallet number. |
| `bank_code` | `string` | No | The bank code (e.g., `NEQUI`, `BANCOLOMBIA`). Required only for `MOVII`; optional for `NEQUI`, `BREB`, and `PIX`. |
| `tax_id` | `string` | No | The user's tax ID (NIT/CPF) if required. |
| `redirectUrl` | `string` | No | Optional redirect URL after KYC. |
| `qr_code` | `string` | No | QR code string, when applicable. |

## Response

The most critical part of the response is the `transaction_reference`. This is the unique identifier (Memo) that **MUST** be included in the on-chain transfer.

```json
{
  "id": "f4a96c4c-4d1e-4ab2-a6ec-2e1b5070c5db",
  "transaction_reference": "9KlsTE0eSrKm7C4bUHDF2w==",
  "kycLink": null
}
```

### KYC/KYB Checks

If the user or partner requires KYC/KYB verification, the `kycLink` field will contain a URL.

:::important Action Required
You **MUST** redirect the user to this URL to complete their identity verification. The transaction will not be processed until KYC is approved.
:::

## Troubleshooting

### "We could not verify the account number and bank code provided. Please double-check the details and try again."
Abroad could not validate the provided payout details. Confirm the `account_number` and `bank_code` pair (for MOVII a bank code is required) and resend the request.

### "We could not find a valid quote for this request. Please generate a new quote and try again."
The supplied `quote_id` is missing or no longer valid (likely expired). Create a fresh quote and retry the transaction.

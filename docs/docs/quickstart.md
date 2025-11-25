---
sidebar_position: 2
---

# Quickstart Guide

This guide will take you from zero to your first test transaction in under 5 minutes.

## Prerequisites

-   **API Key**: You need a Sandbox API Key. If you don't have one, contact [support@abroad.com](mailto:support@abroad.com).
-   **Terminal**: You'll need `curl` or a tool like Postman.

## Step 1: Verify your API Key

Let's make sure your key works by checking your partner status (using a hypothetical health or profile endpoint, or just by trying to get a quote).

```bash
curl -X POST https://api-sandbox.abroad.com/quote \
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

If you get a JSON response with a `quote_id`, you're ready to go!

## Step 2: Create a Quote

We want to send **100 USDC** to a user in **Colombia** via **Nequi**.

**Request:**

```bash
curl -X POST https://api-sandbox.abroad.com/quote \
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

**Response:**

```json
{
  "quote_id": "550e8400-e29b-41d4-a716-446655440000",
  "source_amount": 100,
  "target_amount": 400000,
  "exchange_rate": 4000,
  "expiration_time": 1732520000
}
```

Copy the `quote_id`! You'll need it for the next step.

## Step 3: Accept the Transaction

Now, let's tell Abroad who is receiving the money.

**Request:**

```bash
curl -X POST https://api-sandbox.abroad.com/transaction \
  -H "X-API-Key: YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "quote_id": "550e8400-e29b-41d4-a716-446655440000",
    "user_id": "test-user-01",
    "account_number": "3001234567",
    "bank_code": "NEQUI"
  }'
```

**Response:**

```json
{
  "id": "tx-123456",
  "transaction_reference": "R28gQWJyZ...",
  "kycLink": null
}
```

## Step 4: Simulate Payment (Sandbox Only)

In production, you would send real USDC. In Sandbox, you can simulate the deposit.

*Note: Sandbox simulation endpoints are available upon request.*

## Next Steps

-   Read the full [Workflows](./workflows/overview) guide.
-   Check out the [API Reference](./reference/api).

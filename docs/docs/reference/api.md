---
sidebar_position: 1
---

# API Reference

Base URL: `https://api.abroad.com` (Production) / `https://api-sandbox.abroad.com` (Sandbox)

## Quotes

### Create Quote
`POST /quote`
Calculate exchange rate and fees.

### Reverse Quote
`POST /quote/reverse`
Calculate source amount based on desired target amount.

## Transactions

### Accept Transaction
`POST /transaction`
Create a transaction from a quote.

### Get Transaction Status
`GET /transaction/{id}`
Get the current status of a transaction.

## Webhooks

### Register Webhook
(Contact support to register your webhook URL)

## Authentication
See [Authentication](../authentication).

---
slug: /
sidebar_position: 1
---

# Introduction

Welcome to the **Abroad** documentation. Abroad is a global payments infrastructure that enables companies to integrate seamless cross-border payments and currency conversions into their applications.

## What is Abroad?

Abroad provides a unified API to:
-   **Convert** between fiat currencies (COP, BRL) and cryptocurrencies (USDC, USDT).
-   **Pay** local vendors and users via local payment methods (BreB, Pix).
-   **Accept** payments from users in multiple currencies.
-   **Manage** compliance (KYC/KYB) automatically.

## Key Features

-   **Instant Quotes**: Get real-time exchange rates for conversions, with an exact fee snapshot in the source asset.
-   **Local Payouts**: Disburse funds directly to bank accounts and mobile wallets in Colombia and Brazil.
-   **Self-describing funding**: Every accepted transaction returns a `payment_context` with the deposit address, memo, token mint, and chain metadata — no hard-coded addresses.
-   **Compliance First**: Built-in KYC and KYB checks to ensure regulatory compliance.
-   **Developer Friendly**: Simple REST API with retrying, signed webhooks.

## Getting Started

To start integrating with Abroad:

1.  **Create your workspace**: Use the [self-service setup](./self-service-setup) to verify your administrator, enable MFA, and create a production API key.
2.  **Authenticate**: Learn how to authenticate your requests in the [Authentication](./authentication) guide.
3.  **Follow the Workflow**: Check out our [Workflows](./workflows/overview) to understand the lifecycle of a transaction.
4.  **Connect an AI assistant (optional)**: Use the read-only [AI integration](./ai-integration) for documentation, request validation, transaction visibility, and webhook diagnostics without sharing an Abroad credential.

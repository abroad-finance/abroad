---
sidebar_position: 3
---

# Self-service setup

Abroad's partner workspace lets a new organization create its own production account, secure its first administrator, and manage the existing API-key and webhook integrations.

:::warning Production only
Abroad does not currently provide a sandbox environment. API keys created in the partner workspace authenticate against the production API at `https://api.abroad.finance`.
:::

## 1) Create the workspace

Open [Create a production workspace](https://app.abroad.finance/partner/signup) and provide:

- The first administrator's name and email address.
- The organization name and country.
- A password for the administrator account.

Abroad creates the organization and first administrator together. The verification request is recorded durably with the workspace, so a temporary email-provider interruption does not lose it. Repeated or concurrent submissions do not create duplicate workspaces.

## 2) Verify the administrator email

Open the single-use verification link sent to the administrator email. The link expires after 24 hours. Sign-in remains disabled until the email address is verified.

If the message does not arrive, wait one minute and use **Send another link** from the signup confirmation screen. Abroad checks the pending administrator's email and password, queues a fresh single-use link when eligible, and safely coalesces duplicate requests. For privacy, the screen always uses the same acknowledgement and never reveals whether an account exists.

## 3) Secure privileged access

Email verification opens the existing partner workspace and its transaction ledger. A new workspace shows the normal empty transaction state until it processes transactions.

Before an administrator can manage integration credentials, they must enable multi-factor authentication from **Security**. This is the same MFA requirement used by existing partner accounts.

## 4) Create production credentials

After MFA is verified, use **Integration** to:

- Create a named, scoped API key.
- Configure the production webhook destination.
- Generate or rotate the webhook signing secret.

API keys and webhook signing secrets are shown only once. Store them in your own secret manager and never put them in browser code, mobile applications, source control, or logs.

Continue with [Authentication](./authentication) to use the API key and [Webhooks](./reference/webhooks) to validate lifecycle callbacks.

For read-only assistance with documentation, request validation, transaction visibility, and webhook diagnostics, use [Connect Abroad to AI](./ai-integration). The AI authorization flow uses the existing verified portal account and never asks you to paste an API key or webhook secret into the portal page.

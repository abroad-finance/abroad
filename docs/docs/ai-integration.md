---
sidebar_position: 4
---

# Connect Abroad to AI

Abroad's **AI integration** lets a partner connect a compatible AI assistant to read approved operational context. It uses the [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) as the underlying standard and Abroad OAuth for authorization.

The integration can help you:

- Find Abroad documentation and field requirements.
- Validate a quote or transaction request body without sending it.
- Inspect transactions belonging to your Abroad organization.
- Review bounded webhook delivery diagnostics without exposing payloads or secrets.

It is read-only. An AI client cannot create or accept transactions, move funds, issue refunds, trade, replay or change webhooks, rotate credentials, manage users, submit KYC data, or change production infrastructure. Use the partner portal or the authenticated public API for those operations.

:::warning Production data
Abroad is production-only. A connected client can read the production data covered by the permissions an administrator approves.
:::

## Supported AI clients

Abroad supports remote MCP clients that implement:

- Streamable HTTP.
- OAuth authorization-code flow.
- Dynamic client registration for a public client.
- PKCE with `S256`.
- Resource-bound bearer tokens and OAuth refresh-token rotation.

Redirect destinations must use HTTPS, except for local desktop callbacks. Those callbacks may use HTTP with the exact host `localhost`, `127.0.0.1`, or `[::1]` and an ephemeral port. Other HTTP hosts, hostname suffixes, and localhost aliases are rejected.

Abroad publishes client-specific setup cards only after testing that client's complete connection flow. Until a named guide is shown in the portal, use the generic instructions below. Abroad does not provide or endorse unverified installation deep links.

## Connect another MCP client

1. Sign in to [AI integrations in the partner portal](https://app.abroad.finance/partner/integration/ai?from=documentation).
2. Copy the production MCP address:

   ```text
   https://api.abroad.finance/mcp
   ```

3. In your AI client, add a remote MCP server and paste that address.
4. The client opens Abroad sign-in. Sign in with your existing verified partner account.
5. Review the requesting client, Abroad organization, return destination, and every requested permission.
6. Approve or deny the complete request. A non-administrator cannot grant organization access. Webhook diagnostics require a currently verified MFA session.
7. Return to the AI client when Abroad shows the result.

The OAuth flow creates its own revocable connection. Never paste an Abroad API key, webhook signing secret, password, or one-time code into an AI client configuration.

## Tools and permissions

The client sees only tools covered by the approved scopes. Every tool independently rechecks its permission.

| Permission | Tools | What it provides |
| --- | --- | --- |
| `account:read` | `get_account_metadata` | Organization name, MCP resource, connection status, and granted scopes. This is the safe connection test. |
| `docs:read` | `search_documentation` | Ranked results from Abroad's public integration guide catalog. Search text is processed in memory and not stored. |
| `requests:validate` | `validate_api_request` | Request-shape validation for create quote, reverse quote, and transaction acceptance. It never submits the request. |
| `transactions:read` | `list_transactions`, `get_transaction` | Tenant-scoped transaction summaries and details, including lifecycle, PIX E2E ID, failure/refund status, and bounded delivery diagnostics. |
| `webhooks:read` | `get_webhook_diagnostics` | Destination host and aggregate delivery health, with no URL path/query, payload, signing secret, test, replay, or configuration change. Requires administrator MFA. |
| `offline_access` | No tool | Lets the client refresh the approved connection without asking you to sign in for every session. |

Tools return **structured content** validated against a declared output schema, so a client receives typed results rather than a JSON string.

## Guided prompt

Beyond tools, the server publishes a `diagnose_failed_transaction` prompt that takes a `transactionId` and walks the assistant through Abroad's support playbook: read the status and failure reason, check refund progress, distinguish an unfunded transaction from a failed one, and separate a payout failure from a webhook-delivery failure on your side. The prompt is gated on the scopes you approved, so it never directs the client at a tool it cannot call.

## Rate limits and auditing

Tool calls are metered per connection and per organization. When a client exceeds its allowance, Abroad answers `429` with a `Retry-After` header and the retry interval in the JSON-RPC error data — a well-behaved client backs off rather than retrying immediately.

Reads of your tenant data are recorded. `list_transactions`, `get_transaction`, and `get_webhook_diagnostics` write an audit entry each time they run. `search_documentation` and `validate_api_request` touch no tenant data and are deliberately not recorded.

## Example prompts

- “Validate this create-quote request and explain any missing fields.”
- “Show the latest failed transactions and summarize their failure and refund status.”
- “Find the documentation for accepting a PIX transaction without a tax ID.”
- “Check webhook delivery health for the last 24 hours and suggest non-destructive troubleshooting steps.”
- “Verify which Abroad organization and permissions this connection can access.”

Do not include credentials, webhook secrets, one-time codes, or unnecessary customer data in a prompt.

## Verify a connection

From **AI integrations** in the partner portal, choose **Test connection**. The test reads account metadata only. It does not read a transaction, call a webhook, or perform a financial mutation.

You can also ask the connected client to run `get_account_metadata`.

## Troubleshooting

### Unsupported client

Confirm the client supports the protocol profile listed above. Custom URL schemes, non-loopback HTTP redirects, clients without PKCE `S256`, and clients that request unknown permissions are rejected.

### Authorization request expired

Authorization requests expire after 15 minutes. Restart the connection from the AI client; do not reuse the old browser URL.

### Administrator approval required

Only an Abroad partner administrator can approve organization access. A member can discover the integration and review why approval is blocked.

### MFA required

The `webhooks:read` permission is privileged. Enable and verify MFA under **Team & security**, then return to the same authorization request before it expires.

### Connection expired, revoked, or failed

- **Expired** — start a new explicit authorization from the AI client.
- **Revoked** — the administrator intentionally invalidated all access and refresh tokens; authorize again if access should resume.
- **Failed** — Abroad disabled the connection after a security or protocol failure, such as refresh-token reuse. Start a fresh authorization and investigate the client before approving it.

### Server error

Retry from the AI client. If the error continues, record the time, client name, and non-sensitive error code for Abroad support. Do not send tokens, authorization URLs, prompts, customer payloads, or credentials.

## Revoke a client

1. Open [AI integrations](https://app.abroad.finance/partner/integration/ai).
2. Find the connected client and review its scopes and last-used time.
3. Choose **Revoke** and confirm the effect.

Revocation is immediate. All access and refresh tokens for that connection stop working, and the client must complete a new administrator-approved OAuth flow before it can read Abroad data again. Revoked history remains visible for audit purposes.

Continue with [Self-service setup](./self-service-setup) for workspace security, [Authentication](./authentication) for the public API, and [Webhooks](./reference/webhooks) for delivery integration.

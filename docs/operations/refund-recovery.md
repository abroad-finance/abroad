# Ops refund recovery

Use the **Refund recovery** panel on a transaction when the customer payment failed or expired and the automatic on-chain refund did not produce canonical completion evidence.

## Required access

- Sign in with a named Operations, Finance, or Administrator account.
- Refresh authentication when the protected-action dialog requests step-up verification.
- Record a PII-free reason and an incident, ticket, or partner reference.

Legacy Ops-key sessions, Support, Compliance, and Viewer roles cannot execute refund recovery.

## Recovery sequence

1. Open the failed transaction in Ops and review its payment, provider, flow, and refund evidence.
2. In **Refund recovery**, select **Reconcile refund**.
3. Type the exact confirmation shown by the protected-action dialog. The server checks the original durable hash and every previously prepared replacement hash.
4. Act on the resulting posture:
   - **Completed** — the chain confirms a refund and Abroad has recorded the canonical refund ID. No further financial action is permitted.
   - **Eligible** — all known hashes are absent after expiry. A replacement may be issued.
   - **Ambiguous** or **In flight** — a signed transaction may still settle. Wait for finality and reconcile again. Do not create another refund.
   - **Blocked** or **Unsupported** — the authoritative amount, sender, hash, or network capability is incomplete. Escalate; do not infer missing financial data.
5. Only from **Eligible**, select **Issue replacement refund**, supply the operational reason/reference, and type the exact confirmation.
6. The server rechecks every hash immediately before signing. It derives the asset, amount, network, source, and destination from authoritative evidence; these values cannot be edited in Ops.
7. Reconcile until the panel shows **Completed**. Completion means the chain result is confirmed, `refundOnChainId` is assigned, and the partner update is queued through the durable webhook outbox.

## Safety behavior

- Automatic refunds and Ops recovery share the same per-transaction lock.
- An automatic Stellar refund with an indeterminate submission result remains in flight; duplicate flow delivery cannot create another transaction before exact-hash reconciliation.
- The replacement's signed Stellar envelope and hash are persisted before the first broadcast.
- Each prepared envelope is submitted once. An ambiguous response blocks another replacement until exact-hash reconciliation proves the attempt absent after expiry.
- Stale page versions are rejected. Refresh evidence instead of repeating the mutation.
- Ops never accepts an operator-entered refund amount or wallet address.
- The panel exposes only a short hash fingerprint and normalized failure category; it never exposes the signed envelope, destination, raw provider body, or customer PII.

## Do not use

- Do not use generic flow retry or resume to recover a refund after provider-status signals were already consumed.
- Do not manually edit transaction status or `refundOnChainId`.
- Do not broadcast a stored signed envelope outside this workflow.
- Do not issue a direct wallet transfer, provider payout, or database mutation as a substitute for recovery.

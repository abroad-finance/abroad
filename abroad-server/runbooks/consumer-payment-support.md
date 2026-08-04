# Consumer payment support and reconciliation

## Safety rules

Use this runbook for consumer PIX/BRE-B support. It does not authorize a refund, payout, replay, provider mutation, blockchain send, database update, or webhook redelivery.

- Ask for the Abroad ID shown in progress, receipt, or Activity. Do not ask the customer to post a PIX/BRE-B key, QR payload, wallet address, tax ID, or document in an unapproved channel.
- Open the payment through the authenticated, partner-scoped Ops workflow. Never search raw application logs by recipient or wallet identity.
- Reconcile the transaction journal, accepted on-chain identity, provider payout/reference, refund assignment, and latest worker state before proposing an action.
- Treat timeout, rate-limit, provider 5xx, process termination, and lost responses as ambiguous. Never repeat a financial mutation until the original idempotency key and external state prove that retry is safe.
- `Transaction.refundOnChainId` is the authoritative refund assignment. Equal amount or destination is not enough to associate a refund.
- A user-facing completed, paid, or refunded statement requires authoritative evidence and the appropriate reference.

## Aggregate support taxonomy (M10)

Every case receives exactly one primary category and, if useful, one non-sensitive secondary operational tag. Do not copy ticket text, names, recipient data, documents, wallet data, QR payloads, transaction/reference IDs, or provider bodies into UX analytics.

| Category | Use when | Aggregate denominator |
|---|---|---|
| `delayed_or_uncertain_status` | Status remains processing, unknown, or manual review beyond the normal observed range | accepted payments |
| `recipient_not_paid` | Customer or partner disputes local-rail receipt | completed payments |
| `receipt_or_proof_request` | A reference, downloadable receipt, or proof is requested | completed payments |
| `refund_status` | Refund is pending, failed, disputed, or requested | accepted payments |
| `wallet_connection` | Wallet selection, authentication, rejection, network, reconnect, or signing blocks progress | checkout attempts |
| `wrong_recipient_method` | QR content was entered as a key, a key as QR, or method-specific validation is unclear | recipient starts |
| `activity_access` | Activity is unavailable, stale, filtered unexpectedly, or an owned detail cannot be restored | Activity sessions |
| `identity_verification` | KYC validation, upload, review, more-information, rejection, expiry, cancel, or resume | verification sessions |
| `conditional_availability` | Region/corridor unavailable or persistent connection state blocks the journey | eligible app sessions |
| `other` | No category above applies after triage | accepted payments where applicable |

Report counts per 1,000 of the listed denominator, by reporting period, rail, and UI version when available. M10 remains an aggregate report; do not create a ticket-to-telemetry session join.

## Triage by category

### Delayed or uncertain status

1. Load the owned payment by Abroad ID and confirm the latest transaction status and journal timestamps.
2. Verify whether funds were accepted and whether a durable on-chain identity exists.
3. Reconcile the configured flow step and provider operation using existing read-only identifiers and idempotency keys.
4. If payment state is authoritative but delayed, tell the user the exact visible state, last checked time, and that leaving the page will not stop processing.
5. Escalate with Abroad ID, current status, timestamps, rail, and which authoritative source is missing. Do not include recipient or wallet values.

### Recipient not paid

1. Do not infer delivery from a generic success message or provider HTTP success.
2. Verify authoritative payment completion, provider payout state, and PIX E2E or BRE-B reference when present.
3. If completed with local-rail evidence, provide the receipt/reference through the approved secure path.
4. If evidence is absent or contradictory, classify the outcome as uncertain and escalate reconciliation. Do not initiate a duplicate payout.
5. If failure/refund is established, follow the refund-status runbook; do not promise a refund before it is assigned and observed.

### Receipt or proof request

1. Open the Activity receipt for the owned Abroad ID.
2. State which references are available: Abroad, PIX E2E, BRE-B, provider, on-chain, or refund. Do not substitute one reference under another label.
3. Use the bounded PDF download route only when `receiptAvailable` is true.
4. If proof is pending or unavailable, explain that precisely and escalate only when authoritative completion requires a missing reference.

### Refund status

1. Inspect the transaction refund state and canonical `refundOnChainId` assignment.
2. Distinguish not applicable, pending, completed, failed, and unknown/manual-review states.
3. Confirm the original payment outcome and guard against payout-plus-refund races.
4. Provide a refund-completed statement only after authoritative confirmation and reference assignment.
5. Any refund mutation requires separate explicit authorization and a fresh idempotency/state preflight.

### Wallet connection

1. Identify only the coarse wallet category, source asset, and compatible network; do not record an address.
2. Distinguish dismissal, user rejection, unsupported wallet/network, timeout, insufficient gas, disconnect, and ambiguous broadcast.
3. For pre-acceptance connection failure, guide the user back to the unified selector with the draft retained as permitted.
4. For post-acceptance ambiguity, restore the Abroad ID and reconcile before showing Retry.
5. Escalate repeatable client defects with UI version, device class, wallet category, network, and bounded outcome only.

### Wrong recipient method

1. Confirm whether the user chose Camera, Pix Copia e Cola/Paste, Upload, Pix key, or Llave BRE-B without collecting the value.
2. Explain the artifact distinction and return them to the same local input surface.
3. Let the user switch, clear, or correct the method. Never move a raw value between incompatible fields automatically.
4. Escalate using rail, method, locally derived key type, and bounded validation category only.

### Activity access

1. Confirm the wallet is authenticated and Activity is scoped to the same wallet bearer subject.
2. Preserve any loaded results while checking offline/stale/error state.
3. Confirm URL filters, page state, and the opaque Abroad ID format.
4. Treat not-found and unauthorized records uniformly. Never reveal whether another wallet owns an ID.
5. Escalate with UI version, page outcome, filter category, latency bucket, and count bucket only.

### Identity verification

1. State why verification is required, who processes it, what happens next, and which step is active.
2. Do not request field values or document images through support. Use the approved encrypted upload flow.
3. Distinguish validation, upload, submitting, review, more information, approved, rejected, expired, unavailable, and cancellation.
4. Resume payment exactly once only when authoritative approval and the complete permitted in-memory draft remain available.
5. Otherwise return the user to deterministic re-entry. Never persist QR, recipient, or document content for convenience.

### Conditional availability

1. Distinguish region/corridor unavailable from connection lost, reconnecting, reconnect failed, and MiniPay disclosure.
2. Offer only the state-specific action: change destination, reconnect, retry status, or use a supported wallet/source.
3. Preserve accepted identity and permitted draft state. Do not imply funds failed because the browser disconnected.
4. Escalate with state, action, outcome, UI version, and coarse device class only.

## Escalation packet

An escalation contains only:

- Abroad ID in the authorized operational case, never the aggregate UX report;
- partner and authenticated ownership confirmation;
- rail, network, source asset, target currency, and current lifecycle/refund/proof states;
- authoritative references that exist and the exact reference type;
- timestamps from the transaction journal and last reconciliation;
- the failed invariant or missing authoritative source;
- safe next action and whether a financial mutation would require separate approval.

Keep the customer-facing response clear: what is known, what is not yet known, whether funds were accepted, whether processing continues after leaving the page, where to track it, and when support will update them. Never fabricate a timeline or economic outcome.

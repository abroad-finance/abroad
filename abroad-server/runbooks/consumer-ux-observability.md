# Consumer UX observability

## Purpose and scope

This runbook defines the privacy-safe evidence layer for the Abroad consumer PIX and BRE-B journey. It covers schema-v2 events emitted by the web application and accepted by `POST /telemetry/consumer-ux`. The endpoint is deliberately hidden from the partner API contract.

The telemetry answers aggregate product questions. It must never be used to investigate one customer or one payment. Transaction reconciliation belongs in the authenticated Ops workflow and the payment support runbook.

## Privacy contract

Every accepted log entry has:

- `jsonPayload.message="[ConsumerUxTelemetry] bounded UX event"`;
- the validated event at `jsonPayload.params[0]`;
- `schema_version=2`, a deployed `ui_version`, and a coarse `device_class`;
- one random, purpose-specific session key; and
- only server-allowlisted enum, boolean, bucket, and version fields.

Never query, export, or add wallet addresses, account numbers, PIX/BRE-B keys, QR contents, tax or document values, filenames, exact amounts, exact user timestamps, transaction/reference IDs, IP addresses, user agents, coordinates, provider bodies, support text, or authentication material. Session keys must not be joined to payment, support, provider, partner-customer, or identity data.

Telemetry delivery is fail-open for checkout: a missing or rejected event cannot block a payment. Event loss is measured through event-quality checks rather than retried from a durable payment queue.

## Source-controlled Logs Explorer queries

Set the resource selector to the production API service before using these filters. The base filter is:

```text
resource.type="cloud_run_revision"
jsonPayload.message="[ConsumerUxTelemetry] bounded UX event"
jsonPayload.params[0].schema_version=2
```

Add one of the following bounded filters and use only the listed dimensions in the Logs Explorer field table or chart builder.

| Saved-query name | Additional filter | Allowed dimensions |
|---|---|---|
| `consumer_ux_event_health_v2` | none | event_name, ui_version, device_class, schema_version |
| `consumer_ux_destination_v2` | `jsonPayload.params[0].event_name=("destination_control_viewed" OR "destination_selected")` | event_name, initial_destination, selected_destination, source_surface, ui_version, device_class |
| `consumer_ux_recipient_v2` | `jsonPayload.params[0].event_name=("recipient_method_impression" OR "recipient_method_selected" OR "recipient_method_switched" OR "recipient_entry_abandoned" OR "recipient_input_started" OR "recipient_validation_outcome" OR "recipient_correction" OR "recipient_help_opened")` | event_name, rail, method, step, elapsed_bucket, key_type, error_category, copy_variant, ui_version, device_class |
| `consumer_ux_wallet_v2` | `jsonPayload.params[0].event_name=("wallet_selector_opened" OR "wallet_chain_selected" OR "wallet_option_selected" OR "wallet_connect_outcome" OR "wallet_selector_closed" OR "wallet_cta_impression" OR "wallet_cta_clicked")` | event_name, wallet_category, chain, source_asset, outcome, trigger_location, source_surface, ui_version, device_class |
| `consumer_ux_qr_v2` | `jsonPayload.params[0].event_name=("qr_mode_impression" OR "qr_mode_selected" OR "file_picker_opened" OR "qr_decode_outcome")` | event_name, rail, method, outcome, elapsed_bucket, error_category, ui_version, device_class |
| `consumer_ux_processing_v2` | `jsonPayload.params[0].event_name=("processing_state_viewed" OR "processing_delay_bucket_crossed" OR "processing_exit" OR "help_opened")` | event_name, elapsed_bucket, copy_variant, terminal_outcome, action, ui_version, device_class |
| `consumer_ux_receipt_v2` | `jsonPayload.params[0].event_name=("receipt_viewed" OR "receipt_reference_copied" OR "receipt_downloaded" OR "receipt_shared" OR "history_opened_from_receipt" OR "support_opened_from_receipt")` | event_name, rail, outcome, reference_available, elapsed_bucket, action, ui_version, device_class |
| `consumer_ux_activity_v2` | `jsonPayload.params[0].event_name=("activity_opened" OR "activity_page_outcome" OR "activity_filter_changed" OR "activity_row_opened" OR "activity_detail_restored" OR "activity_reference_action" OR "activity_retry")` | event_name, rail, status, filter, action, loaded_count_bucket, total_count_bucket, latency_bucket, outcome, entry_surface, ui_version, device_class |
| `consumer_ux_verification_v2` | `jsonPayload.params[0].event_name=("verification_viewed" OR "verification_step_viewed" OR "verification_validation_outcome" OR "verification_submit_outcome" OR "verification_cancelled" OR "verification_resumed")` | event_name, trigger_category, step, field_category, error_category, elapsed_bucket, outcome, ui_version, device_class |
| `consumer_ux_conditional_v2` | `jsonPayload.params[0].event_name=("conditional_service_state_viewed" OR "conditional_service_action")` | event_name, state, action, outcome, ui_version, device_class |
| `consumer_ux_header_v2` | `jsonPayload.params[0].event_name="header_action_clicked"` | event_name, action, immediate_reversal, ui_version, device_class |

For command-line review, always project an allowlist instead of printing the whole event. For example:

```bash
gcloud logging read \
  'resource.type="cloud_run_revision" AND jsonPayload.message="[ConsumerUxTelemetry] bounded UX event" AND jsonPayload.params[0].schema_version=2' \
  --project="$ABROAD_OBSERVABILITY_PROJECT" \
  --freshness=24h \
  --limit=5000 \
  --format='csv[no-heading](jsonPayload.params[0].event_name,jsonPayload.params[0].ui_version,jsonPayload.params[0].device_class,jsonPayload.params[0].outcome)'
```

Do not add a session key to command output. A narrowly scoped, time-bounded session-key query is permitted only to debug telemetry delivery itself, never a user or payment.

## Dashboard definition

Create one dashboard named **Consumer payment UX — schema v2** from the saved queries. Every tile must be segmented by `ui_version`, `schema_version`, and `device_class`; PIX/BRE-B tiles must additionally expose `rail`. Use counts and rates, not raw log rows.

| Tile | Metric | Population and calculation |
|---|---|---|
| Event health | accepted events by name; invalid endpoint requests; missing UI versions | All schema-v2 telemetry requests. Alert on a deployed UI version producing no events, validation rejection spikes, unknown enum dimensions, or a required event family disappearing. |
| M01 Destination correction | selected destination and immediate reversal | Checkout attempts with a destination impression. Count selected destination changes and client-derived reversals before recipient validation; do not infer intent from a click alone. |
| M02/M06 Recipient journey | first method, switches, validation, help, abandonment | Checkout attempts with a recipient-method impression. Aggregate by rail and method; report time bucket to first valid recipient and correction/help rates. |
| M03/M08 Wallet | selector outcomes and CTA path | Checkout attempts with a wallet CTA or selector open. Show repeats, dismissal, rejected, timeout, unsupported, and successful connection by first CTA surface. |
| M04 QR modes | impressions, selections, file picker, decode outcome | Checkout attempts with a QR-mode impression. Report selected/impressed, valid decode/selected, and failure categories by mode and device. |
| M05 Delayed processing | delay buckets, exits, help, terminal outcome | Accepted checkout attempts that viewed processing. Report bucket exposure and help/exit per 1,000 accepted and completed payments. A browser exit is not a payment failure. |
| M07 Receipt | view, copy, share, download, Activity, support | Completed-payment receipt views, segmented by rail and reference availability. Report actions per 1,000 completed payments. |
| M09 Header correction | header actions and immediate reversal | App sessions with a header action. Report adjacent-action reversals; never label the rate as confidence. |
| M11 Activity | open, page outcome, filters, rows, detail, retry | Activity sessions. Report success/empty/filtered-empty/error/stale/offline, latency and count buckets, filter and detail rates. |
| M12 Verification | step reach, validation, submit and resume outcomes | Verification sessions. Report step transition and bounded error category only; never document or field content. |
| M13 Conditional service | state views and recovery actions | App sessions that see an allowlisted conditional state. Report recoveries and repeated failures by state. |
| Guardrails | accepted/completed/refunded/failed payment aggregates from the authoritative transaction dashboard | Compare independently by rail. UX telemetry is not the source of financial truth and may not be used to classify a payment outcome. |

M10 support-topic aggregates are maintained in the support system and joined only by reporting period, rail, UI version, and denominator. There is no ticket-level join to UX sessions.

## Baseline, comparison, and exclusions

- The pre-v2 baseline has no equivalent event families for several metrics. Record those cells as **not measurable**, not zero.
- Start the post-release observation window only after the UI release is fully converged. Keep mixed-version traffic separated.
- Exclude automated test traffic, internal controlled walkthroughs, known synthetic fixtures, malformed/invalid schema requests, and periods of provider or corridor outage from product-interpretation comparisons. Keep outages in the guardrail incident view.
- Count each random session key once per relevant denominator and each `event_key` once. Do not join different session-key purposes.
- Report sample size and confidence intervals. When the detectable effect is larger than the observed difference, classify the result as underpowered/inconclusive rather than no effect.
- Do not compare raw totals across release windows without normalizing by eligible sessions or authoritative accepted/completed payments.
- Keep causal language out of observational dashboards. A correlated change can prioritize investigation but cannot prove why a user acted.

The baseline snapshot must include date range, deployed UI versions, data-availability limitations, known incidents, release changes, and query revision. Store only aggregates in the release evidence record.

## Review cadence and ownership

- Product and engineering review event health after deployment, then daily for the initial seven-day window.
- Engineering owns schema validation, event loss, duplicate-event, and version-quality defects.
- Product owns interpretations and experiment decisions.
- Support owns M10 taxonomy quality and aggregate counts.
- Finance/operations owns the authoritative payment-outcome guardrails.

Retain schema-v2 UX logs only for the approved observability retention period. Access must remain limited to production operators with logging access. Exported aggregate evidence must contain no session keys and must follow the same retention and access controls as release evidence.

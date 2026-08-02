# Abroad Engineering Guide

## Scope and authority

This file is the repository-wide source of truth for agent contributions. It applies to the root project, `abroad-server`, `abroad-ui`, and `docs`.

- Follow the user's current request and higher-priority instructions first.
- Prefer current source code, package manifests, CI workflows, and deployment configuration over narrative documentation when they disagree.
- Do not add nested `AGENTS.md` or `CLAUDE.md` files unless the user explicitly asks for scoped instructions.
- This is a production fintech system. Treat anything involving customer funds, payouts, refunds, trades, custody, authentication, PII, or production infrastructure as high risk.

## Non-negotiable engineering standards

- Produce principal-engineer-quality code: cohesive design, explicit invariants, clear ownership, operational visibility, and proportional tests.
- TypeScript `any` is forbidden, including explicit `any`, `as any`, implicit generic escape hatches, and placeholder callback types. Use `unknown`, runtime validation, narrowing, generics, or precise domain types.
- Do not use `@ts-ignore` or `@ts-nocheck`. A narrowly scoped `@ts-expect-error` is acceptable only in a test that proves an intentional compile-time constraint and includes a reason.
- Do not use non-null assertions. Narrow values or model the invariant in the type system.
- Do not swallow errors, return fabricated success, or hide failures behind fallback values unless the contract explicitly defines that behavior.
- Do not add dead code, speculative abstractions, permanent compatibility shims, or feature flags without a concrete requirement.
- Comments should explain business invariants or non-obvious reasoning, not restate the code.
- Never weaken lint, TypeScript, Jest, Vitest, coverage, Knip, or maintainability settings to make a change pass. Istanbul ignore comments are not allowed.

## Repository topology

The project targets Node.js 22 and uses npm.

- `abroad-server` — npm workspace named `abroad`; TypeScript, Express, TSOA, Prisma, Inversify, Jest.
- `abroad-ui` — npm workspace named `abroad-ui`; React 19, Vite, Orval, Tailwind, Vitest.
- `docs` — separate Docusaurus package with its own lockfile; it is not a root npm workspace.
- `abroad-server/prisma` — schema and immutable migration history.
- `abroad-server/cloud` — backend Cloud Build configuration.
- `abroad-server/k8s` — GKE workers for consumers, listeners, outbox, and bridge sweep.
- `.github/workflows` — pull-request checks and tag-triggered UI/docs releases.

Use the root `package-lock.json` for the server/UI workspaces. Use `docs/package-lock.json` only for the docs package.

## Setup and common commands

Install server/UI dependencies from the repository root:

```bash
npm ci
```

Install docs dependencies only when docs work requires them:

```bash
npm --prefix docs ci
```

Use `npm install` instead of `npm ci` only when intentionally changing dependencies and the appropriate lockfile. Never hand-edit a lockfile.

Local development:

```bash
npm run dev
npm run dev:server
npm run dev:ui
```

The devcontainer provides PostgreSQL and RabbitMQ. Keep local credentials in ignored environment files; never commit `.env` files or credential JSON.

## Backend architecture

Backend modules follow `interfaces -> application -> infrastructure` boundaries under `abroad-server/src/modules`.

- HTTP controllers own transport validation, authentication annotations, and response mapping. Keep them thin.
- Application services own use cases, domain policy, state transitions, and orchestration.
- Infrastructure adapters own provider, database, blockchain, and network details.
- Cross-cutting implementations belong in `src/platform`; composition and dependency injection belong in `src/app/container`.
- Register new controllers, services, providers, queue consumers, and workers in the appropriate container bindings. Do not instantiate production dependencies ad hoc.
- Validate every external payload with Zod or an equivalent explicit schema before using it. Provider SDK or HTTP response types are not proof of runtime shape.
- Map provider errors to stable domain failure categories. Do not expose raw provider responses, internal stack traces, or secrets through public APIs.

### Transactions, flows, and asynchronous work

- Use `TransactionStateMachine` and repository transition methods for transaction status changes. Do not update financial statuses directly when a domain operation exists.
- Flow definitions are snapshotted into durable `FlowInstance`/`FlowStepInstance` records. Preserve step ordering, terminal-state guards, retry metadata, signal correlation, and restart safety.
- Acquire database/distributed locks before making decisions from shared state. Keep database transactions short and execute external HTTP/blockchain calls outside open database transactions.
- State changes and downstream queue/webhook/notification effects must use the durable outbox when they must succeed together.
- Consumers must be idempotent. Duplicate messages, signals, webhooks, provider callbacks, and process restarts are normal operating conditions.
- Use deterministic operation/idempotency keys derived from stable business identifiers. Persist provider operation IDs and reconciliation state before considering an operation complete.
- Never blindly retry an indeterminate financial mutation. Reconcile read-only first using the idempotency key, provider state, application journal, and chain state.

## Financial and provider safety

- Model money with explicit currency, unit, direction, and precision. Do not introduce binary floating-point accounting for new exact-value ledgers; prefer decimal values or integer minor units.
- Validate requested, submitted, received, settled, and refunded amounts independently. A provider HTTP success is not proof of economic settlement.
- A payout, refund, OTC trade, bridge transfer, or on-chain send requires deterministic identity, concurrency protection, durable state, and an auditable external reference.
- Every transaction may have at most one economic outcome per operation. Protect against duplicate payouts, duplicate refunds, double settlement, and payout-plus-refund races.
- `Transaction.refundOnChainId` is the canonical assignment of a completed refund to a transaction. Do not infer per-transaction refund identity solely from equal amount/destination matches.
- Treat rate limits, timeouts, 5xx responses, process termination, and lost responses as ambiguous until reconciled. Retry only when the operation contract proves it is safe.
- Never bypass flow/outbox/reconciliation machinery with a manual database update or an improvised direct provider call.

### Transfero Ultra invariants

- Transfero Ultra is the only Transfero implementation. Do not reintroduce the legacy Transfero API, compatibility fallback, or dual routing.
- Partner-facing APIs must remain provider-agnostic. Internal provider migrations must not require partners to change otherwise stable requests, responses, statuses, or webhook payloads.
- `tax_id` is optional in the public transaction contract. Both dynamic QR and manual PIX-key paths must continue to work without it when the provider payload does not require it.
- Current Ultra vault deposits use Polygon. Current stablecoin-to-BRL conversion uses locked D0 SELL terms and holdings settlement.
- Ultra holdings are shared across customer flows and treasury activity. Preserve the common cross-process lock, available-balance checks, deterministic idempotency, and read-after-write reconciliation.
- Do not call a Transfero mutation again after an ambiguous response. Query the existing session, trade, withdrawal, balance, and application reconciliation state first.

## Public APIs, webhooks, and generated code

- Preserve client-facing compatibility by default. A breaking API or webhook change requires explicit user direction, coordinated documentation, generated-client updates, and migration communication.
- External payloads use the established wire format; do not leak internal camelCase/provider models into partner contracts.
- Authentication and authorization must be explicit in TSOA controller annotations and enforced in application services for sensitive operations.
- Webhook delivery must use the configured target policy, credential mode, durable outbox, bounded retries, and delivery diagnostics.
- Treat dynamic QR and manual-account flows as separate contract cases and test both.

Generated files are build artifacts:

- `abroad-server/src/app/http/routes.ts`
- `abroad-server/src/app/http/swagger.json`
- `abroad-ui/src/api/index.ts`

Do not hand-edit or commit them. Change controllers/contracts, then regenerate through package scripts. When an API contract changes, validate both server generation and the downstream Orval client.

## Database and migrations

- Change `abroad-server/prisma/schema.prisma` and create a new timestamped migration for schema changes.
- Never modify an applied migration. Follow-up corrections require a new migration.
- Review generated SQL for table locks, destructive operations, nullable-to-required transitions, uniqueness failures, precision changes, and production backfill cost.
- Make backfills deterministic, resumable, bounded, and idempotent. Separate large data migrations from latency-sensitive rollout steps when necessary.
- Preserve existing data and audit history unless destructive scope is explicitly authorized. Take a verified backup before an authorized destructive production migration.
- Production deployment runs migrations before API and worker rollout. Code must tolerate the actual rollout ordering and mixed-process window where applicable.

## Frontend architecture and UX

- Keep domain code inside `abroad-ui/src/features`; reusable primitives, hooks, constants, and utilities belong under `src/shared` or the established cross-feature directories.
- Respect ESLint's restricted import zones. Feature components must not reach into unrelated feature internals.
- Keep API transport in the generated client/custom client boundary rather than scattering `fetch` calls through components.
- Keep business orchestration in hooks/controllers and presentation in components. Avoid monolithic components and duplicated transaction logic.
- Preserve React hook dependency correctness, exhaustive switches, wallet/network distinctions, loading/error/empty states, and responsive behavior.
- Do not use inline `style` props. Follow the existing Tailwind/design-token system and accessibility semantics.
- User-visible text should use the established localization approach. Run the Tolgee comparison when translation keys change.
- Never expose secrets or privileged operations through `VITE_*` values; all frontend environment values are public at build/runtime.

## Security, privacy, and observability

- Production secrets come from `ISecretManager`/GCP Secret Manager. Never hardcode, commit, echo, log, screenshot, or persist secret values, private keys, API keys, JWTs, webhook secrets, or service-account keys.
- Do not place credentials in command arguments when a safer stdin/file/secret-manager path exists.
- Logs and reports must minimize PII. Do not emit raw account numbers, PIX keys, tax IDs, QR payloads, wallet addresses, authorization headers, provider bodies, or customer documents. Prefer internal IDs, status codes, boolean comparisons, counts, and redacted suffixes only when necessary.
- Validate URLs and webhook destinations against the existing security policy; prevent SSRF, credential-in-URL, insecure protocol, and unrestricted redirect behavior.
- Use scoped structured logging with stable event names and safe fields. Include correlation/business IDs needed for reconciliation without logging sensitive payloads.
- Use the project's approved observability sources for production diagnosis. Keep queries read-only and PII-minimized, and do not introduce or depend on a new external observability service without explicit authorization.
- Security-sensitive changes require negative tests for authorization, tenant isolation, replay, malformed input, and secret/PII leakage.

## Testing and quality gates

Run the narrowest relevant test while iterating, then the proportional package gates before handoff.

Backend examples:

```bash
npm -w abroad run test -- path/to/test.ts --runInBand
npm -w abroad run typecheck
npm -w abroad run build
npm -w abroad run lint
npm -w abroad run checks:mandatory
```

`checks:mandatory` runs formatting, build, Jest, Knip, and the maintainability report. Because formatting can rewrite files, inspect the worktree first and review its diff afterward. Never allow it to overwrite unrelated user changes.

Frontend examples:

```bash
npm -w abroad-ui run test -- path/to/test.tsx
npm -w abroad-ui run typecheck
npm -w abroad-ui run lint
npm -w abroad-ui run build
```

Documentation:

```bash
npm --prefix docs run typecheck
npm --prefix docs run build
```

Validation expectations:

- Add or update tests for every changed behavior and regression.
- Include happy path, validation failure, provider failure, duplicate/idempotent execution, timeout/ambiguous response, and asynchronous terminal-state coverage when relevant.
- For concurrency-sensitive code, test competing workers/callbacks and restart/retry behavior.
- For API changes, build the backend, regenerate the UI client, test affected server/UI paths, and update Docusaurus reference/workflow docs.
- For migrations, run Prisma generation and validate both a fresh schema and an upgrade path when practical.
- Distinguish failures introduced by the change from established unrelated baseline failures. Do not silently ignore either; report exact commands and outcomes.

## Documentation

- Update `docs` whenever partner integration behavior, authentication, limits, supported assets/networks, status lifecycle, webhooks, or public API fields change.
- Keep operational or architectural documentation synchronized with source. Remove stale instructions rather than adding contradictory notes.
- Never include real credentials, production payloads, customer data, or unsanitized logs in documentation, fixtures, reports, or examples.

## Git and change hygiene

- Inspect `git status` before editing. Existing modifications and untracked files belong to the user unless clearly created by the current task.
- Change only files required by the request. Do not clean, format, stage, revert, or delete unrelated work.
- Never use destructive Git commands such as `git reset --hard`, force-push, or broad checkout/revert operations without explicit authorization.
- Use conventional commit subjects such as `feat(scope): ...` or `fix(scope): ...` and commit only when requested.
- Do not merge, push, create a release tag, deploy, or mutate production merely because code is locally complete; those actions require user authorization or explicit task scope.
- Temporary helpers, credentials, kubeconfigs, generated reports, and planning artifacts must stay ignored, permission-restricted where sensitive, and be removed when no longer needed.

## Production operations and releases

- Diagnose read-only by default. A request to inspect or fix code does not authorize a payout, refund, trade, settlement, on-chain transfer, webhook replay, customer-data change, IAM change, or deployment.
- Financial production mutations require explicit authorization naming the exact operation, identifiers, asset/currency, and maximum amount. Re-run a fresh idempotency and state preflight immediately before execution.
- Use an explicitly approved, least-privilege cloud identity and project context for authorized production work. Never infer the target from defaults, change a user's default cloud profile or kubeconfig, or persist credentials in the repository; use task-scoped configuration files when cluster access is needed.
- Production releases are driven by annotated semantic-version tags. The tagged commit must already be contained in `main`.
- Create and push a tag only when explicitly asked to release. Use the next intended sequential version and an annotated `Release <version>: <summary>` message.
- A release is not done when the tag is pushed. Verify every triggered workflow, migration, deployed runtime, health check, public endpoint, and relevant PII-minimized log signal for the released commit.
- If a rollout or financial mutation becomes ambiguous, stop further mutation and reconcile authoritative external and internal state before deciding whether any retry is safe.
- Do not call work “done” when the user's requested deployment or release has not completed successfully.

## Working method and definition of done

For complex work, maintain the gitignored `task_plan.md`, `findings.md`, and `progress.md` files. Record decisions, evidence, validation, and errors as the work proceeds; do not put secrets or raw PII in them.

Before handing off:

1. Re-read the request and verify every requirement against the final diff.
2. Confirm architectural boundaries, client compatibility, financial invariants, idempotency, security, and observability.
3. Run proportional focused and package-level validation and report exact results.
4. Review generated artifacts, migrations, documentation, and release impact where relevant.
5. Inspect `git status` and the complete diff; preserve all unrelated user files.
6. Remove only task-created temporary artifacts and credentials.
7. If release was requested, verify production convergence and behavior before declaring completion.

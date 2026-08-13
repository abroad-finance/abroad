import {
  AlertTriangle,
  Check,
  Clipboard,
  Download,
  ExternalLink,
  FileCheck2,
  GitBranch,
  RadioTower,
  RefreshCw,
  ShieldAlert,
  UserRoundSearch,
} from 'lucide-react'
import {
  useCallback,
  useEffect,
  useState,
} from 'react'
import { Link, useParams } from 'react-router-dom'

import type { OpsKycTransactionLink } from '../../services/admin/kycAdminTypes'
import type {
  OpsRefundRecovery,
  OpsTransactionDetail as OpsTransactionDetailData,
  TransactionStatus,
} from '../../services/admin/transactionAdminTypes'

import { getTransactionKycLink } from '../../services/admin/kycAdminApi'
import { useOpsApiKey, useOpsSession } from '../../services/admin/opsAuthStore'
import { listOpsCaseOwners } from '../../services/admin/opsInvestigationApi'
import {
  classifyOpsTelemetryFailure,
  getOpsTelemetryViewport,
  recordOpsTaskEvent,
} from '../../services/admin/opsTaskTelemetry'
import {
  exportTransactionEvidence,
  getRefundRecovery,
  getTransaction,
  getTransactionReceipt,
} from '../../services/admin/transactionAdminApi'
import { kycSubmissionPath } from './kyc/kycLinks'
import {
  formatAmount,
  formatDateTime,
  humanizeStatus,
  OpsBanner,
  OpsLoading,
  OpsPageShell,
  OpsStatusBadge,
  OpsTone,
} from './shared'
import CaseWorkspace from './transactions/CaseWorkspace'
import CustomerIdentityPanel from './transactions/CustomerIdentityPanel'
import EvidenceTimeline from './transactions/EvidenceTimeline'
import RefundRecoveryPanel from './transactions/RefundRecoveryPanel'

const statusTone: Readonly<Record<TransactionStatus, OpsTone>> = {
  AWAITING_PAYMENT: 'warning',
  PAYMENT_COMPLETED: 'success',
  PAYMENT_EXPIRED: 'neutral',
  PAYMENT_FAILED: 'danger',
  PROCESSING_PAYMENT: 'info',
  WRONG_AMOUNT: 'danger',
}

const downloadBlob = (blob: Blob, fileName: string): void => {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.download = fileName
  anchor.href = url
  anchor.click()
  URL.revokeObjectURL(url)
}

const downloadBase64Pdf = (contentBase64: string, fileName: string): void => {
  const binary = window.atob(contentBase64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  downloadBlob(new Blob([bytes], { type: 'application/pdf' }), fileName)
}

const CopyIdentifier = ({ label, value }: { label: string, value: null | string }) => {
  const [copied, setCopied] = useState(false)
  if (!value) return <span className="text-ops-muted">Not recorded</span>
  return (
    <span className="flex min-w-0 items-center gap-2">
      <span className="min-w-0 flex-1 truncate font-mono text-xs" title={value}>{value}</span>
      <button
        aria-label={`Copy ${label}`}
        className="ops-icon-btn shrink-0"
        onClick={() => {
          void navigator.clipboard.writeText(value).then(() => {
            setCopied(true)
            window.setTimeout(() => setCopied(false), 1_500)
          })
        }}
        type="button"
      >
        {copied ? <Check aria-hidden size={15} /> : <Clipboard aria-hidden size={15} />}
      </button>
    </span>
  )
}

const DetailField = ({ children, label }: { children: React.ReactNode, label: string }) => (
  <div className="min-w-0">
    <dt className="ops-label">{label}</dt>
    <dd className="mt-1.5 min-w-0 text-sm font-medium text-ops-text">{children}</dd>
  </div>
)

const TransactionDetail = () => {
  const { transactionId } = useParams()
  const [data, setData] = useState<null | OpsTransactionDetailData>(null)
  const [identity, setIdentity] = useState<null | OpsKycTransactionLink>(null)
  const [identityError, setIdentityError] = useState<null | string>(null)
  const [refundRecovery, setRefundRecovery] = useState<null | OpsRefundRecovery>(null)
  const [refundRecoveryError, setRefundRecoveryError] = useState<null | string>(null)
  const [owners, setOwners] = useState<Awaited<ReturnType<typeof listOpsCaseOwners>>>([])
  const [loading, setLoading] = useState(false)
  const [operation, setOperation] = useState<'diagnostics' | 'evidence' | 'receipt' | null>(null)
  const [error, setError] = useState<null | string>(null)
  const [notice, setNotice] = useState<null | string>(null)
  const opsApiKey = useOpsApiKey()
  const session = useOpsSession()
  const canManageCases = Boolean(session?.kind === 'ops_user' && session.permissions.includes('cases:manage'))
  const canReadProof = Boolean(session?.kind === 'ops_user' && session.permissions.includes('transactions:proof'))
  const canExport = Boolean(session?.kind === 'ops_user' && session.permissions.includes('transactions:export'))
  const canRecoverRefund = Boolean(session?.kind === 'ops_user' && session.permissions.includes('transactions:refund'))
  const canReadKyc = Boolean(session?.kind === 'ops_user' && session.permissions.includes('kyc:read'))

  const load = useCallback(async (signal?: AbortSignal): Promise<void> => {
    if (!transactionId || !opsApiKey) {
      setData(null)
      setIdentity(null)
      setIdentityError(null)
      setRefundRecovery(null)
      setRefundRecoveryError(null)
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const [
        transactionResult,
        recoveryResult,
        identityResult,
      ] = await Promise.allSettled([
        getTransaction(transactionId, signal),
        getRefundRecovery(transactionId, signal),
        canReadKyc ? getTransactionKycLink(transactionId, signal) : Promise.resolve(null),
      ])
      if (signal?.aborted) return
      if (transactionResult.status === 'rejected') throw transactionResult.reason
      setData(transactionResult.value)
      if (recoveryResult.status === 'fulfilled') {
        setRefundRecovery(recoveryResult.value)
        setRefundRecoveryError(null)
      }
      else {
        setRefundRecovery(null)
        setRefundRecoveryError(recoveryResult.reason instanceof Error
          ? recoveryResult.reason.message
          : 'Refund recovery evidence is unavailable')
      }
      if (identityResult.status === 'fulfilled') {
        setIdentity(identityResult.value)
        setIdentityError(null)
      }
      else {
        setIdentity(null)
        setIdentityError(identityResult.reason instanceof Error
          ? identityResult.reason.message
          : 'Customer identity linkage is unavailable')
      }
    }
    catch (loadError) {
      if (!signal?.aborted) setError(loadError instanceof Error ? loadError.message : 'Failed to load transaction')
    }
    finally {
      if (!signal?.aborted) setLoading(false)
    }
  }, [
    canReadKyc,
    opsApiKey,
    transactionId,
  ])

  useEffect(() => {
    const controller = new AbortController()
    void load(controller.signal)
    return () => controller.abort()
  }, [load])

  useEffect(() => {
    if (session?.kind !== 'ops_user') {
      setOwners([])
      return undefined
    }
    let active = true
    void listOpsCaseOwners()
      .then((result) => {
        if (active) setOwners(result)
      })
      .catch(() => {
        if (active) setOwners([])
      })
    return () => {
      active = false
    }
  }, [session?.kind])

  const downloadReceipt = async (): Promise<void> => {
    if (!transactionId) return
    const startedAt = Date.now()
    const viewport = getOpsTelemetryViewport()
    recordOpsTaskEvent({
      action: 'REQUESTED',
      metadata: { entryPoint: 'TRANSACTION', viewport },
      result: 'SUCCEEDED',
      task: 'PROOF_RETRIEVAL',
    })
    setOperation('receipt')
    setError(null)
    setNotice(null)
    try {
      const receipt = await getTransactionReceipt(transactionId)
      downloadBase64Pdf(receipt.contentBase64, receipt.fileName)
      setNotice('The audited PIX receipt was downloaded.')
      recordOpsTaskEvent({
        action: 'COMPLETED',
        durationMs: Math.min(60 * 60 * 1_000, Date.now() - startedAt),
        metadata: { entryPoint: 'TRANSACTION', viewport },
        result: 'SUCCEEDED',
        task: 'PROOF_RETRIEVAL',
      })
    }
    catch (receiptError) {
      setError(receiptError instanceof Error ? receiptError.message : 'PIX receipt is unavailable')
      recordOpsTaskEvent({
        action: 'COMPLETED',
        durationMs: Math.min(60 * 60 * 1_000, Date.now() - startedAt),
        metadata: {
          entryPoint: 'TRANSACTION',
          failureClass: classifyOpsTelemetryFailure(receiptError),
          viewport,
        },
        result: 'FAILED',
        task: 'PROOF_RETRIEVAL',
      })
    }
    finally {
      setOperation(null)
    }
  }

  const getEvidence = async (copy: boolean): Promise<void> => {
    if (!transactionId) return
    setOperation(copy ? 'diagnostics' : 'evidence')
    setError(null)
    setNotice(null)
    try {
      const evidence = await exportTransactionEvidence(transactionId)
      const serialized = JSON.stringify(evidence, null, 2)
      if (copy) {
        await navigator.clipboard.writeText(serialized)
        setNotice('Audited PII-minimized diagnostics copied to the clipboard.')
      }
      else {
        downloadBlob(new Blob([serialized], { type: 'application/json' }), `abroad-ops-evidence-${transactionId}.json`)
        setNotice('Audited transaction evidence was downloaded.')
      }
    }
    catch (evidenceError) {
      setError(evidenceError instanceof Error ? evidenceError.message : 'Transaction evidence is unavailable')
    }
    finally {
      setOperation(null)
    }
  }

  const reloadAfterCaseChange = async (): Promise<void> => {
    await load()
  }

  const reloadAfterRefundChange = async (next: OpsRefundRecovery): Promise<void> => {
    setRefundRecovery(next)
    await load()
  }

  // An onramp runs the corridor the other way, so the two legs, the delivery
  // destination and the provider's role all swap meaning on this page.
  const isOnramp = data?.quote.direction === 'FIAT_TO_CRYPTO'

  return (
    <OpsPageShell
      actions={data
        ? (
            <>
              {identity?.effectiveSubmissionId && (
                <Link className="ops-btn-neutral min-h-11" to={kycSubmissionPath(identity.effectiveSubmissionId)}>
                  <UserRoundSearch aria-hidden size={16} />
                  View KYC
                </Link>
              )}
              {data.identifiers.flowInstanceId && (
                <Link className="ops-btn-neutral min-h-11" to={`/ops/flows/${encodeURIComponent(data.identifiers.flowInstanceId)}`}>
                  <GitBranch aria-hidden size={16} />
                  View execution flow
                </Link>
              )}
              <button className="ops-btn-ghost min-h-11" disabled={loading} onClick={() => void load()} type="button">
                <RefreshCw aria-hidden size={16} />
                Refresh evidence
              </button>
            </>
          )
        : undefined}
      backLink={{ label: 'Back to transaction investigations', to: '/ops/transactions' }}
      error={error}
      eyebrow="Work · Transaction case"
      keyRequiredMessage="Sign in to investigate this transaction."
      subtitle={data?.summary ?? 'Review canonical transaction evidence without exposing recipient details.'}
      title={data
        ? isOnramp
          ? `${formatAmount(data.quote.sourceAmount)} ${data.quote.cryptoCurrency} onramp`
          : `${formatAmount(data.quote.targetAmount)} ${data.quote.targetCurrency} payout`
        : <span className="break-all">{transactionId}</span>}
      width="full"
    >
      {notice && <OpsBanner className="mt-5" variant="success">{notice}</OpsBanner>}
      {loading && !data && opsApiKey && <OpsLoading label="Loading transaction evidence…" />}

      {data && (
        <div className="mt-7 space-y-6">
          <section aria-label="Transaction posture" className="ops-card overflow-hidden">
            <div className="grid gap-6 p-5 sm:p-6 lg:grid-cols-[1.2fr_0.8fr]">
              <div>
                <div className="flex flex-wrap items-center gap-3">
                  <OpsStatusBadge label={humanizeStatus(data.status)} tone={statusTone[data.status]} />
                  <OpsStatusBadge label={isOnramp ? 'Onramp' : 'Payout'} tone={isOnramp ? 'info' : 'neutral'} />
                  <span className="text-xs font-semibold text-ops-muted">
                    {data.provider.label}
                    {' '}
                    ·
                    {' '}
                    {data.partner.name}
                  </span>
                </div>
                <div className="mt-5 flex flex-col gap-5 sm:flex-row sm:items-center">
                  <div>
                    <p className="text-2xl font-semibold text-ops-text">
                      {formatAmount(data.quote.sourceAmount)}
                      {' '}
                      {data.quote.cryptoCurrency}
                    </p>
                    <p className="mt-1 text-xs text-ops-muted">
                      {isOnramp ? 'Delivered on' : 'Received on'}
                      {' '}
                      {humanizeStatus(data.quote.network)}
                    </p>
                  </div>
                  <div aria-hidden className="ops-route-divider hidden sm:block" />
                  <div className="sm:text-right">
                    <p className="text-2xl font-semibold text-ops-brand">
                      {formatAmount(data.quote.targetAmount)}
                      {' '}
                      {data.quote.targetCurrency}
                    </p>
                    <p className="mt-1 text-xs text-ops-muted">
                      {isOnramp ? 'Collected via' : 'Payout via'}
                      {' '}
                      {data.provider.label}
                    </p>
                  </div>
                </div>
              </div>
              <div className="rounded-2xl border border-ops-border bg-ops-bg/70 p-4">
                <p className="ops-label">Current operational posture</p>
                <p className="mt-2 text-lg font-semibold text-ops-text">{data.latestEvent.title}</p>
                <p className="mt-1 text-sm leading-6 text-ops-muted">{data.latestEvent.description}</p>
                <p className="mt-3 text-xs text-ops-muted">
                  Age
                  {' '}
                  {data.sla.ageMinutes}
                  m
                  {data.sla.targetMinutes ? ` · Target ${data.sla.targetMinutes}m` : ''}
                </p>
              </div>
            </div>

            <dl className="grid gap-5 border-t border-ops-border p-5 sm:grid-cols-2 sm:p-6 lg:grid-cols-4">
              <DetailField label="Created">{formatDateTime(data.createdAt)}</DetailField>
              <DetailField label="Partner">{data.partner.name}</DetailField>
              <DetailField label={isOnramp ? 'Delivery destination' : 'Payout destination'}>{data.payoutDestinationHint ?? 'Not recorded'}</DetailField>
              <DetailField label="Proof state">{humanizeStatus(data.proof.status)}</DetailField>
              <DetailField label="Refund state">{humanizeStatus(data.refund.status)}</DetailField>
              <DetailField label="Webhook state">
                {humanizeStatus(data.webhook.status)}
                {' '}
                ·
                {' '}
                {data.webhook.attempts}
                {' '}
                attempt
                {data.webhook.attempts === 1 ? '' : 's'}
              </DetailField>
              <DetailField label="Flow state">{data.flow ? humanizeStatus(data.flow.status) : 'No flow linked'}</DetailField>
              <DetailField label="Case owner">{data.case?.owner?.displayName ?? data.case?.team ?? 'No case owner'}</DetailField>
            </dl>
          </section>

          {data.failure && (
            <section aria-labelledby="failure-guidance-title" className="rounded-2xl border border-rose-200 bg-rose-50 p-5 sm:p-6">
              <div className="flex gap-3">
                <ShieldAlert aria-hidden className="mt-0.5 shrink-0 text-rose-700" size={22} />
                <div>
                  <p className="ops-eyebrow text-rose-700">
                    Normalized failure ·
                    {' '}
                    {humanizeStatus(data.failure.category)}
                  </p>
                  <h2 className="mt-1 text-lg font-semibold text-rose-950" id="failure-guidance-title">{data.failure.label}</h2>
                  <p className="mt-2 text-sm leading-6 text-rose-900">{data.failure.recommendedAction}</p>
                  {data.failure.ambiguityWarning && (
                    <p className="mt-3 flex gap-2 rounded-xl border border-rose-200 bg-white/65 p-3 text-sm text-rose-900">
                      <AlertTriangle aria-hidden className="mt-0.5 shrink-0" size={16} />
                      {data.failure.ambiguityWarning}
                    </p>
                  )}
                </div>
              </div>
            </section>
          )}

          {refundRecoveryError && (
            <OpsBanner variant="warning">
              Refund recovery controls are unavailable:
              {' '}
              {refundRecoveryError}
            </OpsBanner>
          )}

          {refundRecovery && refundRecovery.status !== 'NOT_REQUIRED' && (
            <RefundRecoveryPanel
              canRecover={canRecoverRefund}
              onChanged={reloadAfterRefundChange}
              recovery={refundRecovery}
            />
          )}

          <div className="grid gap-6 xl:grid-cols-[minmax(0,1.3fr)_minmax(20rem,0.7fr)]">
            <EvidenceTimeline events={data.evidence} />

            <div className="space-y-6">
              <CustomerIdentityPanel
                identity={identity}
                loadError={identityError}
                permitted={canReadKyc}
              />

              <section aria-labelledby="proof-title" className="ops-card p-5 sm:p-6">
                <div className="flex items-center gap-2 text-ops-brand">
                  <FileCheck2 aria-hidden size={18} />
                  <h2 className="text-lg font-semibold text-ops-text" id="proof-title">Completion proof</h2>
                </div>
                <p className="mt-2 text-sm leading-6 text-ops-muted">
                  PIX E2E state is local evidence. Receipt retrieval makes a bounded, audited provider request.
                </p>
                <div className="mt-4 space-y-3">
                  <div className="rounded-xl border border-ops-border bg-ops-bg/60 p-3">
                    <p className="ops-label">PIX end-to-end ID</p>
                    <div className="mt-1.5"><CopyIdentifier label="PIX end-to-end ID" value={data.identifiers.pixEndToEndId} /></div>
                  </div>
                  <div className="grid gap-2">
                    {data.proof.receiptEligible && (
                      <button className="ops-btn-primary min-h-11 w-full" disabled={!canReadProof || operation !== null} onClick={() => void downloadReceipt()} type="button">
                        <Download aria-hidden size={16} />
                        {operation === 'receipt' ? 'Retrieving receipt…' : 'Download audited PIX receipt'}
                      </button>
                    )}
                    <button className="ops-btn-neutral min-h-11 w-full" disabled={!canExport || operation !== null} onClick={() => void getEvidence(false)} type="button">
                      <Download aria-hidden size={16} />
                      {operation === 'evidence' ? 'Preparing evidence…' : 'Download safe evidence JSON'}
                    </button>
                    <button className="ops-btn-neutral min-h-11 w-full" disabled={!canExport || operation !== null} onClick={() => void getEvidence(true)} type="button">
                      <Clipboard aria-hidden size={16} />
                      {operation === 'diagnostics' ? 'Copying diagnostics…' : 'Copy safe diagnostics'}
                    </button>
                  </div>
                  {session?.kind !== 'ops_user' && <OpsBanner variant="warning">Named Ops identity is required for proof and evidence access.</OpsBanner>}
                </div>
              </section>

              <section aria-labelledby="identifiers-title" className="ops-card p-5 sm:p-6">
                <h2 className="text-lg font-semibold text-ops-text" id="identifiers-title">Operational identifiers</h2>
                <p className="mt-1 text-sm text-ops-muted">Secondary evidence for correlation and provider support.</p>
                <dl className="mt-4 space-y-4">
                  <DetailField label="Transaction ID"><CopyIdentifier label="transaction ID" value={data.identifiers.transactionId} /></DetailField>
                  <DetailField label="Quote ID"><CopyIdentifier label="quote ID" value={data.identifiers.quoteId} /></DetailField>
                  <DetailField label="On-chain ID"><CopyIdentifier label="on-chain ID" value={data.identifiers.onChainId} /></DetailField>
                  <DetailField label="Provider reference"><CopyIdentifier label="provider reference" value={data.identifiers.externalId} /></DetailField>
                  <DetailField label="Refund on-chain ID"><CopyIdentifier label="refund ID" value={data.identifiers.refundOnChainId} /></DetailField>
                  {/* Onramp-only. Both stay null on a payout, where the
                      destination is a bank account and the customer funds the
                      transaction on chain instead. */}
                  {data.identifiers.destinationAddress && (
                    <DetailField label="Destination wallet"><CopyIdentifier label="destination wallet" value={data.identifiers.destinationAddress} /></DetailField>
                  )}
                  {data.identifiers.pixDepositId && (
                    <DetailField label="PIX deposit ID"><CopyIdentifier label="PIX deposit ID" value={data.identifiers.pixDepositId} /></DetailField>
                  )}
                  <DetailField label="Flow ID"><CopyIdentifier label="flow ID" value={data.identifiers.flowInstanceId} /></DetailField>
                </dl>
              </section>

              <section aria-labelledby="webhook-title" className="ops-card p-5 sm:p-6">
                <div className="flex items-center gap-2">
                  <RadioTower aria-hidden className="text-ops-brand" size={18} />
                  <h2 className="text-lg font-semibold text-ops-text" id="webhook-title">Partner notifications</h2>
                </div>
                {data.webhookDeliveries.length === 0
                  ? <p className="mt-3 text-sm text-ops-muted">No webhook delivery record is linked.</p>
                  : (
                      <ul className="mt-4 space-y-3">
                        {data.webhookDeliveries.map(delivery => (
                          <li className="rounded-xl border border-ops-border bg-ops-bg/60 p-3" key={delivery.id}>
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <span className="text-sm font-semibold text-ops-text">{humanizeStatus(delivery.event)}</span>
                              <OpsStatusBadge label={humanizeStatus(delivery.status)} tone={delivery.status === 'DELIVERED' ? 'success' : delivery.status === 'FAILED' ? 'danger' : 'warning'} />
                            </div>
                            <p className="mt-2 text-xs text-ops-muted">
                              {delivery.attempts}
                              {' '}
                              attempt
                              {delivery.attempts === 1 ? '' : 's'}
                              {delivery.httpStatus ? ` · HTTP ${delivery.httpStatus}` : ''}
                              {delivery.durationMs ? ` · ${delivery.durationMs}ms` : ''}
                              {' · '}
                              {formatDateTime(delivery.occurredAt)}
                            </p>
                          </li>
                        ))}
                      </ul>
                    )}
              </section>
            </div>
          </div>

          <CaseWorkspace
            canManage={canManageCases}
            caseItem={data.case}
            onChanged={reloadAfterCaseChange}
            owners={owners}
            transactionId={data.id}
          />

          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-ops-border bg-white/70 p-4 text-sm text-ops-muted">
            <span>Reconciliation repairs evidence intake; it does not itself issue a payout or refund.</span>
            <Link className="inline-flex items-center gap-1.5 font-semibold text-ops-brand" to={`/ops/transactions/reconcile?transactionId=${encodeURIComponent(data.id)}`}>
              Review reconciliation
              <ExternalLink aria-hidden size={15} />
            </Link>
          </div>
        </div>
      )}
    </OpsPageShell>
  )
}

export default TransactionDetail

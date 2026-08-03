import { RefreshCw } from 'lucide-react'
import {
  useCallback, useEffect, useRef, useState,
} from 'react'

import type {
  BusinessPerformanceRange,
  BusinessPerformanceRequest,
  BusinessPerformanceResponse,
} from '../../services/admin/businessPerformanceTypes'
import type { ComparisonMode } from './business-performance/BusinessPerformanceControls'
import type { BusinessPerformancePreset } from './business-performance/businessPerformanceRanges'

import { getBusinessPerformance } from '../../services/admin/businessPerformanceAdminApi'
import { useOpsApiKey } from '../../services/admin/opsAuthStore'
import { BusinessPerformanceControls } from './business-performance/BusinessPerformanceControls'
import {
  formatUtcRange,
  isValidHalfOpenRange,
  previousEqualRange,
  rangeForPreset,
} from './business-performance/businessPerformanceRanges'
import { BusinessPerformanceTable } from './business-performance/BusinessPerformanceTable'
import {
  OpsBanner, OpsEmptyState, OpsLoading, OpsPageShell,
} from './shared'

const initialPrimary = rangeForPreset('TODAY')

const formatUtcTimestamp = (value: string): string => (
  new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'medium',
    timeZone: 'UTC',
  }).format(new Date(value)) + ' UTC'
)

const BusinessPerformance = () => {
  const opsApiKey = useOpsApiKey()
  const [applied, setApplied] = useState<BusinessPerformanceRequest>({ primary: initialPrimary })
  const [comparison, setComparison] = useState<BusinessPerformanceRange>(previousEqualRange(initialPrimary))
  const [comparisonMode, setComparisonMode] = useState<ComparisonMode>('PREVIOUS_EQUAL')
  const [controlError, setControlError] = useState<null | string>(null)
  const [error, setError] = useState<null | string>(null)
  const [loading, setLoading] = useState(false)
  const [preset, setPreset] = useState<BusinessPerformancePreset>('TODAY')
  const [primary, setPrimary] = useState<BusinessPerformanceRange>(initialPrimary)
  const [report, setReport] = useState<BusinessPerformanceResponse | null>(null)
  const requestSequence = useRef(0)

  const load = useCallback(async () => {
    const requestId = ++requestSequence.current
    if (!opsApiKey) {
      setError(null)
      setLoading(false)
      setReport(null)
      return
    }
    setError(null)
    setLoading(true)
    try {
      const response = await getBusinessPerformance(applied)
      if (requestId === requestSequence.current) setReport(response)
    }
    catch (loadError) {
      if (requestId === requestSequence.current) {
        setError(loadError instanceof Error ? loadError.message : 'Failed to load business performance')
      }
    }
    finally {
      if (requestId === requestSequence.current) setLoading(false)
    }
  }, [applied, opsApiKey])

  useEffect(() => {
    void load()
    return () => {
      requestSequence.current += 1
    }
  }, [load])

  const changePreset = (next: BusinessPerformancePreset): void => {
    setPreset(next)
    setControlError(null)
    if (next === 'CUSTOM') return
    const range = rangeForPreset(next)
    setPrimary(range)
    if (comparisonMode === 'PREVIOUS_EQUAL') setComparison(previousEqualRange(range))
  }

  const apply = (): void => {
    const nextPrimary = preset === 'CUSTOM' ? primary : rangeForPreset(preset)
    const nextComparison = comparisonMode === 'CUSTOM'
      ? comparison
      : previousEqualRange(nextPrimary)
    if (!isValidHalfOpenRange(nextPrimary) || !isValidHalfOpenRange(nextComparison)) {
      setControlError('Each UTC range must be positive and no longer than 366 days.')
      return
    }
    setControlError(null)
    setPrimary(nextPrimary)
    setComparison(nextComparison)
    setApplied({
      ...(comparisonMode === 'CUSTOM' ? { comparison: nextComparison } : {}),
      primary: nextPrimary,
    })
  }

  const primaryIsEmpty = report
    ? report.current.quoteRequests === 0 && report.current.acceptedTransactions === 0
    : false
  const comparisonIsEmpty = report
    ? report.comparison.quoteRequests === 0 && report.comparison.acceptedTransactions === 0
    : false
  const isEmpty = primaryIsEmpty && comparisonIsEmpty
  const coverageWarnings = report
    ? [...report.coverage.quotes.warnings, ...report.coverage.earnings.warnings]
    : []

  return (
    <OpsPageShell
      actions={(
        <button className="ops-btn-ghost" disabled={!opsApiKey || loading} onClick={() => void load()} type="button">
          <RefreshCw aria-hidden className={loading ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
          {loading && report ? 'Refreshing' : 'Refresh'}
        </button>
      )}
      error={error}
      eyebrow="Finance & Operations"
      keyRequiredMessage="Ops authentication is required to load aggregate business performance."
      subtitle="UTC-only transaction economics, payout performance, and earnings coverage—aggregated without customer data or synchronous provider calls."
      title="Business Performance"
      width="full"
    >
      <BusinessPerformanceControls
        comparison={comparison}
        comparisonMode={comparisonMode}
        disabled={loading || !opsApiKey}
        error={controlError}
        onApply={apply}
        onComparisonChange={setComparison}
        onComparisonModeChange={(mode) => {
          setComparisonMode(mode)
          if (mode === 'PREVIOUS_EQUAL') setComparison(previousEqualRange(primary))
        }}
        onPresetChange={changePreset}
        onPrimaryChange={setPrimary}
        preset={preset}
        primary={primary}
      />

      {loading && opsApiKey && !report && (
        <OpsLoading className="mt-8" label="Aggregating business performance…" />
      )}

      {report && (
        <div className="mt-5 space-y-4">
          <section aria-label="Applied reporting metadata" className="ops-card grid gap-4 p-5 text-sm lg:grid-cols-3">
            <div>
              <div className="ops-eyebrow">Primary range</div>
              <p className="mt-1 break-words font-mono text-xs text-ops-text">{formatUtcRange(report.ranges.primary)}</p>
            </div>
            <div>
              <div className="ops-eyebrow">Comparison range</div>
              <p className="mt-1 break-words font-mono text-xs text-ops-text">{formatUtcRange(report.ranges.comparison)}</p>
            </div>
            <div>
              <div className="ops-eyebrow">Last updated</div>
              <p className="mt-1 text-ops-text">
                {report.coverage.economicFactsReconciledAt
                  ? formatUtcTimestamp(report.coverage.economicFactsReconciledAt)
                  : 'Economic facts not yet reconciled'}
              </p>
              <p className="mt-1 text-xs text-ops-muted">
                Report generated
                {' '}
                {formatUtcTimestamp(report.generatedAt)}
              </p>
              <p className="mt-1 text-xs text-ops-muted">
                Earnings coverage:
                {' '}
                <span className="font-semibold">{report.coverage.earnings.status}</span>
              </p>
              <p className="mt-1 text-xs text-ops-muted">
                Historical backfill:
                {' '}
                <span className="font-semibold">
                  {report.coverage.earnings.historicalBackfillCompletedAt ? 'complete' : 'in progress'}
                </span>
              </p>
            </div>
          </section>

          {coverageWarnings.length > 0 && (
            <OpsBanner variant="warning">
              <div className="font-semibold">
                {report.coverage.earnings.status === 'COMPLETE'
                  ? 'Coverage warnings'
                  : 'Partial earnings coverage'}
              </div>
              <ul className="mt-1 list-disc space-y-1 pl-5">
                {[...new Set(coverageWarnings)].map(warning => <li key={warning}>{warning}</li>)}
              </ul>
              {report.coverage.economicFactsReconciledAt && (
                <p className="mt-2 text-xs">
                  Economic facts last reconciled
                  {' '}
                  {formatUtcTimestamp(report.coverage.economicFactsReconciledAt)}
                  .
                </p>
              )}
            </OpsBanner>
          )}

          {report.coverage.quotes.pendingRequestCount > 0 && (
            <OpsBanner variant="info">
              {report.coverage.quotes.pendingRequestCount}
              {' '}
              quote request(s) are still awaiting a terminal HTTP outcome.
            </OpsBanner>
          )}

          {primaryIsEmpty && !comparisonIsEmpty && (
            <OpsBanner variant="info">
              The primary range has no quote or transaction activity; comparison values remain available below.
            </OpsBanner>
          )}

          {isEmpty
            ? <OpsEmptyState>No quote or transaction activity exists in the selected primary UTC range.</OpsEmptyState>
            : <BusinessPerformanceTable metrics={report.metrics} />}

          <p className="text-xs leading-5 text-ops-muted">
            USDC and USDT are reported nominally in USD. Native payout and Ultra amounts remain separated by currency; BRL and COP are never combined.
            Net earnings recognize revenue only from completed payouts with reconciled settled-conversion economics and subtract confirmed costs across the selected transaction cohort.
            When coverage is partial, unresolved required costs are excluded—not treated as zero—and the value may decrease after reconciliation; completed payouts awaiting conversion settlement remain visible separately.
          </p>
        </div>
      )}
    </OpsPageShell>
  )
}

export default BusinessPerformance

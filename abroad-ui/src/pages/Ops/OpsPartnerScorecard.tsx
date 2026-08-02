import {
  Activity,
  ArrowRight,
  BellRing,
  Cable,
  KeyRound,
  ReceiptText,
} from 'lucide-react'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  Link,
  useParams,
  useSearchParams,
} from 'react-router-dom'

import type {
  OpsPartnerAnalyticsRange,
  OpsPartnerScorecard,
} from '../../services/admin/partnerAnalyticsTypes'

import { useOpsApiKey, useOpsSession } from '../../services/admin/opsAuthStore'
import { getOpsPartnerScorecard } from '../../services/admin/partnerAnalyticsAdminApi'
import {
  formatAmount,
  formatDateTime,
  formatMoney,
  humanizeStatus,
  OpsEmptyState,
  OpsLoading,
  OpsPageShell,
  OpsStatusBadge,
} from './shared'

const ranges: Array<{ label: string, value: OpsPartnerAnalyticsRange }> = [
  { label: '24 hours', value: '24h' },
  { label: '7 days', value: '7d' },
  { label: '30 days', value: '30d' },
  { label: '90 days', value: '90d' },
]

const isRange = (value: null | string): value is OpsPartnerAnalyticsRange => ranges.some(range => range.value === value)

const CurrencyList = ({ amounts }: { amounts: Array<{ amount: number, currency: string }> }) => (
  <div className="mt-2 flex flex-wrap gap-1.5">
    {amounts.length === 0
      ? <span className="text-sm text-ops-muted">No completed volume</span>
      : amounts.map(amount => (
          <span className="rounded-full border border-ops-border bg-white px-2 py-1 text-xs font-semibold tabular-nums" key={amount.currency}>
            {formatMoney(amount.amount, amount.currency)}
          </span>
        ))}
  </div>
)

const PartnerTrend = ({ scorecard }: { scorecard: OpsPartnerScorecard }) => {
  const maximum = Math.max(1, ...scorecard.trend.map(point => point.total))
  const total = scorecard.trend.reduce((sum, point) => sum + point.total, 0)

  if (scorecard.trend.length === 0) {
    return <OpsEmptyState className="mt-4 py-8">No transaction activity in this window. Select a longer window or inspect all transactions.</OpsEmptyState>
  }

  return (
    <div className="mt-4">
      <svg
        aria-label={`Partner activity trend with ${total} transactions`}
        className="h-44 w-full rounded-xl border border-ops-border bg-ops-bg"
        preserveAspectRatio="none"
        role="img"
        viewBox="0 0 720 160"
      >
        <line stroke="#d6d3d1" x1="20" x2="700" y1="145" y2="145" />
        {scorecard.trend.map((point, index) => {
          const band = 680 / scorecard.trend.length
          const width = Math.max(2, Math.min(20, band * 0.7))
          const x = 20 + index * band + (band - width) / 2
          const completedHeight = (point.completed / maximum) * 125
          const openHeight = (point.open / maximum) * 125
          const failedHeight = (point.failed / maximum) * 125
          return (
            <g key={point.at}>
              <title>{`${formatDateTime(point.at)} · ${point.total} transactions`}</title>
              <rect fill="#10b981" height={completedHeight} width={width} x={x} y={145 - completedHeight} />
              <rect fill="#fbbf24" height={openHeight} width={width} x={x} y={145 - completedHeight - openHeight} />
              <rect fill="#f43f5e" height={failedHeight} width={width} x={x} y={145 - completedHeight - openHeight - failedHeight} />
            </g>
          )
        })}
      </svg>
      <div className="mt-3 flex flex-wrap gap-4 text-xs text-ops-muted">
        <span>
          <i aria-hidden className="mr-1.5 inline-block size-2 rounded-full bg-emerald-500" />
          Completed
        </span>
        <span>
          <i aria-hidden className="mr-1.5 inline-block size-2 rounded-full bg-amber-400" />
          Open
        </span>
        <span>
          <i aria-hidden className="mr-1.5 inline-block size-2 rounded-full bg-rose-500" />
          Failed
        </span>
      </div>
      <details className="mt-3 rounded-xl border border-ops-border bg-white px-3">
        <summary className="flex min-h-11 cursor-pointer items-center text-xs font-semibold text-ops-brand">View activity data</summary>
        <table className="mb-3 w-full table-fixed text-left text-xs">
          <caption className="sr-only">Partner transaction outcomes over time</caption>
          <thead className="text-ops-muted">
            <tr>
              <th className="w-[40%] py-2" scope="col">Time</th>
              <th className="py-2 text-right" scope="col">Done</th>
              <th className="py-2 text-right" scope="col">Open</th>
              <th className="py-2 text-right" scope="col">Failed</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ops-border">
            {scorecard.trend.map(point => (
              <tr key={point.at}>
                <th className="break-words py-2 pr-2 font-medium" scope="row">{formatDateTime(point.at)}</th>
                <td className="py-2 text-right tabular-nums">{point.completed}</td>
                <td className="py-2 text-right tabular-nums">{point.open}</td>
                <td className="py-2 text-right tabular-nums">{point.failed}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  )
}

const OpsPartnerScorecardPage = () => {
  const { partnerId = '' } = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const range = isRange(searchParams.get('range')) ? searchParams.get('range') as OpsPartnerAnalyticsRange : '30d'
  const opsApiKey = useOpsApiKey()
  const session = useOpsSession()
  const [scorecard, setScorecard] = useState<null | OpsPartnerScorecard>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<null | string>(null)
  const requestSequence = useRef(0)

  const load = useCallback(async (): Promise<void> => {
    const sequence = ++requestSequence.current
    if (!opsApiKey || !partnerId) return
    setLoading(true)
    setError(null)
    try {
      const response = await getOpsPartnerScorecard(partnerId, range)
      if (sequence === requestSequence.current) setScorecard(response)
    }
    catch (loadError) {
      if (sequence === requestSequence.current) setError(loadError instanceof Error ? loadError.message : 'Partner scorecard could not be loaded')
    }
    finally {
      if (sequence === requestSequence.current) setLoading(false)
    }
  }, [
    opsApiKey,
    partnerId,
    range,
  ])

  useEffect(() => {
    void load()
  }, [load])

  const webhookTone = !scorecard || scorecard.webhook.total === 0
    ? 'neutral' as const
    : scorecard.webhook.failed > 0
      ? 'danger' as const
      : scorecard.webhook.pending > 0
        ? 'warning' as const
        : 'success' as const
  const lifecycleTone = scorecard?.partner.lifecycle === 'LIVE' ? 'success' as const : scorecard?.partner.lifecycle === 'NO_CREDENTIALS' ? 'danger' as const : 'warning' as const
  const statusSummary = useMemo(() => scorecard?.activity.statusCounts.filter(item => item.count > 0) ?? [], [scorecard])

  return (
    <OpsPageShell
      actions={scorecard && (
        <div className="flex flex-wrap gap-2">
          <Link className="ops-btn-neutral" to={scorecard.transactionPath}>
            <ReceiptText aria-hidden size={16} />
            Transactions
          </Link>
          {session?.permissions.includes('credentials:manage') && (
            <Link className="ops-btn-neutral" to={`/ops/partners/credentials?partnerId=${encodeURIComponent(scorecard.partner.id)}`}>
              <KeyRound aria-hidden size={16} />
              Credentials
            </Link>
          )}
        </div>
      )}
      backLink={{ label: 'Back to partner activity', to: `/ops/partners?range=${range}` }}
      error={error}
      eyebrow="Partners & Compliance / Partner scorecard"
      keyRequiredMessage="Sign in to load this partner scorecard."
      subtitle={scorecard ? `${scorecard.partner.country ?? 'Country not set'} · activity from ${formatDateTime(scorecard.from)} to ${formatDateTime(scorecard.to)}` : 'Volume, execution quality, webhook delivery, corridor concentration, incidents, and support work.'}
      title={scorecard?.partner.name ?? 'Partner scorecard'}
      width="full"
    >
      <div aria-label="Partner scorecard time range" className="mt-6 flex flex-wrap gap-2" role="group">
        {ranges.map(option => (
          <button aria-pressed={range === option.value} className={range === option.value ? 'ops-btn-primary' : 'ops-btn-neutral'} key={option.value} onClick={() => setSearchParams(option.value === '30d' ? {} : { range: option.value })} type="button">{option.label}</button>
        ))}
      </div>

      {loading && !scorecard && <OpsLoading className="mt-6" label="Building partner scorecard…" />}
      {scorecard && (
        <div className={loading ? 'opacity-60' : ''}>
          <section aria-label="Partner health summary" className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <article className="ops-card p-5">
              <div className="flex items-center justify-between gap-2">
                <span className="ops-label">Lifecycle</span>
                <Activity aria-hidden className="text-ops-brand" size={19} />
              </div>
              <div className="mt-3"><OpsStatusBadge label={humanizeStatus(scorecard.partner.lifecycle)} tone={lifecycleTone} /></div>
              <p className="mt-3 text-xs text-ops-muted">
                Partner since
                {formatDateTime(scorecard.partner.createdAt)}
              </p>
            </article>
            <article className="ops-card p-5">
              <div className="ops-label">Completed volume</div>
              <div className="mt-2 text-3xl font-semibold tabular-nums">{formatAmount(scorecard.activity.stablecoinAmount)}</div>
              <p className="mt-1 text-xs text-ops-muted">USD stablecoins, currencies detailed below</p>
            </article>
            <article className="ops-card p-5">
              <div className="ops-label">Payment success</div>
              <div className="mt-2 text-3xl font-semibold tabular-nums">{scorecard.activity.successRatePct === null ? '—' : `${formatAmount(scorecard.activity.successRatePct, 1)}%`}</div>
              <p className="mt-1 text-xs text-ops-muted">
                {scorecard.activity.completedTransactions}
                {' '}
                completed ·
                {' '}
                {scorecard.activity.failedTransactions}
                {' '}
                failed
              </p>
            </article>
            <article className="ops-card p-5">
              <div className="flex items-center justify-between gap-2">
                <span className="ops-label">Webhook delivery</span>
                <Cable aria-hidden size={19} />
              </div>
              <div className="mt-3"><OpsStatusBadge label={scorecard.webhook.total === 0 ? 'No deliveries' : scorecard.webhook.failed > 0 ? 'Failures detected' : scorecard.webhook.pending > 0 ? 'Pending delivery' : 'Healthy'} tone={webhookTone} /></div>
              <p className="mt-3 text-xs text-ops-muted">
                Last delivered
                {formatDateTime(scorecard.webhook.lastDeliveredAt)}
              </p>
            </article>
          </section>

          <section aria-labelledby="partner-activity-trend-title" className="ops-card mt-5 p-5 sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold" id="partner-activity-trend-title">Transaction outcomes</h2>
                <p className="mt-1 text-sm text-ops-muted">
                  {scorecard.trendUnit === 'HOUR' ? 'Hourly' : 'Daily'}
                  {' '}
                  completed, open, and failed work.
                </p>
              </div>
              <Link className="ops-btn-neutral" to={scorecard.transactionPath}>
                Investigate transactions
                <ArrowRight aria-hidden size={15} />
              </Link>
            </div>
            <PartnerTrend scorecard={scorecard} />
            <div className="mt-4 flex flex-wrap gap-2">{statusSummary.map(item => <OpsStatusBadge key={item.status} label={`${humanizeStatus(item.status)} · ${item.count}`} tone={item.status === 'PAYMENT_COMPLETED' ? 'success' : item.status.includes('FAILED') || item.status.includes('EXPIRED') ? 'danger' : 'neutral'} />)}</div>
          </section>

          <div className="mt-5 grid gap-5 xl:grid-cols-2">
            <section aria-labelledby="partner-volume-title" className="ops-card p-5 sm:p-6">
              <h2 className="text-lg font-semibold" id="partner-volume-title">Currency-safe volume</h2>
              <p className="mt-1 text-sm text-ops-muted">Assets and payout currencies are never combined.</p>
              <div className="mt-5 grid gap-5 sm:grid-cols-2">
                <div>
                  <div className="ops-label">Stablecoins received</div>
                  <CurrencyList amounts={scorecard.activity.sourceVolume} />
                </div>
                <div>
                  <div className="ops-label">Fiat paid out</div>
                  <CurrencyList amounts={scorecard.activity.payoutVolume} />
                </div>
              </div>
            </section>

            <section aria-labelledby="partner-webhook-title" className="ops-card p-5 sm:p-6">
              <div className="flex items-center gap-2">
                <Cable aria-hidden className="text-ops-brand" size={19} />
                <h2 className="text-lg font-semibold" id="partner-webhook-title">Webhook health</h2>
              </div>
              <dl className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div>
                  <dt className="text-xs text-ops-muted">Delivered</dt>
                  <dd className="mt-1 text-xl font-semibold text-emerald-700">{scorecard.webhook.delivered}</dd>
                </div>
                <div>
                  <dt className="text-xs text-ops-muted">Pending</dt>
                  <dd className="mt-1 text-xl font-semibold text-amber-700">{scorecard.webhook.pending}</dd>
                </div>
                <div>
                  <dt className="text-xs text-ops-muted">Failed</dt>
                  <dd className="mt-1 text-xl font-semibold text-rose-700">{scorecard.webhook.failed}</dd>
                </div>
                <div>
                  <dt className="text-xs text-ops-muted">Success</dt>
                  <dd className="mt-1 text-xl font-semibold">{scorecard.webhook.successRatePct === null ? '—' : `${formatAmount(scorecard.webhook.successRatePct, 1)}%`}</dd>
                </div>
              </dl>
              <Link className="mt-5 inline-flex min-h-11 items-center text-sm font-semibold text-ops-brand" to={`${scorecard.transactionPath}&webhookStatus=FAILED`}>Investigate failed deliveries →</Link>
            </section>
          </div>

          <section aria-labelledby="partner-corridors-title" className="mt-8">
            <div>
              <h2 className="text-lg font-semibold" id="partner-corridors-title">Corridor concentration</h2>
              <p className="mt-1 text-sm text-ops-muted">Completed source volume by route; concentration highlights operational dependency.</p>
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {scorecard.corridors.map(corridor => (
                <article className="ops-card p-4" key={`${corridor.cryptoCurrency}-${corridor.blockchain}-${corridor.targetCurrency}`}>
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="font-semibold">
                      {corridor.cryptoCurrency}
                      {' '}
                      on
                      {' '}
                      {humanizeStatus(corridor.blockchain)}
                      {' '}
                      →
                      {' '}
                      {corridor.targetCurrency}
                    </h3>
                    <span className="text-sm font-bold tabular-nums">
                      {formatAmount(corridor.sharePct, 1)}
                      %
                    </span>
                  </div>
                  <svg aria-label={`${formatAmount(corridor.sharePct, 1)} percent of partner volume`} className="mt-3 h-2 w-full" preserveAspectRatio="none" role="img" viewBox="0 0 100 8">
                    <rect fill="#e7e5e4" height="8" rx="4" width="100" />
                    <rect fill="#1B4D48" height="8" rx="4" width={Math.min(100, corridor.sharePct)} />
                  </svg>
                  <p className="mt-3 text-xs text-ops-muted">
                    {formatAmount(corridor.stablecoinAmount)}
                    {' '}
                    source stablecoins ·
                    {' '}
                    {corridor.completedTransactions}
                    {' '}
                    completed
                  </p>
                </article>
              ))}
              {scorecard.corridors.length === 0 && <OpsEmptyState className="md:col-span-2 xl:col-span-3">No completed corridor volume in this window.</OpsEmptyState>}
            </div>
          </section>

          <div className="mt-8 grid gap-5 xl:grid-cols-2">
            <section aria-labelledby="partner-incidents-title" className="ops-card p-5 sm:p-6">
              <div className="flex items-center gap-2">
                <BellRing aria-hidden className="text-ops-brand" size={19} />
                <h2 className="text-lg font-semibold" id="partner-incidents-title">Open incidents</h2>
              </div>
              <div className="mt-4 space-y-3">
                {scorecard.incidents.map(incident => (
                  <Link className="flex min-h-11 items-center justify-between gap-3 rounded-xl border border-ops-border p-3 hover:bg-ops-bg" key={incident.id} to={incident.href}>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold">{incident.title}</span>
                      <span className="text-xs text-ops-muted">{humanizeStatus(incident.status)}</span>
                    </span>
                    <OpsStatusBadge label={humanizeStatus(incident.severity)} tone={incident.severity === 'CRITICAL' ? 'danger' : 'warning'} />
                  </Link>
                ))}
                {scorecard.incidents.length === 0 && <OpsEmptyState className="py-8">No open incidents explicitly affect this partner.</OpsEmptyState>}
              </div>
            </section>
            <section aria-labelledby="partner-cases-title" className="ops-card p-5 sm:p-6">
              <h2 className="text-lg font-semibold" id="partner-cases-title">Support cases</h2>
              <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
                {scorecard.cases.map(item => (
                  <div className="rounded-xl bg-ops-bg p-3" key={item.status}>
                    <div className="text-xs text-ops-muted">{humanizeStatus(item.status)}</div>
                    <div className="mt-1 text-2xl font-semibold tabular-nums">{item.count}</div>
                  </div>
                ))}
                {scorecard.cases.length === 0 && <p className="col-span-full text-sm text-ops-muted">No cases were opened in this window.</p>}
              </div>
              <Link className="ops-btn-neutral mt-5" to={`${scorecard.transactionPath}&caseStatus=OPEN`}>
                Open case work
                <ArrowRight aria-hidden size={15} />
              </Link>
            </section>
          </div>
        </div>
      )}
    </OpsPageShell>
  )
}

export default OpsPartnerScorecardPage

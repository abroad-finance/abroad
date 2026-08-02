import type { FormEvent } from 'react'

import {
  ArrowRight,
  BriefcaseBusiness,
  Building2,
  GitBranch,
  Search,
  WalletCards,
} from 'lucide-react'
import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { Link, useSearchParams } from 'react-router-dom'

import type { OpsGlobalSearchResponse, OpsGlobalSearchResult } from '../../services/admin/opsInvestigationTypes'

import { useOpsApiKey } from '../../services/admin/opsAuthStore'
import { globalOpsSearch } from '../../services/admin/opsInvestigationApi'
import {
  getOpsTelemetryViewport,
  recordOpsTaskEvent,
} from '../../services/admin/opsTaskTelemetry'
import {
  humanizeStatus,
  OpsEmptyState,
  OpsLoading,
  OpsPageShell,
} from './shared'

const resultIcon: Readonly<Record<OpsGlobalSearchResult['kind'], React.ReactNode>> = {
  CASE: <BriefcaseBusiness aria-hidden size={19} />,
  FLOW: <GitBranch aria-hidden size={19} />,
  PARTNER: <Building2 aria-hidden size={19} />,
  TRANSACTION: <WalletCards aria-hidden size={19} />,
}

const OpsGlobalSearch = () => {
  const [searchParams, setSearchParams] = useSearchParams()
  const appliedQuery = useMemo(() => searchParams.get('query')?.trim() ?? '', [searchParams])
  const [draft, setDraft] = useState(appliedQuery)
  const [data, setData] = useState<null | OpsGlobalSearchResponse>(null)
  const [error, setError] = useState<null | string>(null)
  const [loading, setLoading] = useState(false)
  const opsApiKey = useOpsApiKey()
  const submittedAtRef = useRef<null | number>(null)

  useEffect(() => setDraft(appliedQuery), [appliedQuery])

  useEffect(() => {
    if (!opsApiKey || appliedQuery.length < 2) {
      setData(null)
      setLoading(false)
      return undefined
    }
    const controller = new AbortController()
    setLoading(true)
    setError(null)
    void globalOpsSearch(appliedQuery, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setData(result)
      })
      .catch((searchError: unknown) => {
        if (!controller.signal.aborted) {
          setError(searchError instanceof Error ? searchError.message : 'Global search failed')
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [appliedQuery, opsApiKey])

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    const query = draft.trim()
    if (query.length < 2) {
      setError('Enter at least two characters.')
      return
    }
    submittedAtRef.current = Date.now()
    recordOpsTaskEvent({
      action: 'SUBMITTED',
      metadata: { viewport: getOpsTelemetryViewport() },
      result: 'SUCCEEDED',
      task: 'GLOBAL_SEARCH',
    })
    setSearchParams({ query })
  }

  return (
    <OpsPageShell
      backLink={{ label: 'Back to transaction investigations', to: '/ops/transactions' }}
      error={error}
      eyebrow="Work · Search"
      keyRequiredMessage="Sign in to search operational identifiers."
      subtitle="A PII-minimized lookup across transactions, quotes, chains, PIX proof, refunds, provider references, flows, cases, partners, and partner-user references."
      title="Global operations search"
      width="narrow"
    >
      <form className="ops-card mt-8 p-4 sm:p-5" onSubmit={submit}>
        <label className="ops-label" htmlFor="ops-global-search">Operational identifier or partner</label>
        <div className="mt-2 flex flex-col gap-2 sm:flex-row">
          <div className="relative min-w-0 flex-1">
            <Search aria-hidden className="absolute left-3 top-1/2 -translate-y-1/2 text-ops-muted" size={18} />
            <input
              autoComplete="off"
              className="ops-input min-h-12 pl-10"
              id="ops-global-search"
              maxLength={200}
              name="ops-global-search"
              onChange={event => setDraft(event.target.value)}
              placeholder="Transaction, quote, hash, E2E, refund, flow, case, partner…"
              value={draft}
            />
          </div>
          <button className="ops-btn-primary min-h-12" disabled={loading || draft.trim().length < 2} type="submit">
            {loading ? 'Searching…' : 'Search'}
          </button>
        </div>
        <p className="mt-2 text-xs leading-5 text-ops-muted">Recipient destinations and identity details are never returned by this search.</p>
      </form>

      {loading && !data && <OpsLoading label="Searching operational records…" />}

      {data && (
        <div className="mt-6">
          <div aria-live="polite" className="flex flex-wrap items-center justify-between gap-3 text-sm text-ops-muted">
            <span>
              {data.items.length}
              {' result'}
              {data.items.length === 1 ? '' : 's'}
              {' for “'}
              {data.query}
              ”
            </span>
            {data.truncated && <span>More matches exist; add more of the identifier to narrow results.</span>}
          </div>

          {data.items.length === 0
            ? (
                <OpsEmptyState>
                  <div>
                    <p className="font-semibold text-ops-text">No operational records matched.</p>
                    <p className="mt-1 text-sm text-ops-muted">Check the identifier or search a shorter exact segment.</p>
                  </div>
                </OpsEmptyState>
              )
            : (
                <ul className="mt-3 grid gap-3 sm:grid-cols-2">
                  {data.items.map((result, index) => (
                    <li key={`${result.kind}:${result.route}:${index}`}>
                      <Link
                        className="ops-card-interactive group flex h-full min-w-0 items-start gap-4 p-5"
                        onClick={() => {
                          const submittedAt = submittedAtRef.current
                          recordOpsTaskEvent({
                            action: 'RESULT_OPENED',
                            durationMs: submittedAt
                              ? Math.min(60 * 60 * 1_000, Date.now() - submittedAt)
                              : undefined,
                            metadata: {
                              entryPoint: result.kind,
                              viewport: getOpsTelemetryViewport(),
                            },
                            result: 'SUCCEEDED',
                            task: 'GLOBAL_SEARCH',
                          })
                        }}
                        to={result.route}
                      >
                        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-ops-brand">{resultIcon[result.kind]}</span>
                        <span className="min-w-0 flex-1">
                          <span className="ops-eyebrow">{humanizeStatus(result.kind)}</span>
                          <span className="mt-1 block truncate text-base font-semibold text-ops-text">{result.title}</span>
                          <span className="mt-1 block text-sm text-ops-muted">{result.secondary}</span>
                          <span className="mt-2 block truncate text-xs text-ops-muted">{result.context}</span>
                          <span className="mt-2 block text-[11px] font-medium text-ops-brand">
                            Matched:
                            {result.matchedFields.join(', ')}
                          </span>
                        </span>
                        <ArrowRight aria-hidden className="mt-2 shrink-0 text-ops-muted transition-transform group-hover:translate-x-0.5" size={17} />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
        </div>
      )}
    </OpsPageShell>
  )
}

export default OpsGlobalSearch

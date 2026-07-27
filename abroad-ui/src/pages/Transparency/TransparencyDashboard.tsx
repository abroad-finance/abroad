import {
  ArrowUpRight,
  Clock3,
  Database,
  Github,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react'
import { useEffect } from 'react'

import type {
  TransparencyMetricsResponse,
  TransparencyOpenSourceMetrics,
  TransparencyVolume,
} from '../../api'

import AbroadLogoColored from '../../assets/Logos/AbroadLogoColored.svg'
import { transparencyMetricsUrl } from '../../services/public/transparencyApi'
import { TransparencyOutcomesChart } from './TransparencyOutcomesChart'
import './TransparencyDashboard.css'
import { useTransparencyMetrics } from './useTransparencyMetrics'

const REPOSITORY_URL = 'https://github.com/abroad-finance/abroad'

const countFormatter = new Intl.NumberFormat('en-US')
const amountFormatter = new Intl.NumberFormat('en-US', {
  maximumFractionDigits: 2,
})
const dateTimeFormatter = new Intl.DateTimeFormat('en-US', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'UTC',
})

type CoverageRowProps = {
  items: string[]
  label: string
}

type GitHubMetricProps = {
  label: string
  value: null | number
}

type MetricCellProps = {
  definition: string
  label: string
  source: string
  value: string
}

const MetricCell = ({
  definition,
  label,
  source,
  value,
}: MetricCellProps) => (
  <div className="transparency-metric">
    <dt>{label}</dt>
    <dd>{value}</dd>
    <p>{definition}</p>
    <span>
      <Database aria-hidden="true" size={13} />
      {source}
    </span>
  </div>
)

const CoverageRow = ({ items, label }: CoverageRowProps) => (
  <div className="transparency-coverage__row">
    <dt>{label}</dt>
    <dd>
      {items.length > 0
        ? items.map(item => <span key={item}>{item}</span>)
        : <span>None enabled</span>}
    </dd>
  </div>
)

const GitHubMetric = ({ label, value }: GitHubMetricProps) => (
  <div className="transparency-github__metric">
    <dt>{label}</dt>
    <dd>{value === null ? 'Unavailable' : countFormatter.format(value)}</dd>
  </div>
)

const formatRate = (value: null | number): string => (
  value === null ? '—' : `${value.toFixed(1)}%`
)

const formatDateTime = (value: null | string): string => {
  if (!value) return 'Unavailable'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 'Unavailable' : `${dateTimeFormatter.format(date)} UTC`
}

const volumeByAsset = (volumes: TransparencyVolume[]): Map<string, number> => (
  new Map(volumes.map(volume => [volume.asset, volume.amount]))
)

const SourceStatus = ({
  cache,
}: {
  cache: 'fresh' | 'stale' | 'unavailable'
}) => (
  <span className={`transparency-source-status transparency-source-status--${cache}`}>
    <span aria-hidden="true" />
    {cache === 'fresh' ? 'Current' : cache === 'stale' ? 'Recent cache' : 'Unavailable'}
  </span>
)

const LoadingState = () => (
  <section aria-busy="true" aria-live="polite" className="transparency-loading">
    <span aria-hidden="true" className="transparency-loading__mark" />
    <p>Loading current metrics from Abroad and GitHub…</p>
  </section>
)

const OpenSourceSection = ({
  metrics,
}: {
  metrics: TransparencyOpenSourceMetrics
}) => (
  <section className="transparency-section transparency-section--github" id="open-source">
    <div className="transparency-section__heading">
      <div>
        <span className="transparency-kicker">03 / Open source</span>
        <h2>Built in public.</h2>
      </div>
      <div className="transparency-section__source">
        <SourceStatus cache={metrics.cache} />
        <span>
          GitHub API · updated
          {' '}
          {formatDateTime(metrics.asOf)}
        </span>
      </div>
    </div>

    {metrics.cache === 'unavailable' && (
      <p className="transparency-inline-notice">
        GitHub is temporarily unavailable. Platform metrics above remain current and independent.
      </p>
    )}

    <div className="transparency-github">
      <div className="transparency-github__intro">
        <Github aria-hidden="true" size={22} />
        <div>
          <a href={REPOSITORY_URL} rel="noreferrer" target="_blank">
            {metrics.repository}
            <ArrowUpRight aria-hidden="true" size={15} />
          </a>
          <p>
            Default branch:
            {' '}
            {metrics.defaultBranch ?? 'unavailable'}
            {' · '}
            Last push:
            {' '}
            {formatDateTime(metrics.pushedAt)}
          </p>
        </div>
      </div>
      <dl className="transparency-github__grid">
        <GitHubMetric label="Stars" value={metrics.stars} />
        <GitHubMetric label="Forks" value={metrics.forks} />
        <GitHubMetric label="Contributors" value={metrics.contributors} />
        <GitHubMetric label="Commits · 90d" value={metrics.commitsLast90Days} />
        <GitHubMetric label="Open issues" value={metrics.openIssues} />
        <GitHubMetric label="Open pull requests" value={metrics.openPullRequests} />
      </dl>
    </div>
  </section>
)

const PlatformMetrics = ({
  data,
}: {
  data: TransparencyMetricsResponse
}) => {
  const {
    coverage,
    dailyOutcomes,
    generatedAt,
    rolling30Days,
    totals,
  } = data.platform
  const totalVolume = volumeByAsset(totals.completedSourceVolume)
  const rollingVolume = volumeByAsset(rolling30Days.completedSourceVolume)
  const volumeAssets = [...new Set([...rollingVolume.keys(), ...totalVolume.keys()])].sort((left, right) => left.localeCompare(right))

  return (
    <>
      <section className="transparency-section" id="platform">
        <div className="transparency-section__heading">
          <div>
            <span className="transparency-kicker">01 / Platform activity</span>
            <h2>What has moved through Abroad.</h2>
          </div>
          <div className="transparency-section__source">
            <SourceStatus cache={data.platform.cache} />
            <span>
              Application database · generated
              {' '}
              {formatDateTime(generatedAt)}
            </span>
          </div>
        </div>

        <dl className="transparency-metrics">
          <MetricCell
            definition="Records created after a partner accepted an Abroad quote."
            label="Accepted transactions"
            source="Transaction records · all time"
            value={countFormatter.format(totals.acceptedTransactions)}
          />
          <MetricCell
            definition="Transactions whose local payout reached PAYMENT_COMPLETED."
            label="Completed payouts"
            source="Transaction status · all time"
            value={countFormatter.format(totals.completedTransactions)}
          />
          <MetricCell
            definition="Completed payouts divided by all terminal outcomes; in-flight records are excluded."
            label="Terminal completion rate"
            source="Completed ÷ terminal · all time"
            value={formatRate(totals.completionRate)}
          />
          <MetricCell
            definition="Organizations with a partner record in Abroad."
            label="Partner organizations"
            source="Partner records · current"
            value={countFormatter.format(totals.partnerOrganizations)}
          />
          <MetricCell
            definition="Partner-scoped user records; one person may appear under more than one partner."
            label="Partner user records"
            source="Partner user records · current"
            value={countFormatter.format(totals.userRecords)}
          />
        </dl>

        <div className="transparency-period">
          <div className="transparency-period__heading">
            <div>
              <span>Rolling 30 days</span>
              <p>UTC calendar days, including today</p>
            </div>
            <strong>
              {countFormatter.format(rolling30Days.completedTransactions)}
              {' '}
              completed
            </strong>
          </div>
          <dl className="transparency-period__metrics">
            <div>
              <dt>Accepted</dt>
              <dd>{countFormatter.format(rolling30Days.acceptedTransactions)}</dd>
            </div>
            <div>
              <dt>Completion rate</dt>
              <dd>{formatRate(rolling30Days.completionRate)}</dd>
            </div>
            <div>
              <dt>Active partners</dt>
              <dd>{countFormatter.format(rolling30Days.activePartnerOrganizations)}</dd>
            </div>
            <div>
              <dt>Active user records</dt>
              <dd>{countFormatter.format(rolling30Days.activeUserRecords)}</dd>
            </div>
          </dl>
        </div>

        <div className="transparency-chart-block">
          <div className="transparency-chart-block__heading">
            <div>
              <h3>Daily transaction outcomes</h3>
              <p>Every accepted record, grouped by its current status.</p>
            </div>
            <span>Records / day</span>
          </div>
          <span className="transparency-chart-block__mobile-hint">
            Swipe to inspect all 30 days →
          </span>
          <TransparencyOutcomesChart outcomes={dailyOutcomes} />
        </div>

        <div className="transparency-volume">
          <div>
            <h3>Completed source volume</h3>
            <p>
              Nominal source-asset units attached to completed payouts. Values are not converted to USD.
            </p>
          </div>
          <div className="transparency-volume__table">
            <div className="transparency-volume__header">
              <span>Asset</span>
              <span>All time</span>
              <span>30 days</span>
            </div>
            {volumeAssets.map(asset => (
              <div className="transparency-volume__row" key={asset}>
                <strong>{asset}</strong>
                <span>{amountFormatter.format(totalVolume.get(asset) ?? 0)}</span>
                <span>{amountFormatter.format(rollingVolume.get(asset) ?? 0)}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="transparency-section" id="coverage">
        <div className="transparency-section__heading">
          <div>
            <span className="transparency-kicker">02 / Live coverage</span>
            <h2>What the platform can route now.</h2>
          </div>
          <div className="transparency-section__source">
            <SourceStatus cache={data.platform.cache} />
            <span>Enabled flow and asset configuration</span>
          </div>
        </div>

        <div className="transparency-coverage">
          <div className="transparency-coverage__total">
            <span>Enabled corridors</span>
            <strong>{countFormatter.format(coverage.corridors)}</strong>
            <p>
              A corridor is one currently enabled source asset, network, payout currency,
              and payout-method path.
            </p>
          </div>
          <dl className="transparency-coverage__list">
            <CoverageRow items={coverage.sourceAssets} label="Source assets" />
            <CoverageRow items={coverage.networks} label="Networks" />
            <CoverageRow items={coverage.payoutCurrencies} label="Payout currencies" />
            <CoverageRow items={coverage.payoutMethods} label="Payout methods" />
          </dl>
        </div>
      </section>
    </>
  )
}

const DisclosureSection = () => (
  <section className="transparency-section" id="disclosures">
    <div className="transparency-section__heading">
      <div>
        <span className="transparency-kicker">04 / Disclosure register</span>
        <h2>What is—and is not—published.</h2>
      </div>
      <p className="transparency-section__lede">
        A missing number stays visibly missing. Abroad does not estimate unpublished company metrics.
      </p>
    </div>

    <div className="transparency-disclosures">
      <div className="transparency-disclosure transparency-disclosure--published">
        <span>Published live</span>
        <strong>Platform adoption and outcomes</strong>
        <p>Aggregate database metrics with a short cache and explicit generation time.</p>
      </div>
      <div className="transparency-disclosure transparency-disclosure--published">
        <span>Published live</span>
        <strong>Enabled product coverage</strong>
        <p>Current flow and crypto-asset configuration, with unsupported paths excluded.</p>
      </div>
      <div className="transparency-disclosure transparency-disclosure--published">
        <span>Published live</span>
        <strong>Open-source activity</strong>
        <p>Public GitHub API metrics, independently cached and allowed to fail safely.</p>
      </div>
      <div className="transparency-disclosure">
        <span>Not yet published</span>
        <strong>Financial performance</strong>
        <p>Revenue, cost, and treasury reporting need an approved public accounting policy.</p>
      </div>
      <div className="transparency-disclosure">
        <span>Not yet published</span>
        <strong>Reliability and incidents</strong>
        <p>Requires a consolidated uptime series and a durable public incident standard.</p>
      </div>
      <div className="transparency-disclosure">
        <span>Not yet published</span>
        <strong>Team and governance</strong>
        <p>Requires stable definitions, reporting ownership, and an agreed update cadence.</p>
      </div>
    </div>
  </section>
)

const TransparencyDashboard = () => {
  const {
    data,
    error,
    isLoading,
    isRefreshing,
    refresh,
  } = useTransparencyMetrics()

  useEffect(() => {
    const previousTitle = document.title
    document.title = 'Transparency · Abroad'
    return () => {
      document.title = previousTitle
    }
  }, [])

  return (
    <div className="transparency-page">
      <header className="transparency-header">
        <a aria-label="Abroad home" className="transparency-header__brand" href="/">
          <img alt="Abroad" src={AbroadLogoColored} />
        </a>
        <nav aria-label="Transparency sections">
          <a href="#platform">Platform</a>
          <a href="#coverage">Coverage</a>
          <a href="#open-source">Open source</a>
          <a href="#disclosures">Disclosures</a>
        </nav>
        <a className="transparency-header__github" href={REPOSITORY_URL} rel="noreferrer" target="_blank">
          <Github aria-hidden="true" size={17} />
          GitHub
        </a>
      </header>

      <main>
        <section className="transparency-hero">
          <div className="transparency-hero__copy">
            <span className="transparency-kicker">Abroad / Public ledger</span>
            <h1>Every number comes with a receipt.</h1>
            <p>
              A live, public view of Abroad’s platform, coverage, and open-source work—
              with definitions, freshness, and disclosure gaps included.
            </p>
            <div className="transparency-hero__actions">
              <button
                className="transparency-refresh"
                disabled={isLoading || isRefreshing}
                onClick={() => void refresh()}
                type="button"
              >
                <RefreshCw
                  aria-hidden="true"
                  className={isRefreshing ? 'is-spinning' : undefined}
                  size={16}
                />
                {isRefreshing ? 'Refreshing…' : 'Refresh now'}
              </button>
              <a href={transparencyMetricsUrl} rel="noreferrer" target="_blank">
                View machine-readable JSON
                <ArrowUpRight aria-hidden="true" size={15} />
              </a>
            </div>
          </div>

          <aside className="transparency-receipt">
            <div className="transparency-receipt__top">
              <span>Source receipt</span>
              <ShieldCheck aria-hidden="true" size={19} />
            </div>
            <div className="transparency-receipt__rule" />
            <dl>
              <div>
                <dt>Platform data</dt>
                <dd>{data ? formatDateTime(data.platform.generatedAt) : 'Loading current data…'}</dd>
              </div>
              <div>
                <dt>Refresh cadence</dt>
                <dd>{data ? `Every ${data.refreshAfterSeconds} seconds` : 'Short live cache'}</dd>
              </div>
              <div>
                <dt>Schema</dt>
                <dd>{data ? `v${data.schemaVersion}` : 'Versioned JSON'}</dd>
              </div>
            </dl>
            <p>
              <Clock3 aria-hidden="true" size={14} />
              UTC timestamps · aggregate records only
            </p>
          </aside>
        </section>

        {error && (
          <div className="transparency-error" role="alert">
            <div>
              <strong>Live metrics could not be refreshed.</strong>
              <span>{data ? 'The last successful response remains visible.' : error}</span>
            </div>
            <button disabled={isRefreshing} onClick={() => void refresh()} type="button">
              Try again
            </button>
          </div>
        )}

        {isLoading && !data
          ? <LoadingState />
          : data && (
            <>
              <PlatformMetrics data={data} />
              <OpenSourceSection metrics={data.openSource} />
              <DisclosureSection />
            </>
          )}

        <section className="transparency-methodology">
          <div>
            <span className="transparency-kicker">Methodology</span>
            <h2>Readable by people. Verifiable by machines.</h2>
          </div>
          <div className="transparency-methodology__grid">
            <article>
              <strong>Current, not real-time theater</strong>
              <p>
                Platform aggregates use a bounded server cache. The exact database generation
                time is shown even when an API response is served from cache.
              </p>
            </article>
            <article>
              <strong>Privacy by aggregation</strong>
              <p>
                The endpoint returns counts, status groups, volumes, and enabled coverage only.
                No user, partner, transaction, tax, wallet, or account identifiers are exposed.
              </p>
            </article>
            <article>
              <strong>Independent source health</strong>
              <p>
                GitHub is fetched and cached separately. If it is unavailable, Abroad’s platform
                metrics continue to load and the upstream gap is made explicit.
              </p>
            </article>
          </div>
        </section>
      </main>

      <footer className="transparency-footer">
        <img alt="Abroad" src={AbroadLogoColored} />
        <p>Open infrastructure for moving money across borders.</p>
        <div>
          <a href={transparencyMetricsUrl} rel="noreferrer" target="_blank">Metrics API</a>
          <a href={REPOSITORY_URL} rel="noreferrer" target="_blank">Source code</a>
          <a href="/">Use Abroad</a>
        </div>
      </footer>
    </div>
  )
}

export default TransparencyDashboard

import type { TransparencyDailyOutcome } from '../../api'

type OutcomeSeries = {
  className: string
  key: keyof Pick<
    TransparencyDailyOutcome,
    'completed' | 'failed' | 'inFlight' | 'otherTerminal'
  >
  label: string
}

type TransparencyOutcomesChartProps = {
  outcomes: TransparencyDailyOutcome[]
}

const CHART_HEIGHT = 260
const CHART_WIDTH = 760
const PADDING = {
  bottom: 42,
  left: 42,
  right: 12,
  top: 16,
}

const OUTCOME_SERIES: OutcomeSeries[] = [
  {
    className: 'transparency-chart__completed',
    key: 'completed',
    label: 'Completed',
  },
  {
    className: 'transparency-chart__failed',
    key: 'failed',
    label: 'Failed',
  },
  {
    className: 'transparency-chart__in-flight',
    key: 'inFlight',
    label: 'In flight',
  },
  {
    className: 'transparency-chart__other',
    key: 'otherTerminal',
    label: 'Expired / wrong amount',
  },
]

const compactNumber = new Intl.NumberFormat('en-US', {
  maximumFractionDigits: 1,
  notation: 'compact',
})

const shortDate = new Intl.DateTimeFormat('en-US', {
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
})

const longDate = new Intl.DateTimeFormat('en-US', {
  day: 'numeric',
  month: 'long',
  timeZone: 'UTC',
  year: 'numeric',
})

const niceMaximum = (value: number): number => {
  const safeValue = Math.max(1, value)
  const magnitude = 10 ** Math.floor(Math.log10(safeValue))
  const normalized = safeValue / magnitude
  const step = normalized <= 1
    ? 1
    : normalized <= 2
      ? 2
      : normalized <= 5
        ? 5
        : 10
  return step * magnitude
}

const utcDate = (value: string): Date => new Date(`${value}T00:00:00.000Z`)

export const TransparencyOutcomesChart = ({
  outcomes,
}: TransparencyOutcomesChartProps) => {
  if (outcomes.length === 0) {
    return (
      <p className="transparency-empty">
        Daily outcomes will appear after the first accepted transaction in this window.
      </p>
    )
  }

  const plotWidth = CHART_WIDTH - PADDING.left - PADDING.right
  const plotHeight = CHART_HEIGHT - PADDING.top - PADDING.bottom
  const maximum = niceMaximum(Math.max(...outcomes.map(outcome => outcome.accepted)))
  const slotWidth = plotWidth / outcomes.length
  const barWidth = Math.min(15, slotWidth * 0.62)
  const yFor = (value: number): number => (
    PADDING.top + plotHeight - (value / maximum) * plotHeight
  )
  const yTicks = [
    maximum,
    maximum / 2,
    0,
  ]
  const xLabelIndexes = new Set([
    0,
    Math.floor((outcomes.length - 1) / 2),
    outcomes.length - 1,
  ])

  return (
    <>
      <div className="transparency-chart">
        <svg
          aria-labelledby="daily-outcomes-title daily-outcomes-description"
          preserveAspectRatio="xMidYMid meet"
          role="img"
          viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
        >
          <title id="daily-outcomes-title">Accepted transaction outcomes over the last 30 days</title>
          <desc id="daily-outcomes-description">
            Stacked daily bars compare completed, failed, in-flight, and other terminal transaction records.
          </desc>

          {yTicks.map(tick => (
            <g key={tick}>
              <line
                className="transparency-chart__grid"
                x1={PADDING.left}
                x2={CHART_WIDTH - PADDING.right}
                y1={yFor(tick)}
                y2={yFor(tick)}
              />
              <text
                className="transparency-chart__axis"
                textAnchor="end"
                x={PADDING.left - 8}
                y={yFor(tick) + 4}
              >
                {compactNumber.format(tick)}
              </text>
            </g>
          ))}

          {outcomes.map((outcome, index) => {
            const x = PADDING.left + index * slotWidth + (slotWidth - barWidth) / 2
            let cumulativeValue = 0

            return (
              <g key={outcome.date}>
                <title>
                  {`${longDate.format(utcDate(outcome.date))}: ${outcome.completed} completed, `
                    + `${outcome.failed} failed, ${outcome.inFlight} in flight, `
                    + `${outcome.otherTerminal} expired or wrong amount`}
                </title>
                {OUTCOME_SERIES.map((series) => {
                  const value = outcome[series.key]
                  const segmentTop = yFor(cumulativeValue + value)
                  const segmentBottom = yFor(cumulativeValue)
                  cumulativeValue += value

                  return value > 0
                    ? (
                        <rect
                          className={series.className}
                          height={Math.max(0, segmentBottom - segmentTop)}
                          key={series.key}
                          width={barWidth}
                          x={x}
                          y={segmentTop}
                        />
                      )
                    : null
                })}
                {xLabelIndexes.has(index) && (
                  <text
                    className="transparency-chart__axis"
                    textAnchor={index === 0 ? 'start' : index === outcomes.length - 1 ? 'end' : 'middle'}
                    x={index === 0 ? PADDING.left : index === outcomes.length - 1 ? CHART_WIDTH - PADDING.right : x + barWidth / 2}
                    y={CHART_HEIGHT - 10}
                  >
                    {shortDate.format(utcDate(outcome.date))}
                  </text>
                )}
              </g>
            )
          })}
        </svg>
      </div>

      <div aria-label="Transaction outcome legend" className="transparency-chart-legend">
        {OUTCOME_SERIES.map(series => (
          <span key={series.key}>
            <span
              aria-hidden="true"
              className={`transparency-chart-legend__swatch ${series.className}`}
            />
            {series.label}
          </span>
        ))}
      </div>

      <details className="transparency-data-table">
        <summary>Inspect the 30-day daily data</summary>
        <div className="transparency-data-table__scroll">
          <table>
            <thead>
              <tr>
                <th>Date (UTC)</th>
                <th>Accepted</th>
                <th>Completed</th>
                <th>Failed</th>
                <th>In flight</th>
                <th>Other terminal</th>
              </tr>
            </thead>
            <tbody>
              {outcomes.map(outcome => (
                <tr key={outcome.date}>
                  <th scope="row">{outcome.date}</th>
                  <td>{outcome.accepted}</td>
                  <td>{outcome.completed}</td>
                  <td>{outcome.failed}</td>
                  <td>{outcome.inFlight}</td>
                  <td>{outcome.otherTerminal}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </>
  )
}

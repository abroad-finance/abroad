import type { TransparencyHistoricalOutcome } from '../../api'

type OutcomeSeries = {
  className: string
  key: keyof Pick<
    TransparencyHistoricalOutcome,
    'completed' | 'failed' | 'inFlight' | 'otherTerminal'
  >
  label: string
}

type TransparencyOutcomesChartProps = {
  outcomes: TransparencyHistoricalOutcome[]
}

const CHART_HEIGHT = 260
const CHART_MIN_WIDTH = 760
const MINIMUM_MONTH_WIDTH = 28
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

const shortMonth = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  timeZone: 'UTC',
  year: 'numeric',
})

const longMonth = new Intl.DateTimeFormat('en-US', {
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
        Historical activity will appear here as it is recorded.
      </p>
    )
  }

  const chartWidth = Math.max(
    CHART_MIN_WIDTH,
    PADDING.left + PADDING.right + outcomes.length * MINIMUM_MONTH_WIDTH,
  )
  const plotWidth = chartWidth - PADDING.left - PADDING.right
  const plotHeight = CHART_HEIGHT - PADDING.top - PADDING.bottom
  const maximum = niceMaximum(Math.max(...outcomes.map(outcome => outcome.accepted)))
  const slotWidth = plotWidth / outcomes.length
  const barWidth = Math.min(18, slotWidth * 0.66)
  const yFor = (value: number): number => (
    PADDING.top + plotHeight - (value / maximum) * plotHeight
  )
  const yTicks = [
    maximum,
    maximum / 2,
    0,
  ]
  const xLabelIndexes = new Set([0, outcomes.length - 1])
  outcomes.forEach((outcome, index) => {
    if (utcDate(outcome.periodStart).getUTCMonth() === 0) {
      xLabelIndexes.add(index)
    }
  })

  return (
    <>
      <div className="transparency-chart">
        <svg
          aria-labelledby="historical-outcomes-title historical-outcomes-description"
          preserveAspectRatio="xMidYMid meet"
          role="img"
          viewBox={`0 0 ${chartWidth} ${CHART_HEIGHT}`}
          width={chartWidth}
        >
          <title id="historical-outcomes-title">
            Transaction outcomes since Abroad’s first recorded activity
          </title>
          <desc id="historical-outcomes-description">
            Stacked monthly bars compare completed, failed, in-flight, and other terminal
            transaction records by acceptance month and current status.
          </desc>

          {yTicks.map(tick => (
            <g key={tick}>
              <line
                className="transparency-chart__grid"
                x1={PADDING.left}
                x2={chartWidth - PADDING.right}
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
              <g key={outcome.periodStart}>
                <title>
                  {`${longMonth.format(utcDate(outcome.periodStart))}: `
                    + `${outcome.accepted} accepted, ${outcome.completed} completed, `
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
                    x={index === 0 ? PADDING.left : index === outcomes.length - 1 ? chartWidth - PADDING.right : x + barWidth / 2}
                    y={CHART_HEIGHT - 10}
                  >
                    {shortMonth.format(utcDate(outcome.periodStart))}
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
        <summary>Inspect the complete monthly history</summary>
        <div className="transparency-data-table__scroll">
          <table>
            <thead>
              <tr>
                <th>Month (UTC)</th>
                <th>Accepted</th>
                <th>Completed</th>
                <th>Failed</th>
                <th>In flight</th>
                <th>Other terminal</th>
              </tr>
            </thead>
            <tbody>
              {outcomes.map(outcome => (
                <tr key={outcome.periodStart}>
                  <th scope="row">
                    {longMonth.format(utcDate(outcome.periodStart))}
                  </th>
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

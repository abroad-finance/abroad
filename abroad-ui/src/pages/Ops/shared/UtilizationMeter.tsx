import { cn } from '../../../shared/utils'

interface UtilizationMeterProps {
  cap: null | number | undefined
  className?: string
  deficit: null | number | undefined
}

/**
 * Float utilization bar with ONE threshold set and ONE palette, shared by the
 * Treasury and Bridge pages (which previously coded the meter twice with different
 * thresholds and colors). Renders nothing when there is no positive cap.
 */
export const UtilizationMeter = ({ cap, className, deficit }: UtilizationMeterProps) => {
  if (!cap || cap <= 0) return null

  // Report the TRUE utilization — an over-drawn float reads past 100% rather
  // than pinning at it, so ops can see how far over the cap exposure has run.
  // Only the bar width is clamped, since it cannot render wider than its track.
  const pct = Math.max(0, Math.round(((deficit ?? 0) / cap) * 100))
  const barWidth = Math.min(100, pct)
  const barColor = pct >= 90 ? 'bg-rose-500' : pct >= 70 ? 'bg-amber-400' : 'bg-emerald-500'

  return (
    <div className={className}>
      <div className="flex items-center justify-between text-xs text-ops-muted">
        <span>Utilization</span>
        <span className="tabular-nums">
          {pct}
          %
        </span>
      </div>
      <div
        aria-label="Float utilization"
        aria-valuemax={Math.max(100, pct)}
        aria-valuemin={0}
        aria-valuenow={pct}
        className="mt-1 h-3 w-full overflow-hidden rounded-full bg-slate-100"
        role="progressbar"
      >
        <div className={cn('h-full rounded-full transition-all', barColor)} style={{ width: `${barWidth}%` }} />
      </div>
    </div>
  )
}

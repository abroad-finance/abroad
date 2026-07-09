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

  const pct = Math.min(100, Math.max(0, Math.round(((deficit ?? 0) / cap) * 100)))
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
        aria-valuemax={100}
        aria-valuemin={0}
        aria-valuenow={pct}
        className="mt-1 h-3 w-full overflow-hidden rounded-full bg-slate-100"
        role="progressbar"
      >
        <div className={cn('h-full rounded-full transition-all', barColor)} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

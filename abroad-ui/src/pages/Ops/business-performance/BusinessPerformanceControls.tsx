import type { BusinessPerformanceRange } from '../../../services/admin/businessPerformanceTypes'
import type { BusinessPerformancePreset } from './businessPerformanceRanges'

import { OpsField } from '../shared'
import {
  BUSINESS_PERFORMANCE_PRESETS,
  inputValueToUtcIso,
  utcIsoToInputValue,
} from './businessPerformanceRanges'

export type ComparisonMode = 'CUSTOM' | 'PREVIOUS_EQUAL'

type Props = {
  comparison: BusinessPerformanceRange
  comparisonMode: ComparisonMode
  disabled: boolean
  error: null | string
  onApply: () => void
  onComparisonChange: (range: BusinessPerformanceRange) => void
  onComparisonModeChange: (mode: ComparisonMode) => void
  onPresetChange: (preset: BusinessPerformancePreset) => void
  onPrimaryChange: (range: BusinessPerformanceRange) => void
  preset: BusinessPerformancePreset
  primary: BusinessPerformanceRange
}

const UtcRangeFields = ({ legend, onChange, range }: {
  legend: string
  onChange: (range: BusinessPerformanceRange) => void
  range: BusinessPerformanceRange
}) => (
  <fieldset className="grid gap-3 sm:grid-cols-2">
    <legend className="sr-only">{legend}</legend>
    <OpsField hint="Inclusive UTC boundary" label="From (UTC)">
      <input
        className="ops-input w-full"
        name={`${legend}-from`}
        onChange={(event) => {
          const from = inputValueToUtcIso(event.target.value)
          if (from) onChange({ ...range, from })
        }}
        type="datetime-local"
        value={utcIsoToInputValue(range.from)}
      />
    </OpsField>
    <OpsField hint="Exclusive UTC boundary" label="To (UTC)">
      <input
        className="ops-input w-full"
        name={`${legend}-to`}
        onChange={(event) => {
          const to = inputValueToUtcIso(event.target.value)
          if (to) onChange({ ...range, to })
        }}
        type="datetime-local"
        value={utcIsoToInputValue(range.to)}
      />
    </OpsField>
  </fieldset>
)

export const BusinessPerformanceControls = ({
  comparison,
  comparisonMode,
  disabled,
  error,
  onApply,
  onComparisonChange,
  onComparisonModeChange,
  onPresetChange,
  onPrimaryChange,
  preset,
  primary,
}: Props) => (
  <section aria-labelledby="performance-range-heading" className="ops-card mt-8 p-5 sm:p-6">
    <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
      <div>
        <h2 className="text-base font-semibold text-ops-text" id="performance-range-heading">Reporting ranges</h2>
        <p className="mt-1 text-sm text-ops-muted">Every boundary, comparison, and displayed timestamp uses UTC.</p>
      </div>
      <button className="ops-btn-primary" disabled={disabled} onClick={onApply} type="button">
        {disabled ? 'Loading…' : 'Apply ranges'}
      </button>
    </div>
    <div className="mt-5 grid gap-5 xl:grid-cols-2">
      <div className="space-y-4">
        <OpsField label="Primary preset">
          <select
            className="ops-input w-full"
            name="business-performance-preset"
            onChange={event => onPresetChange(event.target.value as BusinessPerformancePreset)}
            value={preset}
          >
            {BUSINESS_PERFORMANCE_PRESETS.map(option => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </OpsField>
        {preset === 'CUSTOM' && (
          <UtcRangeFields legend="primary-range" onChange={onPrimaryChange} range={primary} />
        )}
      </div>
      <div className="space-y-4">
        <OpsField label="Comparison">
          <select
            className="ops-input w-full"
            name="business-performance-comparison"
            onChange={event => onComparisonModeChange(event.target.value as ComparisonMode)}
            value={comparisonMode}
          >
            <option value="PREVIOUS_EQUAL">Immediately preceding equal period</option>
            <option value="CUSTOM">Custom comparison range</option>
          </select>
        </OpsField>
        {comparisonMode === 'CUSTOM' && (
          <UtcRangeFields legend="comparison-range" onChange={onComparisonChange} range={comparison} />
        )}
      </div>
    </div>
    {error && <p className="mt-4 text-sm font-medium text-rose-700" role="alert">{error}</p>}
  </section>
)

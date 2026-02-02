import {
  useCallback, useEffect, useMemo, useState,
} from 'react'
import { Link } from 'react-router-dom'

import {
  createFlowDefinition,
  listFlowCorridors,
  listFlowDefinitions,
  updateFlowCorridor,
  updateFlowDefinition,
} from '../../services/admin/flowAdminApi'
import {
  FlowBusinessStep,
  FlowCorridor,
  FlowCorridorSupportStatus,
  FlowDefinition,
  FlowDefinitionInput,
  FlowPricingProvider,
  FlowVenue,
  PaymentMethod,
  SupportedCurrency,
} from '../../services/admin/flowTypes'
import { useOpsApiKey } from '../../services/admin/opsAuthStore'
import OpsApiKeyPanel from './OpsApiKeyPanel'

const venues: FlowVenue[] = ['BINANCE', 'TRANSFERO']
const payoutProviders: PaymentMethod[] = ['BREB', 'PIX']
const pricingProviders: FlowPricingProvider[] = ['BINANCE', 'TRANSFERO']
const supportedCurrencies: SupportedCurrency[] = [
  'USDC',
  'USDT',
  'COP',
  'BRL',
]
const transferoSourceAssets: SupportedCurrency[] = ['USDC', 'USDT']
const pricingProviderDefaults: Record<FlowPricingProvider, { exchangeFeePct: number }> = {
  BINANCE: { exchangeFeePct: 0.0085 },
  TRANSFERO: { exchangeFeePct: 0.001 },
}
const payoutProviderDefaults: Record<PaymentMethod, { fixedFee: number, maxAmount: null | number, minAmount: null | number }> = {
  BREB: { fixedFee: 0, maxAmount: 5_000_000, minAmount: 5_000 },
  PIX: { fixedFee: 0, maxAmount: null, minAmount: 0 },
}

type DefinitionDraft = {
  blockchain: string
  cryptoCurrency: string
  enabled: boolean
  exchangeFeePct: string
  fixedFee: string
  id?: string
  maxAmount: string
  minAmount: string
  name: string
  payoutProvider: PaymentMethod
  pricingProvider: FlowPricingProvider
  steps: FlowBusinessStep[]
  targetCurrency: string
}

type ValidationErrorMap = Record<string, string>

const buildCorridorKey = (corridor: {
  blockchain: string
  cryptoCurrency: string
  targetCurrency: string
}): string => `${corridor.cryptoCurrency}:${corridor.blockchain}:${corridor.targetCurrency}`

const formatDate = (value: null | string | undefined): string => {
  if (!value) return '—'
  return new Date(value).toLocaleString()
}

const defaultPayoutProvider = (targetCurrency: string): PaymentMethod => (
  targetCurrency === 'BRL' ? 'PIX' : 'BREB'
)

const defaultPricingProvider = (targetCurrency: string): FlowPricingProvider => (
  targetCurrency === 'BRL' ? 'TRANSFERO' : 'BINANCE'
)

const getConvertFromOptions = (venue: FlowVenue): SupportedCurrency[] => (
  venue === 'TRANSFERO' ? transferoSourceAssets : supportedCurrencies
)

const getConvertToOptions = (venue: FlowVenue, targetCurrency: string): SupportedCurrency[] => (
  venue === 'TRANSFERO'
    ? [targetCurrency as SupportedCurrency]
    : supportedCurrencies
)

const toAmountInput = (value: null | number): string => (value === null ? '' : String(value))

const getPayoutDefaults = (provider: PaymentMethod): { fixedFee: string, maxAmount: string, minAmount: string } => {
  const defaults = payoutProviderDefaults[provider]
  return {
    fixedFee: String(defaults.fixedFee),
    maxAmount: toAmountInput(defaults.maxAmount),
    minAmount: toAmountInput(defaults.minAmount),
  }
}

const getPricingDefaults = (provider: FlowPricingProvider): string => (
  String(pricingProviderDefaults[provider].exchangeFeePct)
)

const buildEmptyDraft = (corridor: FlowCorridor): DefinitionDraft => {
  const payoutProvider = defaultPayoutProvider(corridor.targetCurrency)
  const pricingProvider = defaultPricingProvider(corridor.targetCurrency)
  const payoutDefaults = getPayoutDefaults(payoutProvider)
  const exchangeFeePct = getPricingDefaults(pricingProvider)

  return {
    blockchain: corridor.blockchain,
    cryptoCurrency: corridor.cryptoCurrency,
    enabled: true,
    exchangeFeePct,
    fixedFee: payoutDefaults.fixedFee,
    maxAmount: payoutDefaults.maxAmount,
    minAmount: payoutDefaults.minAmount,
    name: '',
    payoutProvider,
    pricingProvider,
    steps: [{ type: 'PAYOUT' }],
    targetCurrency: corridor.targetCurrency,
  }
}

const fromDefinition = (definition: FlowDefinition): DefinitionDraft => ({
  blockchain: definition.blockchain,
  cryptoCurrency: definition.cryptoCurrency,
  enabled: definition.enabled,
  exchangeFeePct: String(definition.exchangeFeePct ?? 0),
  fixedFee: String(definition.fixedFee ?? 0),
  id: definition.id,
  maxAmount: definition.maxAmount === null ? '' : String(definition.maxAmount),
  minAmount: definition.minAmount === null ? '' : String(definition.minAmount),
  name: definition.name,
  payoutProvider: definition.payoutProvider,
  pricingProvider: definition.pricingProvider,
  steps: definition.steps.length > 0 ? definition.steps : [{ type: 'PAYOUT' }],
  targetCurrency: definition.targetCurrency,
})

const parseNumberField = (value: string, fallback: number): number => {
  if (!value.trim()) return fallback
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

const parseOptionalNumber = (value: string): null | number => {
  if (!value.trim()) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

const isNumeric = (value: string): boolean => {
  if (!value.trim()) return false
  const parsed = Number(value)
  return Number.isFinite(parsed)
}

const isTargetCurrency = (value: SupportedCurrency): boolean => value === 'BRL' || value === 'COP'

const FlowDefinitions = () => {
  const opsApiKey = useOpsApiKey()
  const [corridors, setCorridors] = useState<FlowCorridor[]>([])
  const [corridorSummary, setCorridorSummary] = useState<null | { defined: number, missing: number, total: number, unsupported: number }>(null)
  const [definitions, setDefinitions] = useState<FlowDefinition[]>([])
  const [selectedKey, setSelectedKey] = useState<null | string>(null)
  const [draft, setDraft] = useState<DefinitionDraft | null>(null)
  const [baseline, setBaseline] = useState<null | string>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<null | string>(null)
  const [validationErrors, setValidationErrors] = useState<ValidationErrorMap>({})
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<'all' | 'defined' | 'missing' | 'unsupported'>('all')
  const [unsupportedReason, setUnsupportedReason] = useState('')
  const [newStepType, setNewStepType] = useState<'CONVERT' | 'MOVE_TO_EXCHANGE' | 'TRANSFER_VENUE'>('MOVE_TO_EXCHANGE')

  const definitionsById = useMemo(() => new Map(definitions.map(def => [def.id, def])), [definitions])
  const corridorByKey = useMemo(() => new Map(corridors.map(corridor => [buildCorridorKey(corridor), corridor])), [corridors])

  const selectedCorridor = selectedKey ? corridorByKey.get(selectedKey) ?? null : null

  const isDirty = useMemo(() => {
    if (!draft || !baseline) return false
    return JSON.stringify(draft) !== baseline
  }, [baseline, draft])

  const filteredCorridors = useMemo(() => {
    const term = search.trim().toLowerCase()
    return corridors.filter((corridor) => {
      if (filter === 'defined' && corridor.status !== 'DEFINED') return false
      if (filter === 'missing' && corridor.status !== 'MISSING') return false
      if (filter === 'unsupported' && corridor.status !== 'UNSUPPORTED') return false
      if (!term) return true
      const label = `${corridor.cryptoCurrency} ${corridor.blockchain} ${corridor.targetCurrency}`.toLowerCase()
      return label.includes(term)
    })
  }, [
    corridors,
    filter,
    search,
  ])

  const loadData = useCallback(async () => {
    if (!opsApiKey) {
      setCorridors([])
      setCorridorSummary(null)
      setDefinitions([])
      setDraft(null)
      setSelectedKey(null)
      setBaseline(null)
      return
    }

    setLoading(true)
    setError(null)

    try {
      const [corridorResult, definitionResult] = await Promise.all([listFlowCorridors(), listFlowDefinitions()])
      setCorridors(corridorResult.corridors)
      setCorridorSummary(corridorResult.summary)
      setDefinitions(definitionResult)
    }
    catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load corridor coverage')
    }
    finally {
      setLoading(false)
    }
  }, [opsApiKey])

  useEffect(() => {
    void loadData()
  }, [loadData])

  const selectCorridor = (corridor: FlowCorridor) => {
    setSelectedKey(buildCorridorKey(corridor))
    const definition = corridor.definitionId ? definitionsById.get(corridor.definitionId) : null
    const nextDraft = definition ? fromDefinition(definition) : buildEmptyDraft(corridor)
    setDraft(nextDraft)
    setBaseline(JSON.stringify(nextDraft))
    setValidationErrors({})
    setUnsupportedReason(corridor.unsupportedReason ?? '')
  }

  const updateDraftField = (field: keyof DefinitionDraft, value: boolean | string) => {
    if (!draft) return

    if (field === 'payoutProvider' && typeof value === 'string') {
      const nextProvider = value as PaymentMethod
      const currentDefaults = getPayoutDefaults(draft.payoutProvider)
      const nextDefaults = getPayoutDefaults(nextProvider)

      const nextDraft: DefinitionDraft = {
        ...draft,
        payoutProvider: nextProvider,
      }

      if (draft.fixedFee === currentDefaults.fixedFee) {
        nextDraft.fixedFee = nextDefaults.fixedFee
      }
      if (draft.minAmount === currentDefaults.minAmount) {
        nextDraft.minAmount = nextDefaults.minAmount
      }
      if (draft.maxAmount === currentDefaults.maxAmount) {
        nextDraft.maxAmount = nextDefaults.maxAmount
      }

      setDraft(nextDraft)
      return
    }

    if (field === 'pricingProvider' && typeof value === 'string') {
      const nextProvider = value as FlowPricingProvider
      const currentDefault = getPricingDefaults(draft.pricingProvider)
      const nextDefault = getPricingDefaults(nextProvider)

      const nextDraft: DefinitionDraft = {
        ...draft,
        pricingProvider: nextProvider,
      }

      if (draft.exchangeFeePct === currentDefault) {
        nextDraft.exchangeFeePct = nextDefault
      }

      setDraft(nextDraft)
      return
    }

    setDraft({ ...draft, [field]: value })
  }

  const updateStep = (index: number, updater: (step: FlowBusinessStep) => FlowBusinessStep) => {
    if (!draft) return
    const steps = draft.steps.map((step, idx) => (idx === index ? updater(step) : step))
    setDraft({ ...draft, steps })
  }

  const reorderStep = (index: number, direction: 'down' | 'up') => {
    if (!draft) return
    if (index === 0) return
    const steps = [...draft.steps]
    const targetIndex = direction === 'up' ? index - 1 : index + 1
    if (targetIndex <= 0 || targetIndex >= steps.length) return
    const temp = steps[index]
    steps[index] = steps[targetIndex]
    steps[targetIndex] = temp
    setDraft({ ...draft, steps })
  }

  const removeStep = (index: number) => {
    if (!draft) return
    if (index === 0) return
    const steps = draft.steps.filter((_, idx) => idx !== index)
    setDraft({ ...draft, steps })
  }

  const addStep = () => {
    if (!draft) return
    const baseAsset = draft.cryptoCurrency as SupportedCurrency
    const newStep: FlowBusinessStep = newStepType === 'MOVE_TO_EXCHANGE'
      ? { type: 'MOVE_TO_EXCHANGE', venue: 'BINANCE' }
      : newStepType === 'TRANSFER_VENUE'
        ? {
            asset: baseAsset,
            fromVenue: 'BINANCE',
            toVenue: 'TRANSFERO',
            type: 'TRANSFER_VENUE',
          }
        : {
            fromAsset: baseAsset,
            toAsset: draft.targetCurrency as SupportedCurrency,
            type: 'CONVERT',
            venue: 'BINANCE',
          }

    setDraft({ ...draft, steps: [...draft.steps, newStep] })
  }

  const validateDraft = (draftToValidate: DefinitionDraft): { errors: ValidationErrorMap, ok: boolean, payload?: FlowDefinitionInput } => {
    const errors: ValidationErrorMap = {}

    if (!draftToValidate.name.trim()) {
      errors.name = 'Name is required.'
    }

    if (draftToValidate.exchangeFeePct.trim() && !isNumeric(draftToValidate.exchangeFeePct)) {
      errors.exchangeFeePct = 'Exchange fee must be a number.'
    }
    if (draftToValidate.fixedFee.trim() && !isNumeric(draftToValidate.fixedFee)) {
      errors.fixedFee = 'Fixed fee must be a number.'
    }
    if (draftToValidate.minAmount.trim() && !isNumeric(draftToValidate.minAmount)) {
      errors.minAmount = 'Minimum amount must be a number.'
    }
    if (draftToValidate.maxAmount.trim() && !isNumeric(draftToValidate.maxAmount)) {
      errors.maxAmount = 'Maximum amount must be a number.'
    }

    const minValue = parseOptionalNumber(draftToValidate.minAmount)
    const maxValue = parseOptionalNumber(draftToValidate.maxAmount)
    if (minValue !== null && maxValue !== null && minValue > maxValue) {
      errors.maxAmount = 'Maximum amount must be greater than minimum amount.'
    }

    if (draftToValidate.steps.length === 0 || draftToValidate.steps[0].type !== 'PAYOUT') {
      errors.steps = 'The flow must start with a payout step.'
    }

    let currentLocation: 'HOT_WALLET' | FlowVenue = 'HOT_WALLET'
    let currentAsset = draftToValidate.cryptoCurrency as SupportedCurrency

    draftToValidate.steps.forEach((step, index) => {
      if (index === 0 && step.type !== 'PAYOUT') {
        errors[`step-${index}`] = 'First step must be payout.'
        return
      }

      if (index > 0 && step.type === 'PAYOUT') {
        errors[`step-${index}`] = 'Payout step can only be first.'
        return
      }

      if (step.type === 'MOVE_TO_EXCHANGE') {
        if (currentLocation !== 'HOT_WALLET') {
          errors[`step-${index}`] = 'Funds must be in hot wallet to move to an exchange.'
        }
        currentLocation = step.venue
        return
      }

      if (step.type === 'CONVERT') {
        if (currentLocation !== step.venue) {
          errors[`step-${index}`] = `Conversion requires funds at ${step.venue}.`
        }
        if (currentAsset !== step.fromAsset) {
          errors[`step-${index}`] = `Conversion source asset must be ${currentAsset}.`
        }
        if (step.fromAsset === step.toAsset) {
          errors[`step-${index}`] = 'Conversion assets must be different.'
        }
        if (step.venue === 'TRANSFERO') {
          if (!isTargetCurrency(step.toAsset)) {
            errors[`step-${index}`] = 'Transfero conversions must end in fiat.'
          }
          if (step.toAsset !== draftToValidate.targetCurrency) {
            errors[`step-${index}`] = 'Transfero conversion must target the corridor fiat currency.'
          }
          if (isTargetCurrency(step.fromAsset)) {
            errors[`step-${index}`] = 'Transfero conversion source must be a crypto asset.'
          }
        }
        currentAsset = step.toAsset
        return
      }

      if (step.type === 'TRANSFER_VENUE') {
        if (currentLocation !== step.fromVenue) {
          errors[`step-${index}`] = `Transfer requires funds at ${step.fromVenue}.`
        }
        if (step.fromVenue === step.toVenue) {
          errors[`step-${index}`] = 'Transfer venues must be different.'
        }
        if (step.fromVenue !== 'BINANCE') {
          errors[`step-${index}`] = 'Only Binance can be used as a transfer source today.'
        }
        if (currentAsset !== step.asset) {
          errors[`step-${index}`] = `Transfer asset must be ${currentAsset}.`
        }
        currentLocation = step.toVenue
      }
    })

    if (Object.keys(errors).length > 0) {
      return { errors, ok: false }
    }

    const payload: FlowDefinitionInput = {
      blockchain: draftToValidate.blockchain,
      cryptoCurrency: draftToValidate.cryptoCurrency,
      enabled: draftToValidate.enabled,
      exchangeFeePct: parseNumberField(draftToValidate.exchangeFeePct, 0),
      fixedFee: parseNumberField(draftToValidate.fixedFee, 0),
      maxAmount: parseOptionalNumber(draftToValidate.maxAmount),
      minAmount: parseOptionalNumber(draftToValidate.minAmount),
      name: draftToValidate.name.trim(),
      payoutProvider: draftToValidate.payoutProvider,
      pricingProvider: draftToValidate.pricingProvider,
      steps: draftToValidate.steps,
      targetCurrency: draftToValidate.targetCurrency,
    }

    return { errors: {}, ok: true, payload }
  }

  const handleSave = async () => {
    if (!draft) return
    setSaving(true)
    setError(null)

    const validation = validateDraft(draft)
    if (!validation.ok || !validation.payload) {
      setValidationErrors(validation.errors)
      setSaving(false)
      return
    }

    try {
      const saved = draft.id
        ? await updateFlowDefinition(draft.id, validation.payload)
        : await createFlowDefinition(validation.payload)

      await loadData()
      const nextDraft = fromDefinition(saved)
      setSelectedKey(buildCorridorKey(saved))
      setDraft(nextDraft)
      setBaseline(JSON.stringify(nextDraft))
      setValidationErrors({})
      setError(null)
    }
    catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save flow definition')
    }
    finally {
      setSaving(false)
    }
  }

  const handleCorridorStatus = async (status: FlowCorridorSupportStatus) => {
    if (!selectedCorridor) return
    setSaving(true)
    setError(null)

    try {
      await updateFlowCorridor({
        blockchain: selectedCorridor.blockchain,
        cryptoCurrency: selectedCorridor.cryptoCurrency,
        reason: unsupportedReason.trim() || undefined,
        status,
        targetCurrency: selectedCorridor.targetCurrency,
      })
      await loadData()
    }
    catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update corridor status')
    }
    finally {
      setSaving(false)
    }
  }

  const corridorTitle = (corridor: FlowCorridor): string => (
    `${corridor.cryptoCurrency} · ${corridor.blockchain} → ${corridor.targetCurrency}`
  )

  return (
    <div className="min-h-screen bg-[#F7F3EC] text-[#1A1A1A]">
      <div className="relative overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(27,94,89,0.18),_transparent_55%)]" />
        <div className="relative max-w-7xl mx-auto px-6 py-10">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-4 text-sm">
                <Link className="text-[#1B4D48] hover:text-[#356E6A]" to="/ops/flows">← Back to runs</Link>
                <Link className="text-[#1B4D48] hover:text-[#356E6A]" to="/ops/crypto-assets">Crypto asset coverage</Link>
              </div>
              <div className="mt-3 text-sm uppercase tracking-[0.3em] text-[#356E6A]">Flow Coverage</div>
              <h1 className="text-3xl md:text-4xl font-semibold">Corridor Flow Builder</h1>
              <p className="text-sm text-[#4B5563] max-w-xl mt-2">
                Define the business pipeline for each corridor. System logic handles payouts, waits, and refunds automatically.
              </p>
            </div>
            <div className="flex items-center gap-3">
              <button
                className="px-4 py-2 rounded-xl border border-[#1B4D48] text-[#1B4D48] bg-white/70 hover:bg-white transition"
                disabled={!opsApiKey || loading}
                onClick={() => void loadData()}
                type="button"
              >
                Refresh
              </button>
            </div>
          </div>

          <OpsApiKeyPanel />

          {error && (
            <div className="mt-6 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {error}
            </div>
          )}

          {!opsApiKey && (
            <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
              Ops API key required to load corridor coverage.
            </div>
          )}

          <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-4">
            <div className="rounded-2xl border border-white/70 bg-white/80 p-4 shadow-[0_16px_40px_-35px_rgba(15,23,42,0.45)]">
              <div className="text-xs uppercase tracking-[0.3em] text-[#6B7280]">Total</div>
              <div className="mt-2 text-2xl font-semibold">{corridorSummary?.total ?? '—'}</div>
            </div>
            <div className="rounded-2xl border border-white/70 bg-white/80 p-4 shadow-[0_16px_40px_-35px_rgba(15,23,42,0.45)]">
              <div className="text-xs uppercase tracking-[0.3em] text-[#6B7280]">Defined</div>
              <div className="mt-2 text-2xl font-semibold text-emerald-700">{corridorSummary?.defined ?? '—'}</div>
            </div>
            <div className="rounded-2xl border border-white/70 bg-white/80 p-4 shadow-[0_16px_40px_-35px_rgba(15,23,42,0.45)]">
              <div className="text-xs uppercase tracking-[0.3em] text-[#6B7280]">Missing</div>
              <div className="mt-2 text-2xl font-semibold text-rose-700">{corridorSummary?.missing ?? '—'}</div>
            </div>
            <div className="rounded-2xl border border-white/70 bg-white/80 p-4 shadow-[0_16px_40px_-35px_rgba(15,23,42,0.45)]">
              <div className="text-xs uppercase tracking-[0.3em] text-[#6B7280]">Unsupported</div>
              <div className="mt-2 text-2xl font-semibold text-amber-700">{corridorSummary?.unsupported ?? '—'}</div>
            </div>
          </div>

          <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-[1.1fr_2fr]">
            <div className="rounded-2xl border border-white/70 bg-white/80 p-5 shadow-[0_20px_45px_-35px_rgba(15,23,42,0.45)]">
              <div className="flex flex-col gap-3">
                <div className="text-sm font-semibold">Corridors</div>
                <input
                  className="w-full rounded-xl border border-[#DADADA] bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#356E6A]/40"
                  onChange={event => setSearch(event.target.value)}
                  placeholder="Search corridor"
                  value={search}
                />
                <div className="flex flex-wrap gap-2 text-xs">
                  {[
                    'all',
                    'defined',
                    'missing',
                    'unsupported',
                  ].map(value => (
                    <button
                      className={`rounded-full border px-3 py-1 ${filter === value ? 'border-[#356E6A] bg-[#356E6A]/10 text-[#1B4D48]' : 'border-[#DADADA] text-[#6B7280]'}`}
                      key={value}
                      onClick={() => setFilter(value as typeof filter)}
                      type="button"
                    >
                      {value}
                    </button>
                  ))}
                </div>
              </div>
              <div className="mt-4 space-y-3">
                {loading && (
                  <div className="text-xs text-[#6B7280]">Loading corridors...</div>
                )}
                {!loading && opsApiKey && filteredCorridors.length === 0 && (
                  <div className="rounded-xl border border-dashed border-[#C6C6C6] bg-white/70 px-4 py-6 text-center text-xs text-[#6B7280]">
                    No corridors found.
                  </div>
                )}
                {filteredCorridors.map(corridor => (
                  <button
                    className={`w-full text-left rounded-xl border px-4 py-3 transition ${
                      selectedKey === buildCorridorKey(corridor)
                        ? 'border-[#356E6A] bg-[#356E6A]/10'
                        : 'border-white/70 bg-white/60 hover:bg-white'
                    }`}
                    key={buildCorridorKey(corridor)}
                    onClick={() => selectCorridor(corridor)}
                    type="button"
                  >
                    <div className="text-sm font-semibold">{corridorTitle(corridor)}</div>
                    <div className="mt-1 flex items-center gap-2 text-[11px] text-[#6B7280]">
                      <span className={`rounded-full px-2 py-[2px] ${
                        corridor.status === 'DEFINED'
                          ? 'bg-emerald-100 text-emerald-700'
                          : corridor.status === 'UNSUPPORTED'
                            ? 'bg-amber-100 text-amber-700'
                            : 'bg-rose-100 text-rose-700'
                      }`}
                      >
                        {corridor.status === 'DEFINED' ? 'Defined' : corridor.status === 'UNSUPPORTED' ? 'Unsupported' : 'Missing'}
                      </span>
                      {corridor.definitionName && (
                        <span>{corridor.definitionName}</span>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            <div className="rounded-2xl border border-white/70 bg-white/80 p-6 shadow-[0_20px_45px_-35px_rgba(15,23,42,0.45)]">
              {draft && selectedCorridor
                ? (
                    <>
                      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                        <div>
                          <div className="text-xs uppercase tracking-wider text-[#6B7280]">Corridor</div>
                          <div className="text-lg font-semibold">{corridorTitle(selectedCorridor)}</div>
                          <div className="text-xs text-[#6B7280]">
                            Updated
                            {formatDate(selectedCorridor.updatedAt)}
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            className="rounded-xl border border-[#DADADA] bg-white px-3 py-2 text-xs font-semibold text-[#1F2937] hover:bg-[#F5F5F5]"
                            disabled={!isDirty}
                            onClick={() => {
                              if (!baseline) return
                              setDraft(JSON.parse(baseline) as DefinitionDraft)
                              setValidationErrors({})
                            }}
                            type="button"
                          >
                            Discard changes
                          </button>
                          <button
                            className="rounded-xl border border-[#356E6A] bg-[#356E6A] px-4 py-2 text-xs font-semibold text-white hover:bg-[#2B5B57]"
                            disabled={saving || !opsApiKey}
                            onClick={() => void handleSave()}
                            type="button"
                          >
                            {saving ? 'Saving…' : draft.id ? 'Save flow' : 'Create flow'}
                          </button>
                        </div>
                      </div>

                      <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
                        <div>
                          <label className="text-xs uppercase tracking-wider text-[#5B6B6A]">Name</label>
                          <input
                            className="mt-2 w-full rounded-xl border border-[#DADADA] bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#356E6A]/40"
                            onChange={event => updateDraftField('name', event.target.value)}
                            value={draft.name}
                          />
                          {validationErrors.name && (
                            <div className="mt-1 text-xs text-rose-600">{validationErrors.name}</div>
                          )}
                        </div>
                        <div className="flex items-center gap-3">
                          <label className="text-xs uppercase tracking-wider text-[#5B6B6A]">Enabled</label>
                          <button
                            className={`rounded-full border px-4 py-2 text-xs font-semibold transition ${
                              draft.enabled ? 'border-emerald-300 bg-emerald-100 text-emerald-800' : 'border-rose-300 bg-rose-100 text-rose-800'
                            }`}
                            onClick={() => updateDraftField('enabled', !draft.enabled)}
                            type="button"
                          >
                            {draft.enabled ? 'Enabled' : 'Disabled'}
                          </button>
                        </div>
                        <div>
                          <label className="text-xs uppercase tracking-wider text-[#5B6B6A]">Payout Provider</label>
                          <select
                            className="mt-2 w-full rounded-xl border border-[#DADADA] bg-white px-3 py-2 text-sm"
                            onChange={event => updateDraftField('payoutProvider', event.target.value)}
                            value={draft.payoutProvider}
                          >
                            {payoutProviders.map(item => (
                              <option key={item} value={item}>{item}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="text-xs uppercase tracking-wider text-[#5B6B6A]">Pricing Provider</label>
                          <select
                            className="mt-2 w-full rounded-xl border border-[#DADADA] bg-white px-3 py-2 text-sm"
                            onChange={event => updateDraftField('pricingProvider', event.target.value)}
                            value={draft.pricingProvider}
                          >
                            {pricingProviders.map(item => (
                              <option key={item} value={item}>{item}</option>
                            ))}
                          </select>
                        </div>
                      </div>

                      <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-4">
                        <div>
                          <label className="text-xs uppercase tracking-wider text-[#5B6B6A]">Exchange Fee %</label>
                          <input
                            className="mt-2 w-full rounded-xl border border-[#DADADA] bg-white px-3 py-2 text-sm"
                            onChange={event => updateDraftField('exchangeFeePct', event.target.value)}
                            type="number"
                            value={draft.exchangeFeePct}
                          />
                          {validationErrors.exchangeFeePct && (
                            <div className="mt-1 text-xs text-rose-600">{validationErrors.exchangeFeePct}</div>
                          )}
                        </div>
                        <div>
                          <label className="text-xs uppercase tracking-wider text-[#5B6B6A]">Fixed Fee</label>
                          <input
                            className="mt-2 w-full rounded-xl border border-[#DADADA] bg-white px-3 py-2 text-sm"
                            onChange={event => updateDraftField('fixedFee', event.target.value)}
                            type="number"
                            value={draft.fixedFee}
                          />
                          {validationErrors.fixedFee && (
                            <div className="mt-1 text-xs text-rose-600">{validationErrors.fixedFee}</div>
                          )}
                        </div>
                        <div>
                          <label className="text-xs uppercase tracking-wider text-[#5B6B6A]">
                            Min Amount
                            <span className="ml-1">
                              (
                              {draft.targetCurrency}
                              )
                            </span>
                          </label>
                          <input
                            className="mt-2 w-full rounded-xl border border-[#DADADA] bg-white px-3 py-2 text-sm"
                            onChange={event => updateDraftField('minAmount', event.target.value)}
                            type="number"
                            value={draft.minAmount}
                          />
                          {validationErrors.minAmount && (
                            <div className="mt-1 text-xs text-rose-600">{validationErrors.minAmount}</div>
                          )}
                        </div>
                        <div>
                          <label className="text-xs uppercase tracking-wider text-[#5B6B6A]">
                            Max Amount
                            <span className="ml-1">
                              (
                              {draft.targetCurrency}
                              )
                            </span>
                          </label>
                          <input
                            className="mt-2 w-full rounded-xl border border-[#DADADA] bg-white px-3 py-2 text-sm"
                            onChange={event => updateDraftField('maxAmount', event.target.value)}
                            type="number"
                            value={draft.maxAmount}
                          />
                          {validationErrors.maxAmount && (
                            <div className="mt-1 text-xs text-rose-600">{validationErrors.maxAmount}</div>
                          )}
                        </div>
                      </div>

                      <div className="mt-6 rounded-2xl border border-dashed border-[#C6C6C6] bg-white/60 p-4">
                        <div className="text-sm font-semibold">System enforced gates</div>
                        <p className="mt-1 text-xs text-[#6B7280]">
                          Payout confirmation and refunds are handled automatically. Exchange balance waits are inserted when funds move between venues.
                        </p>
                      </div>

                      <div className="mt-8">
                        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                          <div>
                            <div className="text-sm font-semibold">Pipeline Steps</div>
                            <div className="text-xs text-[#6B7280]">Business steps only — no technical configuration required.</div>
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            <select
                              className="rounded-xl border border-[#DADADA] bg-white px-3 py-2 text-xs"
                              onChange={event => setNewStepType(event.target.value as typeof newStepType)}
                              value={newStepType}
                            >
                              <option value="MOVE_TO_EXCHANGE">Move to exchange</option>
                              <option value="CONVERT">Convert</option>
                              <option value="TRANSFER_VENUE">Transfer venue</option>
                            </select>
                            <button
                              className="rounded-xl border border-[#356E6A] bg-[#356E6A] px-3 py-2 text-xs font-semibold text-white hover:bg-[#2B5B57]"
                              onClick={addStep}
                              type="button"
                            >
                              Add Step
                            </button>
                          </div>
                        </div>

                        {validationErrors.steps && (
                          <div className="mt-2 text-xs text-rose-600">{validationErrors.steps}</div>
                        )}

                        <div className="mt-4 space-y-4">
                          {draft.steps.map((step, index) => (
                            <div
                              className="rounded-2xl border border-white/70 bg-white/90 p-4 shadow-[0_10px_30px_-25px_rgba(15,23,42,0.35)]"
                              key={`${step.type}-${index}`}
                            >
                              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                                <div>
                                  <div className="text-xs uppercase tracking-wider text-[#6B7280]">
                                    Step
                                    {' '}
                                    {index + 1}
                                  </div>
                                  <div className="text-base font-semibold">
                                    {step.type === 'PAYOUT'
                                      ? 'Payout to user'
                                      : step.type === 'MOVE_TO_EXCHANGE'
                                        ? 'Move to exchange'
                                        : step.type === 'CONVERT'
                                          ? 'Convert'
                                          : 'Transfer venue'}
                                  </div>
                                  {validationErrors[`step-${index}`] && (
                                    <div className="mt-1 text-xs text-rose-600">{validationErrors[`step-${index}`]}</div>
                                  )}
                                </div>
                                <div className="flex items-center gap-2">
                                  <button
                                    className="rounded-lg border border-[#DADADA] bg-white px-2 py-1 text-xs"
                                    disabled={index <= 1}
                                    onClick={() => reorderStep(index, 'up')}
                                    type="button"
                                  >
                                    ↑
                                  </button>
                                  <button
                                    className="rounded-lg border border-[#DADADA] bg-white px-2 py-1 text-xs"
                                    disabled={index === 0 || index >= draft.steps.length - 1}
                                    onClick={() => reorderStep(index, 'down')}
                                    type="button"
                                  >
                                    ↓
                                  </button>
                                  <button
                                    className="rounded-lg border border-rose-200 bg-rose-50 px-2 py-1 text-xs text-rose-600"
                                    disabled={index === 0}
                                    onClick={() => removeStep(index)}
                                    type="button"
                                  >
                                    Remove
                                  </button>
                                </div>
                              </div>

                              {step.type === 'MOVE_TO_EXCHANGE' && (
                                <div className="mt-4">
                                  <label className="text-xs uppercase tracking-wider text-[#5B6B6A]">Venue</label>
                                  <select
                                    className="mt-2 w-full rounded-xl border border-[#DADADA] bg-white px-3 py-2 text-sm"
                                    onChange={event => updateStep(index, prev => ({
                                      ...prev,
                                      venue: event.target.value as FlowVenue,
                                    }))}
                                    value={step.venue}
                                  >
                                    {venues.map(item => (
                                      <option key={item} value={item}>{item}</option>
                                    ))}
                                  </select>
                                </div>
                              )}

                              {step.type === 'CONVERT' && (
                                <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
                                  <div>
                                    <label className="text-xs uppercase tracking-wider text-[#5B6B6A]">Venue</label>
                                    <select
                                      className="mt-2 w-full rounded-xl border border-[#DADADA] bg-white px-3 py-2 text-sm"
                                      onChange={event => updateStep(index, prev => ({
                                        ...prev,
                                        venue: event.target.value as FlowVenue,
                                      }))}
                                      value={step.venue}
                                    >
                                      {venues.map(item => (
                                        <option key={item} value={item}>{item}</option>
                                      ))}
                                    </select>
                                  </div>
                                  <div>
                                    <label className="text-xs uppercase tracking-wider text-[#5B6B6A]">From</label>
                                    <select
                                      className="mt-2 w-full rounded-xl border border-[#DADADA] bg-white px-3 py-2 text-sm"
                                      onChange={event => updateStep(index, prev => ({
                                        ...prev,
                                        fromAsset: event.target.value as SupportedCurrency,
                                      }))}
                                      value={step.fromAsset}
                                    >
                                      {getConvertFromOptions(step.venue).map(item => (
                                        <option key={item} value={item}>{item}</option>
                                      ))}
                                    </select>
                                  </div>
                                  <div>
                                    <label className="text-xs uppercase tracking-wider text-[#5B6B6A]">To</label>
                                    <select
                                      className="mt-2 w-full rounded-xl border border-[#DADADA] bg-white px-3 py-2 text-sm"
                                      onChange={event => updateStep(index, prev => ({
                                        ...prev,
                                        toAsset: event.target.value as SupportedCurrency,
                                      }))}
                                      value={step.toAsset}
                                    >
                                      {getConvertToOptions(step.venue, draft.targetCurrency).map(item => (
                                        <option key={item} value={item}>{item}</option>
                                      ))}
                                    </select>
                                  </div>
                                </div>
                              )}

                              {step.type === 'TRANSFER_VENUE' && (
                                <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
                                  <div>
                                    <label className="text-xs uppercase tracking-wider text-[#5B6B6A]">From Venue</label>
                                    <select
                                      className="mt-2 w-full rounded-xl border border-[#DADADA] bg-white px-3 py-2 text-sm"
                                      onChange={event => updateStep(index, prev => ({
                                        ...prev,
                                        fromVenue: event.target.value as FlowVenue,
                                      }))}
                                      value={step.fromVenue}
                                    >
                                      {['BINANCE' as FlowVenue].map(item => (
                                        <option key={item} value={item}>{item}</option>
                                      ))}
                                    </select>
                                  </div>
                                  <div>
                                    <label className="text-xs uppercase tracking-wider text-[#5B6B6A]">To Venue</label>
                                    <select
                                      className="mt-2 w-full rounded-xl border border-[#DADADA] bg-white px-3 py-2 text-sm"
                                      onChange={event => updateStep(index, prev => ({
                                        ...prev,
                                        toVenue: event.target.value as FlowVenue,
                                      }))}
                                      value={step.toVenue}
                                    >
                                      {['TRANSFERO' as FlowVenue].map(item => (
                                        <option key={item} value={item}>{item}</option>
                                      ))}
                                    </select>
                                  </div>
                                  <div>
                                    <label className="text-xs uppercase tracking-wider text-[#5B6B6A]">Asset</label>
                                    <select
                                      className="mt-2 w-full rounded-xl border border-[#DADADA] bg-white px-3 py-2 text-sm"
                                      onChange={event => updateStep(index, prev => ({
                                        ...prev,
                                        asset: event.target.value as SupportedCurrency,
                                      }))}
                                      value={step.asset}
                                    >
                                      {transferoSourceAssets.map(item => (
                                        <option key={item} value={item}>{item}</option>
                                      ))}
                                    </select>
                                  </div>
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="mt-8 rounded-2xl border border-white/70 bg-white/60 p-4">
                        <div className="text-sm font-semibold">Corridor Support</div>
                        <p className="mt-1 text-xs text-[#6B7280]">
                          Mark corridors as unsupported to prevent new transactions from being processed.
                        </p>
                        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-[2fr_auto]">
                          <input
                            className="rounded-xl border border-[#DADADA] bg-white px-3 py-2 text-sm"
                            onChange={event => setUnsupportedReason(event.target.value)}
                            placeholder="Optional reason"
                            value={unsupportedReason}
                          />
                          {selectedCorridor.status === 'UNSUPPORTED'
                            ? (
                                <button
                                  className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-xs font-semibold text-emerald-700"
                                  disabled={saving}
                                  onClick={() => void handleCorridorStatus('SUPPORTED')}
                                  type="button"
                                >
                                  Mark Supported
                                </button>
                              )
                            : (
                                <button
                                  className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-xs font-semibold text-amber-700"
                                  disabled={saving}
                                  onClick={() => void handleCorridorStatus('UNSUPPORTED')}
                                  type="button"
                                >
                                  Mark Unsupported
                                </button>
                              )}
                        </div>
                      </div>
                    </>
                  )
                : (
                    <div className="rounded-xl border border-dashed border-[#C6C6C6] bg-white/70 px-6 py-12 text-center text-sm text-[#6B7280]">
                      Select a corridor to create or edit its flow.
                    </div>
                  )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default FlowDefinitions

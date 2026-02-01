import {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react'
import { Link } from 'react-router-dom'

import {
  createFlowDefinition,
  listFlowDefinitions,
  updateFlowDefinition,
} from '../../services/admin/flowAdminApi'
import {
  FlowDefinition,
  FlowDefinitionInput,
  FlowPricingProvider,
  FlowStepCompletionPolicy,
  FlowStepType,
} from '../../services/admin/flowTypes'
import { useOpsApiKey } from '../../services/admin/opsAuthStore'
import OpsApiKeyPanel from './OpsApiKeyPanel'

const blockchains = [
  'STELLAR',
  'SOLANA',
  'CELO',
] as const
const cryptoCurrencies = ['USDC'] as const
const targetCurrencies = ['COP', 'BRL'] as const
const pricingProviders: FlowPricingProvider[] = ['BINANCE', 'TRANSFERO']
const stepTypes: FlowStepType[] = [
  'PAYOUT_SEND',
  'AWAIT_PROVIDER_STATUS',
  'EXCHANGE_SEND',
  'AWAIT_EXCHANGE_BALANCE',
  'EXCHANGE_CONVERT',
  'TREASURY_TRANSFER',
]
const completionPolicies: FlowStepCompletionPolicy[] = ['SYNC', 'AWAIT_EVENT']

const stepHints: Record<FlowStepType, string> = {
  AWAIT_EXCHANGE_BALANCE: 'Wait for exchange balance update signal.',
  AWAIT_PROVIDER_STATUS: 'Wait for provider webhook status update (uses externalId).',
  EXCHANGE_CONVERT: 'Execute a market conversion on exchange.',
  EXCHANGE_SEND: 'Send crypto from hot wallet to exchange deposit address.',
  PAYOUT_SEND: 'Send payout to the user via payment provider.',
  TREASURY_TRANSFER: 'Withdraw assets between venues (e.g., Binance → Transfero).',
}

const defaultConfigForStep = (stepType: FlowStepType): Record<string, unknown> => {
  switch (stepType) {
    case 'AWAIT_EXCHANGE_BALANCE':
      return { provider: 'binance' }
    case 'AWAIT_PROVIDER_STATUS':
      return {}
    case 'EXCHANGE_CONVERT':
      return { provider: 'binance', side: 'SELL', symbol: 'USDCUSDT' }
    case 'EXCHANGE_SEND':
      return {}
    case 'PAYOUT_SEND':
      return {}
    case 'TREASURY_TRANSFER':
      return { asset: 'USDC', destinationProvider: 'transfero', sourceProvider: 'binance' }
  }
}

const formatDate = (value: string) => new Date(value).toLocaleString()

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
  pricingProvider: FlowPricingProvider
  steps: StepDraft[]
  targetCurrency: string
}

type StepDraft = {
  completionPolicy: FlowStepCompletionPolicy
  configText: string
  id?: string
  signalMatchText: string
  stepType: FlowStepType
}

type ValidationErrorMap = Record<string, string>

const toJsonText = (value: null | Record<string, unknown> | undefined): string => {
  if (!value || Object.keys(value).length === 0) return ''
  return JSON.stringify(value, null, 2)
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
  pricingProvider: definition.pricingProvider,
  steps: definition.steps
    .sort((a, b) => a.stepOrder - b.stepOrder)
    .map(step => ({
      completionPolicy: step.completionPolicy,
      configText: toJsonText(step.config),
      id: step.id,
      signalMatchText: toJsonText(step.signalMatch ?? undefined),
      stepType: step.stepType,
    })),
  targetCurrency: definition.targetCurrency,
})

const buildEmptyDraft = (): DefinitionDraft => ({
  blockchain: blockchains[0],
  cryptoCurrency: cryptoCurrencies[0],
  enabled: true,
  exchangeFeePct: '0',
  fixedFee: '0',
  maxAmount: '',
  minAmount: '',
  name: '',
  pricingProvider: pricingProviders[0],
  steps: [{
    completionPolicy: 'SYNC',
    configText: toJsonText(defaultConfigForStep('PAYOUT_SEND')),
    signalMatchText: '',
    stepType: 'PAYOUT_SEND',
  }],
  targetCurrency: targetCurrencies[0],
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

const parseJsonRecord = (value: string, allowEmpty: boolean): { error?: string, ok: boolean, value?: Record<string, unknown> } => {
  if (!value.trim()) {
    return allowEmpty ? { ok: true, value: {} } : { error: 'Required JSON object.', ok: false }
  }
  try {
    const parsed = JSON.parse(value) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return { ok: true, value: parsed as Record<string, unknown> }
    }
    return { error: 'Must be a JSON object.', ok: false }
  }
  catch (err) {
    return { error: err instanceof Error ? err.message : 'Invalid JSON', ok: false }
  }
}

const FlowDefinitions = () => {
  const opsApiKey = useOpsApiKey()
  const [definitions, setDefinitions] = useState<FlowDefinition[]>([])
  const [selectedId, setSelectedId] = useState<null | string>(null)
  const [draft, setDraft] = useState<DefinitionDraft | null>(null)
  const [baseline, setBaseline] = useState<null | string>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<null | string>(null)
  const [validationErrors, setValidationErrors] = useState<ValidationErrorMap>({})
  const [search, setSearch] = useState('')
  const [newStepType, setNewStepType] = useState<FlowStepType>('PAYOUT_SEND')
  const draftRef = useRef<DefinitionDraft | null>(null)
  const selectedIdRef = useRef<null | string>(null)

  useEffect(() => {
    draftRef.current = draft
  }, [draft])

  useEffect(() => {
    selectedIdRef.current = selectedId
  }, [selectedId])

  const isDirty = useMemo(() => {
    if (!draft || !baseline) return false
    return JSON.stringify(draft) !== baseline
  }, [baseline, draft])

  const filteredDefinitions = useMemo(() => {
    if (!search.trim()) return definitions
    const term = search.trim().toLowerCase()
    return definitions.filter(item => (
      item.name.toLowerCase().includes(term)
      || item.cryptoCurrency.toLowerCase().includes(term)
      || item.blockchain.toLowerCase().includes(term)
      || item.targetCurrency.toLowerCase().includes(term)
    ))
  }, [definitions, search])

  const loadDefinitions = useCallback(async () => {
    if (!opsApiKey) {
      setDefinitions([])
      setDraft(null)
      setSelectedId(null)
      setBaseline(null)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const list = await listFlowDefinitions()
      const currentSelectedId = selectedIdRef.current
      const currentDraft = draftRef.current
      setDefinitions(list)
      if (!currentSelectedId && !currentDraft && list.length > 0) {
        const next = list[0]
        const nextDraft = fromDefinition(next)
        setSelectedId(next.id)
        setDraft(nextDraft)
        setBaseline(JSON.stringify(nextDraft))
      }
    }
    catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load flow definitions')
    }
    finally {
      setLoading(false)
    }
  }, [opsApiKey])

  useEffect(() => {
    void loadDefinitions()
  }, [loadDefinitions])

  const selectDefinition = (definition: FlowDefinition) => {
    const nextDraft = fromDefinition(definition)
    setSelectedId(definition.id)
    setDraft(nextDraft)
    setBaseline(JSON.stringify(nextDraft))
    setValidationErrors({})
    setError(null)
  }

  const handleNewDefinition = () => {
    const nextDraft = buildEmptyDraft()
    setSelectedId(null)
    setDraft(nextDraft)
    setBaseline(JSON.stringify(nextDraft))
    setValidationErrors({})
    setError(null)
  }

  const updateDraftField = (field: keyof DefinitionDraft, value: boolean | string) => {
    if (!draft) return
    setDraft({ ...draft, [field]: value })
  }

  const updateStepDraft = (index: number, updater: (step: StepDraft) => StepDraft) => {
    if (!draft) return
    const steps = draft.steps.map((step, idx) => (idx === index ? updater(step) : step))
    setDraft({ ...draft, steps })
  }

  const reorderStep = (index: number, direction: 'down' | 'up') => {
    if (!draft) return
    const steps = [...draft.steps]
    const targetIndex = direction === 'up' ? index - 1 : index + 1
    if (targetIndex < 0 || targetIndex >= steps.length) return
    const temp = steps[index]
    steps[index] = steps[targetIndex]
    steps[targetIndex] = temp
    setDraft({ ...draft, steps })
  }

  const removeStep = (index: number) => {
    if (!draft) return
    const steps = draft.steps.filter((_, idx) => idx !== index)
    setDraft({ ...draft, steps })
  }

  const addStep = () => {
    if (!draft) return
    const completionPolicy: FlowStepCompletionPolicy = newStepType.startsWith('AWAIT') ? 'AWAIT_EVENT' : 'SYNC'
    const step: StepDraft = {
      completionPolicy,
      configText: toJsonText(defaultConfigForStep(newStepType)),
      signalMatchText: '',
      stepType: newStepType,
    }
    setDraft({ ...draft, steps: [...draft.steps, step] })
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

    const parsedSteps = draftToValidate.steps.map((step, index) => {
      const configResult = parseJsonRecord(step.configText, true)
      if (!configResult.ok) {
        errors[`config-${index}`] = configResult.error ?? 'Invalid config'
      }

      let signalMatch: Record<string, unknown> | undefined
      if (step.signalMatchText.trim()) {
        const signalResult = parseJsonRecord(step.signalMatchText, false)
        if (!signalResult.ok) {
          errors[`signal-${index}`] = signalResult.error ?? 'Invalid signal match'
        }
        else {
          signalMatch = signalResult.value
        }
      }

      return {
        completionPolicy: step.completionPolicy,
        config: configResult.value ?? {},
        signalMatch,
        stepOrder: index + 1,
        stepType: step.stepType,
      }
    })

    if (draftToValidate.steps.length === 0) {
      errors.steps = 'At least one step is required.'
    }

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
      pricingProvider: draftToValidate.pricingProvider,
      steps: parsedSteps,
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

      await loadDefinitions()
      selectDefinition(saved)
      setError(null)
    }
    catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save flow definition')
    }
    finally {
      setSaving(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#F7F3EC] text-[#1A1A1A]">
      <div className="relative overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(27,94,89,0.18),_transparent_55%)]" />
        <div className="relative max-w-7xl mx-auto px-6 py-10">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <Link className="text-sm text-[#1B4D48] hover:text-[#356E6A]" to="/ops/flows">← Back to runs</Link>
              <div className="mt-3 text-sm uppercase tracking-[0.3em] text-[#356E6A]">Flow Studio</div>
              <h1 className="text-3xl md:text-4xl font-semibold">Flow Definition Editor</h1>
              <p className="text-sm text-[#4B5563] max-w-xl mt-2">
                Build corridor pipelines step-by-step. Changes apply to new transactions only.
              </p>
            </div>
            <div className="flex items-center gap-3">
              <button
                className="px-4 py-2 rounded-xl border border-[#1B4D48] text-[#1B4D48] bg-white/70 hover:bg-white transition"
                disabled={!opsApiKey || loading}
                onClick={() => void loadDefinitions()}
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
              Ops API key required to load flow definitions.
            </div>
          )}

          <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-[1.2fr_2fr]">
            <div className="rounded-2xl border border-white/70 bg-white/80 p-5 shadow-[0_20px_45px_-35px_rgba(15,23,42,0.45)]">
              <div className="flex items-center justify-between">
                <div className="text-sm font-semibold">Definitions</div>
                <button
                  className="rounded-xl border border-[#356E6A] bg-[#356E6A] px-3 py-1 text-xs font-semibold text-white hover:bg-[#2B5B57]"
                  disabled={!opsApiKey}
                  onClick={handleNewDefinition}
                  type="button"
                >
                  + New
                </button>
              </div>
              <div className="mt-4">
                <input
                  className="w-full rounded-xl border border-[#DADADA] bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#356E6A]/40"
                  onChange={event => setSearch(event.target.value)}
                  placeholder="Search by name or corridor"
                  value={search}
                />
              </div>
              <div className="mt-4 space-y-3">
                {loading && (
                  <div className="text-xs text-[#6B7280]">Loading definitions...</div>
                )}
                {!loading && opsApiKey && filteredDefinitions.length === 0 && (
                  <div className="rounded-xl border border-dashed border-[#C6C6C6] bg-white/70 px-4 py-6 text-center text-xs text-[#6B7280]">
                    No definitions found.
                  </div>
                )}
                {filteredDefinitions.map(definition => (
                  <button
                    className={`w-full text-left rounded-xl border px-4 py-3 transition ${
                      selectedId === definition.id
                        ? 'border-[#356E6A] bg-[#356E6A]/10'
                        : 'border-white/70 bg-white/60 hover:bg-white'
                    }`}
                    key={definition.id}
                    onClick={() => selectDefinition(definition)}
                    type="button"
                  >
                    <div className="text-sm font-semibold">{definition.name}</div>
                    <div className="text-xs text-[#6B7280]">
                      {definition.cryptoCurrency}
                      {' '}
                      ·
                      {definition.blockchain}
                      {' '}
                      →
                      {definition.targetCurrency}
                    </div>
                    <div className="mt-1 text-[11px] text-[#6B7280]">
                      {definition.steps.length}
                      {' '}
                      steps · Updated
                      {formatDate(definition.updatedAt)}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            <div className="rounded-2xl border border-white/70 bg-white/80 p-6 shadow-[0_20px_45px_-35px_rgba(15,23,42,0.45)]">
              {draft
                ? (
                    <>
                      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                        <div>
                          <div className="text-xs uppercase tracking-wider text-[#6B7280]">Definition editor</div>
                          <div className="text-lg font-semibold">{draft.id ? 'Edit Flow' : 'New Flow'}</div>
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
                            {saving ? 'Saving…' : 'Save definition'}
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
                          <label className="text-xs uppercase tracking-wider text-[#5B6B6A]">Blockchain</label>
                          <select
                            className="mt-2 w-full rounded-xl border border-[#DADADA] bg-white px-3 py-2 text-sm"
                            onChange={event => updateDraftField('blockchain', event.target.value)}
                            value={draft.blockchain}
                          >
                            {blockchains.map(item => (
                              <option key={item} value={item}>{item}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="text-xs uppercase tracking-wider text-[#5B6B6A]">Crypto</label>
                          <select
                            className="mt-2 w-full rounded-xl border border-[#DADADA] bg-white px-3 py-2 text-sm"
                            onChange={event => updateDraftField('cryptoCurrency', event.target.value)}
                            value={draft.cryptoCurrency}
                          >
                            {cryptoCurrencies.map(item => (
                              <option key={item} value={item}>{item}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="text-xs uppercase tracking-wider text-[#5B6B6A]">Target Currency</label>
                          <select
                            className="mt-2 w-full rounded-xl border border-[#DADADA] bg-white px-3 py-2 text-sm"
                            onChange={event => updateDraftField('targetCurrency', event.target.value)}
                            value={draft.targetCurrency}
                          >
                            {targetCurrencies.map(item => (
                              <option key={item} value={item}>{item}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="text-xs uppercase tracking-wider text-[#5B6B6A]">Pricing Provider</label>
                          <select
                            className="mt-2 w-full rounded-xl border border-[#DADADA] bg-white px-3 py-2 text-sm"
                            onChange={event => updateDraftField('pricingProvider', event.target.value as FlowPricingProvider)}
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
                          <label className="text-xs uppercase tracking-wider text-[#5B6B6A]">Min Amount</label>
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
                          <label className="text-xs uppercase tracking-wider text-[#5B6B6A]">Max Amount</label>
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

                      <div className="mt-8">
                        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                          <div>
                            <div className="text-sm font-semibold">Steps</div>
                            <div className="text-xs text-[#6B7280]">Define the execution pipeline order.</div>
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            <select
                              className="rounded-xl border border-[#DADADA] bg-white px-3 py-2 text-xs"
                              onChange={event => setNewStepType(event.target.value as FlowStepType)}
                              value={newStepType}
                            >
                              {stepTypes.map(item => (
                                <option key={item} value={item}>{item}</option>
                              ))}
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
                              key={`${step.stepType}-${index}`}
                            >
                              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                                <div>
                                  <div className="text-xs uppercase tracking-wider text-[#6B7280]">
                                    Step
                                    {index + 1}
                                  </div>
                                  <div className="text-base font-semibold">{step.stepType}</div>
                                  <div className="text-xs text-[#6B7280]">{stepHints[step.stepType]}</div>
                                </div>
                                <div className="flex items-center gap-2">
                                  <button
                                    className="rounded-lg border border-[#DADADA] bg-white px-2 py-1 text-xs"
                                    disabled={index === 0}
                                    onClick={() => reorderStep(index, 'up')}
                                    type="button"
                                  >
                                    ↑
                                  </button>
                                  <button
                                    className="rounded-lg border border-[#DADADA] bg-white px-2 py-1 text-xs"
                                    disabled={index === draft.steps.length - 1}
                                    onClick={() => reorderStep(index, 'down')}
                                    type="button"
                                  >
                                    ↓
                                  </button>
                                  <button
                                    className="rounded-lg border border-rose-200 bg-rose-50 px-2 py-1 text-xs text-rose-600"
                                    onClick={() => removeStep(index)}
                                    type="button"
                                  >
                                    Remove
                                  </button>
                                </div>
                              </div>

                              <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-[1fr_1fr]">
                                <div>
                                  <label className="text-xs uppercase tracking-wider text-[#5B6B6A]">Step Type</label>
                                  <select
                                    className="mt-2 w-full rounded-xl border border-[#DADADA] bg-white px-3 py-2 text-sm"
                                    onChange={event => updateStepDraft(index, prev => ({
                                      ...prev,
                                      stepType: event.target.value as FlowStepType,
                                    }))}
                                    value={step.stepType}
                                  >
                                    {stepTypes.map(item => (
                                      <option key={item} value={item}>{item}</option>
                                    ))}
                                  </select>
                                </div>
                                <div>
                                  <label className="text-xs uppercase tracking-wider text-[#5B6B6A]">Completion</label>
                                  <select
                                    className="mt-2 w-full rounded-xl border border-[#DADADA] bg-white px-3 py-2 text-sm"
                                    onChange={event => updateStepDraft(index, prev => ({
                                      ...prev,
                                      completionPolicy: event.target.value as FlowStepCompletionPolicy,
                                    }))}
                                    value={step.completionPolicy}
                                  >
                                    {completionPolicies.map(item => (
                                      <option key={item} value={item}>{item}</option>
                                    ))}
                                  </select>
                                </div>
                              </div>

                              <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
                                <div>
                                  <label className="text-xs uppercase tracking-wider text-[#5B6B6A]">Config (JSON)</label>
                                  <textarea
                                    className="mt-2 h-36 w-full rounded-xl border border-[#DADADA] bg-white px-3 py-2 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-[#356E6A]/40"
                                    onChange={event => updateStepDraft(index, prev => ({
                                      ...prev,
                                      configText: event.target.value,
                                    }))}
                                    placeholder="{}"
                                    value={step.configText}
                                  />
                                  {validationErrors[`config-${index}`] && (
                                    <div className="mt-1 text-xs text-rose-600">{validationErrors[`config-${index}`]}</div>
                                  )}
                                </div>
                                <div>
                                  <label className="text-xs uppercase tracking-wider text-[#5B6B6A]">Signal Match (JSON)</label>
                                  <textarea
                                    className="mt-2 h-36 w-full rounded-xl border border-[#DADADA] bg-white px-3 py-2 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-[#356E6A]/40"
                                    onChange={event => updateStepDraft(index, prev => ({
                                      ...prev,
                                      signalMatchText: event.target.value,
                                    }))}
                                    placeholder='{"externalId": "..."}'
                                    value={step.signalMatchText}
                                  />
                                  {validationErrors[`signal-${index}`] && (
                                    <div className="mt-1 text-xs text-rose-600">{validationErrors[`signal-${index}`]}</div>
                                  )}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </>
                  )
                : (
                    <div className="rounded-xl border border-dashed border-[#C6C6C6] bg-white/70 px-6 py-12 text-center text-sm text-[#6B7280]">
                      Select a flow definition to edit or create a new one.
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

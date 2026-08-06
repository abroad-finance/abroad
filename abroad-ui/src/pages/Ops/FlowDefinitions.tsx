import {
  useCallback, useEffect, useMemo, useState,
} from 'react'
import { Link, useSearchParams } from 'react-router-dom'

import { createOpsConfigurationRelease } from '../../services/admin/configurationReleaseAdminApi'
import {
  listFlowCorridors,
  listFlowDefinitions,
} from '../../services/admin/flowAdminApi'
import {
  FlowBusinessStep,
  FlowCorridor,
  FlowCorridorStatus,
  FlowCorridorSupportStatus,
  FlowDefinition,
  FlowDefinitionInput,
  FlowDirection,
  FlowPricingProvider,
  FlowVenue,
  PaymentMethod,
  SupportedCurrency,
} from '../../services/admin/flowTypes'
import { useOpsApiKey, useOpsSession } from '../../services/admin/opsAuthStore'
import {
  formatDateTime,
  humanizeStatus,
  OpsBanner,
  OpsDialog,
  OpsEmptyState,
  OpsField,
  OpsLoading,
  OpsPageShell,
  OpsStatusBadge,
  OpsTone,
  OpsUnsavedChangesGuard,
} from './shared'
import { isOpsMutationCancelledError, useOpsMutation } from './shared/opsMutationContext'

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

const corridorStatusTone: Record<FlowCorridorStatus, OpsTone> = {
  DEFINED: 'success',
  MISSING: 'danger',
  UNSUPPORTED: 'warning',
}

type DefinitionDraft = {
  blockchain: string
  cryptoCurrency: string
  effectiveAt: string
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
  version?: number
}

type ValidationErrorMap = Record<string, string>

const buildCorridorKey = (corridor: {
  blockchain: string
  cryptoCurrency: string
  direction?: FlowDirection
  targetCurrency: string
}): string => [
  corridor.cryptoCurrency,
  corridor.blockchain,
  corridor.targetCurrency,
  // A corridor without a stated direction is the payout the platform started
  // with; including it keeps the two directions of one pair distinct.
  corridor.direction ?? 'CRYPTO_TO_FIAT',
].join(':')

const describeDirection = (direction?: FlowDirection): string => (
  direction === 'FIAT_TO_CRYPTO' ? 'Onramp' : 'Payout'
)

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
    effectiveAt: '',
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
  effectiveAt: '',
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
  version: definition.version,
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

type CorridorFilter = 'all' | 'defined' | 'missing' | 'unsupported'

const readCorridorFilter = (params: URLSearchParams): CorridorFilter => {
  const status = params.get('status')
  return status === 'defined' || status === 'missing' || status === 'unsupported' ? status : 'all'
}

const FlowDefinitions = () => {
  const opsApiKey = useOpsApiKey()
  const session = useOpsSession()
  const { requestMutation } = useOpsMutation()
  const [searchParams, setSearchParams] = useSearchParams()
  const paramsKey = searchParams.toString()
  const appliedSearch = useMemo(() => new URLSearchParams(paramsKey).get('query') ?? '', [paramsKey])
  const appliedFilter = useMemo(() => readCorridorFilter(new URLSearchParams(paramsKey)), [paramsKey])
  const selectedKey = useMemo(() => new URLSearchParams(paramsKey).get('corridor'), [paramsKey])
  const [corridors, setCorridors] = useState<FlowCorridor[]>([])
  const [corridorSummary, setCorridorSummary] = useState<null | { defined: number, missing: number, total: number, unsupported: number }>(null)
  const [definitions, setDefinitions] = useState<FlowDefinition[]>([])
  const [draft, setDraft] = useState<DefinitionDraft | null>(null)
  const [baseline, setBaseline] = useState<null | string>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<null | string>(null)
  const [validationErrors, setValidationErrors] = useState<ValidationErrorMap>({})
  const [searchDraft, setSearchDraft] = useState(appliedSearch)
  const [filterDraft, setFilterDraft] = useState<CorridorFilter>(appliedFilter)
  const [unsupportedReason, setUnsupportedReason] = useState('')
  const [supportBaseline, setSupportBaseline] = useState('')
  const [createdDraft, setCreatedDraft] = useState<null | { id: string, title: string }>(null)
  const [pendingCorridor, setPendingCorridor] = useState<FlowCorridor | null>(null)
  const [newStepType, setNewStepType] = useState<'CONVERT' | 'MOVE_TO_EXCHANGE' | 'TRANSFER_VENUE'>('MOVE_TO_EXCHANGE')
  const canManage = Boolean(session?.permissions.includes('configuration:manage'))

  const definitionsById = useMemo(() => new Map(definitions.map(def => [def.id, def])), [definitions])
  const corridorByKey = useMemo(() => new Map(corridors.map(corridor => [buildCorridorKey(corridor), corridor])), [corridors])

  const selectedCorridor = selectedKey ? corridorByKey.get(selectedKey) ?? null : null

  const isDirty = useMemo(() => {
    if (!draft || !baseline) return false
    return JSON.stringify(draft) !== baseline
  }, [baseline, draft])

  const hasUnsavedChanges = isDirty || unsupportedReason !== supportBaseline

  const filteredCorridors = useMemo(() => {
    const term = appliedSearch.trim().toLowerCase()
    return corridors.filter((corridor) => {
      if (appliedFilter === 'defined' && corridor.status !== 'DEFINED') return false
      if (appliedFilter === 'missing' && corridor.status !== 'MISSING') return false
      if (appliedFilter === 'unsupported' && corridor.status !== 'UNSUPPORTED') return false
      if (!term) return true
      const label = `${corridor.cryptoCurrency} ${corridor.blockchain} ${corridor.targetCurrency}`.toLowerCase()
      return label.includes(term)
    })
  }, [
    corridors,
    appliedFilter,
    appliedSearch,
  ])

  const loadData = useCallback(async () => {
    if (!opsApiKey) {
      setCorridors([])
      setCorridorSummary(null)
      setDefinitions([])
      setDraft(null)
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

  useEffect(() => {
    setSearchDraft(appliedSearch)
    setFilterDraft(appliedFilter)
  }, [appliedFilter, appliedSearch])

  useEffect(() => {
    if (!selectedKey) {
      setDraft(null)
      setBaseline(null)
      setUnsupportedReason('')
      setSupportBaseline('')
      return
    }
    const corridor = corridorByKey.get(selectedKey)
    if (!corridor) return
    const definition = corridor.definitionId ? definitionsById.get(corridor.definitionId) : null
    const nextDraft = definition ? fromDefinition(definition) : buildEmptyDraft(corridor)
    setDraft(nextDraft)
    setBaseline(JSON.stringify(nextDraft))
    setValidationErrors({})
    const nextReason = corridor.unsupportedReason ?? ''
    setUnsupportedReason(nextReason)
    setSupportBaseline(nextReason)
  }, [
    corridorByKey,
    definitionsById,
    selectedKey,
  ])

  const applyCorridorSelection = (corridor: FlowCorridor): void => {
    const next = new URLSearchParams(searchParams)
    next.set('corridor', buildCorridorKey(corridor))
    setSearchParams(next)
  }

  const selectCorridor = (corridor: FlowCorridor): void => {
    if (hasUnsavedChanges && buildCorridorKey(corridor) !== selectedKey) {
      setPendingCorridor(corridor)
      return
    }
    applyCorridorSelection(corridor)
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
    const validatedPayload = validation.payload

    try {
      const definitionId = draft.id
      const title = `${definitionId ? 'Update' : 'Create'} ${draft.cryptoCurrency} on ${humanizeStatus(draft.blockchain)} to ${draft.targetCurrency} flow`
      const release = await requestMutation({
        action: 'configuration.release.create',
        execute: mutation => createOpsConfigurationRelease({
          effectiveAt: draft.effectiveAt ? new Date(draft.effectiveAt).toISOString() : undefined,
          payload: {
            definitionId,
            kind: 'FLOW_DEFINITION',
            operation: definitionId ? 'UPDATE' : 'CREATE',
            value: validatedPayload,
          },
          title,
        }, mutation),
        resourceLabel: `${draft.cryptoCurrency} on ${humanizeStatus(draft.blockchain)} to ${draft.targetCurrency}`,
        title: 'Create flow review draft',
      })
      setCreatedDraft({ id: release.id, title: release.title })
      if (baseline) setDraft(JSON.parse(baseline) as DefinitionDraft)
      setValidationErrors({})
      setError(null)
    }
    catch (err) {
      if (isOpsMutationCancelledError(err)) return
      setError(err instanceof Error ? err.message : 'Failed to create flow review draft')
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
      const title = `${status === 'SUPPORTED' ? 'Support' : 'Pause'} ${corridorTitle(selectedCorridor)} corridor`
      const release = await requestMutation({
        action: 'configuration.release.create',
        execute: mutation => createOpsConfigurationRelease({
          effectiveAt: draft?.effectiveAt ? new Date(draft.effectiveAt).toISOString() : undefined,
          payload: {
            kind: 'FLOW_CORRIDOR',
            value: {
              blockchain: selectedCorridor.blockchain,
              cryptoCurrency: selectedCorridor.cryptoCurrency,
              // Without this the server resolves the asset pair alone and
              // pauses whichever direction it finds first.
              direction: selectedCorridor.direction,
              reason: unsupportedReason.trim() || undefined,
              status,
              targetCurrency: selectedCorridor.targetCurrency,
            },
          },
          title,
        }, mutation),
        resourceLabel: corridorTitle(selectedCorridor),
        title: status === 'SUPPORTED' ? 'Create corridor support draft' : 'Create corridor pause draft',
      })
      setCreatedDraft({ id: release.id, title: release.title })
      setUnsupportedReason(supportBaseline)
    }
    catch (err) {
      if (isOpsMutationCancelledError(err)) return
      setError(err instanceof Error ? err.message : 'Failed to create corridor review draft')
    }
    finally {
      setSaving(false)
    }
  }

  // The direction belongs in the title: an approver reviewing a pause draft
  // otherwise sees the same label for both corridors of one asset pair.
  const corridorTitle = (corridor: FlowCorridor): string => (
    `${corridor.cryptoCurrency} · ${humanizeStatus(corridor.blockchain)} → ${corridor.targetCurrency} (${describeDirection(corridor.direction)})`
  )

  const applyFilters = (): void => {
    const next = new URLSearchParams()
    if (searchDraft.trim()) next.set('query', searchDraft.trim())
    if (filterDraft !== 'all') next.set('status', filterDraft)
    if (selectedKey) next.set('corridor', selectedKey)
    setSearchParams(next)
  }

  const showMissingCorridors = (): void => {
    setSearchParams(new URLSearchParams({ status: 'missing' }))
  }

  const discardEditorChanges = (): void => {
    if (baseline) setDraft(JSON.parse(baseline) as DefinitionDraft)
    setUnsupportedReason(supportBaseline)
    setValidationErrors({})
  }

  const confirmCorridorSelection = (): void => {
    if (!pendingCorridor) return
    const next = pendingCorridor
    setPendingCorridor(null)
    discardEditorChanges()
    applyCorridorSelection(next)
  }

  return (
    <OpsPageShell
      actions={(
        <button
          className="ops-btn-ghost"
          disabled={!opsApiKey || loading || hasUnsavedChanges}
          onClick={() => void loadData()}
          type="button"
        >
          Refresh
        </button>
      )}
      error={error}
      eyebrow="Configuration"
      keyRequiredMessage="Sign in to review corridor coverage."
      subtitle="Prepare reviewed corridor, fee, and routing changes. Production changes only after approval."
      title="Corridors & Flows"
    >
      <OpsUnsavedChangesGuard active={hasUnsavedChanges} />
      {createdDraft && (
        <OpsBanner className="mt-5" variant="success">
          Review draft created:
          {' '}
          <Link className="font-semibold underline underline-offset-4" to={`/ops/configuration/history?release=${encodeURIComponent(createdDraft.id)}`}>{createdDraft.title}</Link>
          . Production is unchanged until approval.
        </OpsBanner>
      )}
      {hasUnsavedChanges && <OpsBanner className="mt-5" variant="info">Unsaved configuration is protected. Create a review draft or discard changes before changing filters or refreshing.</OpsBanner>}
      {!canManage && opsApiKey && (
        <OpsBanner className="mt-5" variant="info">
          Read-only access. You can inspect current corridors and flow versions, but creating a configuration draft requires configuration management permission.
        </OpsBanner>
      )}
      <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-4">
        <div className="ops-card p-4">
          <div className="text-xs uppercase tracking-[0.3em] text-ops-muted">Total</div>
          <div className="mt-2 text-2xl font-semibold">{corridorSummary?.total ?? '—'}</div>
        </div>
        <div className="ops-card p-4">
          <div className="text-xs uppercase tracking-[0.3em] text-ops-muted">Defined</div>
          <div className="mt-2 text-2xl font-semibold text-emerald-700">{corridorSummary?.defined ?? '—'}</div>
        </div>
        <button className="ops-card min-h-24 p-4 text-left hover:border-rose-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ops-brand" disabled={hasUnsavedChanges} onClick={showMissingCorridors} type="button">
          <div className="text-xs uppercase tracking-[0.3em] text-ops-muted">Missing</div>
          <div className="mt-2 text-2xl font-semibold text-rose-700">{corridorSummary?.missing ?? '—'}</div>
          <div className="mt-1 text-xs font-medium text-rose-800">Open configuration gaps</div>
        </button>
        <div className="ops-card p-4">
          <div className="text-xs uppercase tracking-[0.3em] text-ops-muted">Unsupported</div>
          <div className="mt-2 text-2xl font-semibold text-amber-700">{corridorSummary?.unsupported ?? '—'}</div>
        </div>
      </div>

      <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-[1.1fr_2fr]">
        <div className="ops-card p-5">
          <div className="flex flex-col gap-3">
            <h2 className="text-sm font-semibold">Corridors</h2>
            <input
              aria-label="Search corridors"
              className="ops-input w-full"
              onChange={event => setSearchDraft(event.target.value)}
              placeholder="Search corridor"
              value={searchDraft}
            />
            <OpsField label="Coverage status">
              <select className="ops-input" name="corridor-status-filter" onChange={event => setFilterDraft(event.target.value as CorridorFilter)} value={filterDraft}>
                <option value="all">All corridors</option>
                <option value="defined">Configured</option>
                <option value="missing">Missing configuration</option>
                <option value="unsupported">Paused as unsupported</option>
              </select>
            </OpsField>
            <div className="flex flex-wrap gap-2">
              <button className="ops-btn-primary ops-btn-sm" disabled={hasUnsavedChanges} onClick={applyFilters} type="button">Apply filters</button>
              <button className="ops-btn-neutral ops-btn-sm" disabled={hasUnsavedChanges} onClick={() => setSearchParams(new URLSearchParams())} type="button">Clear</button>
            </div>
          </div>
          <div className="mt-4 space-y-3">
            {loading && (
              <OpsLoading label="Loading corridors…" />
            )}
            {!loading && opsApiKey && filteredCorridors.length === 0 && (
              <OpsEmptyState>No corridors found.</OpsEmptyState>
            )}
            {filteredCorridors.map(corridor => (
              <button
                className={`w-full text-left rounded-xl border px-4 py-3 transition ${
                  selectedKey === buildCorridorKey(corridor)
                    ? 'border-abroad-dark bg-abroad-dark/10'
                    : 'border-white/70 bg-white/60 hover:bg-white'
                }`}
                key={buildCorridorKey(corridor)}
                onClick={() => selectCorridor(corridor)}
                type="button"
              >
                <div className="text-sm font-semibold">{corridorTitle(corridor)}</div>
                <code className="mt-1 block break-all text-[10px] text-ops-muted">{buildCorridorKey(corridor)}</code>
                <div className="mt-1 flex items-center gap-2 text-[11px] text-ops-muted">
                  <OpsStatusBadge label={humanizeStatus(corridor.status)} tone={corridorStatusTone[corridor.status]} />
                  <span>{describeDirection(corridor.direction)}</span>
                  {corridor.definitionName && (
                    <span>{corridor.definitionName}</span>
                  )}
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="ops-card p-6">
          {draft && selectedCorridor
            ? (
                <>
                  <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div>
                      <div className="text-xs uppercase tracking-wider text-ops-muted">Corridor</div>
                      <div className="text-lg font-semibold">{corridorTitle(selectedCorridor)}</div>
                      <code className="mt-1 block break-all text-[11px] text-ops-muted">{buildCorridorKey(selectedCorridor)}</code>
                      <div className="text-xs text-ops-muted">
                        Updated
                        {' '}
                        {formatDateTime(selectedCorridor.updatedAt)}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        className="ops-btn-neutral ops-btn-sm"
                        disabled={!canManage || !isDirty}
                        onClick={discardEditorChanges}
                        type="button"
                      >
                        Discard changes
                      </button>
                      <button
                        className="ops-btn-primary ops-btn-sm"
                        disabled={saving || !opsApiKey || !canManage || !isDirty}
                        onClick={() => void handleSave()}
                        type="button"
                      >
                        {saving ? 'Creating draft…' : 'Create review draft'}
                      </button>
                    </div>
                  </div>

                  <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
                    <OpsField error={validationErrors.name} label="Name">
                      <input
                        className="ops-input"
                        disabled={!canManage}
                        onChange={event => updateDraftField('name', event.target.value)}
                        value={draft.name}
                      />
                    </OpsField>
                    <div className="flex items-center gap-3">
                      <label className="ops-label">Enabled</label>
                      <button
                        className={`rounded-full border px-4 py-2 text-xs font-semibold transition ${
                          draft.enabled ? 'border-emerald-300 bg-emerald-100 text-emerald-800' : 'border-rose-300 bg-rose-100 text-rose-800'
                        }`}
                        disabled={!canManage}
                        onClick={() => updateDraftField('enabled', !draft.enabled)}
                        type="button"
                      >
                        {draft.enabled ? 'Enabled' : 'Disabled'}
                      </button>
                    </div>
                    <OpsField label="Payout Provider">
                      <select
                        className="ops-input"
                        disabled={!canManage}
                        onChange={event => updateDraftField('payoutProvider', event.target.value)}
                        value={draft.payoutProvider}
                      >
                        {payoutProviders.map(item => (
                          <option key={item} value={item}>{humanizeStatus(item)}</option>
                        ))}
                      </select>
                    </OpsField>
                    <OpsField label="Pricing Provider">
                      <select
                        className="ops-input"
                        disabled={!canManage}
                        onChange={event => updateDraftField('pricingProvider', event.target.value)}
                        value={draft.pricingProvider}
                      >
                        {pricingProviders.map(item => (
                          <option key={item} value={item}>{humanizeStatus(item)}</option>
                        ))}
                      </select>
                    </OpsField>
                    <OpsField hint="Leave blank to apply immediately after approval." label="Effective time">
                      <input
                        className="ops-input"
                        disabled={!canManage}
                        name="flow-release-effective-at"
                        onChange={event => updateDraftField('effectiveAt', event.target.value)}
                        type="datetime-local"
                        value={draft.effectiveAt}
                      />
                    </OpsField>
                  </div>
                  <p className="mt-2 text-xs text-ops-muted">
                    Provider keys:
                    {' '}
                    payout
                    {' '}
                    <code>{draft.payoutProvider}</code>
                    , pricing
                    {' '}
                    <code>{draft.pricingProvider}</code>
                  </p>

                  <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-4">
                    <OpsField
                      error={validationErrors.exchangeFeePct}
                      hint="Enter the fee as a decimal. Example: 0.01 = 1%; 0.001 = 0.1%."
                      label="Percentage Fee"
                    >
                      <input
                        className="ops-input"
                        disabled={!canManage}
                        min="0"
                        onChange={event => updateDraftField('exchangeFeePct', event.target.value)}
                        placeholder="0.01"
                        type="number"
                        value={draft.exchangeFeePct}
                      />
                    </OpsField>
                    <OpsField
                      error={validationErrors.fixedFee}
                      hint={`Added once per transaction in the payout currency. Example: 2.50 ${draft.targetCurrency}.`}
                      label={`Fixed Fee (${draft.targetCurrency})`}
                    >
                      <input
                        className="ops-input"
                        disabled={!canManage}
                        min="0"
                        onChange={event => updateDraftField('fixedFee', event.target.value)}
                        placeholder="2.50"
                        type="number"
                        value={draft.fixedFee}
                      />
                    </OpsField>
                    <OpsField
                      error={validationErrors.minAmount}
                      label={(
                        <>
                          Min Amount
                          <span className="ml-1">
                            (
                            {draft.targetCurrency}
                            )
                          </span>
                        </>
                      )}
                    >
                      <input
                        className="ops-input"
                        disabled={!canManage}
                        onChange={event => updateDraftField('minAmount', event.target.value)}
                        type="number"
                        value={draft.minAmount}
                      />
                    </OpsField>
                    <OpsField
                      error={validationErrors.maxAmount}
                      label={(
                        <>
                          Max Amount
                          <span className="ml-1">
                            (
                            {draft.targetCurrency}
                            )
                          </span>
                        </>
                      )}
                    >
                      <input
                        className="ops-input"
                        disabled={!canManage}
                        onChange={event => updateDraftField('maxAmount', event.target.value)}
                        type="number"
                        value={draft.maxAmount}
                      />
                    </OpsField>
                  </div>

                  <div className="mt-6 rounded-2xl border border-dashed border-ops-border bg-white/60 p-4">
                    <h3 className="text-sm font-semibold">System enforced gates</h3>
                    <p className="mt-1 text-xs text-ops-muted">
                      Payout confirmation and refunds are handled automatically. Exchange balance waits are inserted when funds move between venues.
                    </p>
                  </div>

                  <div className="mt-8">
                    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                      <div>
                        <h2 className="text-sm font-semibold">Pipeline Steps</h2>
                        <div className="text-xs text-ops-muted">Business steps only — no technical configuration required.</div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <select
                          aria-label="New step type"
                          className="ops-input"
                          disabled={!canManage}
                          onChange={event => setNewStepType(event.target.value as typeof newStepType)}
                          value={newStepType}
                        >
                          <option value="MOVE_TO_EXCHANGE">Move to exchange</option>
                          <option value="CONVERT">Convert</option>
                          <option value="TRANSFER_VENUE">Transfer venue</option>
                        </select>
                        <button
                          className="ops-btn-primary ops-btn-sm"
                          disabled={!canManage}
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
                          className="ops-card p-4"
                          key={`${step.type}-${index}`}
                        >
                          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                            <div>
                              <div className="text-xs uppercase tracking-wider text-ops-muted">
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
                                aria-label="Move step up"
                                className="rounded-lg border border-ops-border bg-white px-2 py-1 text-xs"
                                disabled={!canManage || index <= 1}
                                onClick={() => reorderStep(index, 'up')}
                                type="button"
                              >
                                ↑
                              </button>
                              <button
                                aria-label="Move step down"
                                className="rounded-lg border border-ops-border bg-white px-2 py-1 text-xs"
                                disabled={!canManage || index === 0 || index >= draft.steps.length - 1}
                                onClick={() => reorderStep(index, 'down')}
                                type="button"
                              >
                                ↓
                              </button>
                              <button
                                className="ops-btn-danger ops-btn-sm"
                                disabled={!canManage || index === 0}
                                onClick={() => removeStep(index)}
                                type="button"
                              >
                                Remove
                              </button>
                            </div>
                          </div>

                          {step.type === 'MOVE_TO_EXCHANGE' && (
                            <OpsField className="mt-4" label="Venue">
                              <select
                                className="ops-input"
                                disabled={!canManage}
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
                            </OpsField>
                          )}

                          {step.type === 'CONVERT' && (
                            <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
                              <OpsField label="Venue">
                                <select
                                  className="ops-input"
                                  disabled={!canManage}
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
                              </OpsField>
                              <OpsField label="From">
                                <select
                                  className="ops-input"
                                  disabled={!canManage}
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
                              </OpsField>
                              <OpsField label="To">
                                <select
                                  className="ops-input"
                                  disabled={!canManage}
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
                              </OpsField>
                            </div>
                          )}

                          {step.type === 'TRANSFER_VENUE' && (
                            <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
                              <OpsField label="From Venue">
                                <select
                                  className="ops-input"
                                  disabled={!canManage}
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
                              </OpsField>
                              <OpsField label="To Venue">
                                <select
                                  className="ops-input"
                                  disabled={!canManage}
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
                              </OpsField>
                              <OpsField label="Asset">
                                <select
                                  className="ops-input"
                                  disabled={!canManage}
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
                              </OpsField>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="mt-8 ops-card p-4">
                    <h3 className="text-sm font-semibold">Corridor availability</h3>
                    <p className="mt-1 text-xs text-ops-muted">
                      Create a reviewed change to pause or restore new work on this corridor. Existing flow snapshots are unchanged.
                    </p>
                    <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-[2fr_auto]">
                      <input
                        aria-label="Unsupported reason"
                        className="ops-input"
                        disabled={!canManage}
                        onChange={event => setUnsupportedReason(event.target.value)}
                        placeholder="Optional reason"
                        value={unsupportedReason}
                      />
                      {selectedCorridor.status === 'UNSUPPORTED'
                        ? (
                            <button
                              className="ops-btn-primary ops-btn-sm"
                              disabled={saving || !canManage || isDirty}
                              onClick={() => void handleCorridorStatus('SUPPORTED')}
                              type="button"
                            >
                              Create restore draft
                            </button>
                          )
                        : (
                            <button
                              className="ops-btn-danger ops-btn-sm"
                              disabled={saving || !canManage || isDirty}
                              onClick={() => void handleCorridorStatus('UNSUPPORTED')}
                              type="button"
                            >
                              Create pause draft
                            </button>
                          )}
                    </div>
                  </div>
                </>
              )
            : (
                <OpsEmptyState>Select a corridor to create or edit its flow.</OpsEmptyState>
              )}
        </div>
      </div>
      {pendingCorridor && (
        <OpsDialog
          description="Your current flow or corridor edits have not been saved as a review draft."
          eyebrow="Unsaved configuration"
          onClose={() => setPendingCorridor(null)}
          title={`Open ${corridorTitle(pendingCorridor)}?`}
        >
          <p className="text-sm leading-6 text-ops-muted">Discard the current edits to open the selected corridor, or keep editing and create a review draft first.</p>
          <div className="mt-5 flex flex-wrap justify-end gap-2">
            <button className="ops-btn-neutral" onClick={() => setPendingCorridor(null)} type="button">Keep editing</button>
            <button className="ops-btn-danger" onClick={confirmCorridorSelection} type="button">Discard and open</button>
          </div>
        </OpsDialog>
      )}
    </OpsPageShell>
  )
}

export default FlowDefinitions

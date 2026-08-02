import type {
  FlowFailureFilter,
  FlowInstanceSearchFilters,
  FlowInstanceStatus,
} from '../../../services/admin/flowTypes'

import { flowInstanceStatuses } from '../../../services/admin/flowTypes'

const blockchains = [
  'CELO',
  'SOLANA',
  'STELLAR',
] as const
const cryptoCurrencies = ['USDC', 'USDT'] as const
const payoutProviders = ['BREB', 'PIX'] as const
const targetCurrencies = ['BRL', 'COP'] as const
const failureFilters = [
  'FAILED_FLOW',
  'FAILED_STEP',
  'STUCK_WAITING',
] as const

export type FlowFilterDraft = {
  blockchain: '' | NonNullable<FlowInstanceSearchFilters['blockchain']>
  createdFrom: string
  createdTo: string
  cryptoCurrency: '' | NonNullable<FlowInstanceSearchFilters['cryptoCurrency']>
  failure: '' | FlowFailureFilter
  onChainId: string
  partnerId: string
  payoutProvider: '' | NonNullable<FlowInstanceSearchFilters['payoutProvider']>
  status: '' | FlowInstanceStatus
  stuckMinutes: string
  targetCurrency: '' | NonNullable<FlowInstanceSearchFilters['targetCurrency']>
  transactionId: string
}

export const emptyFlowFilterDraft: FlowFilterDraft = {
  blockchain: '',
  createdFrom: '',
  createdTo: '',
  cryptoCurrency: '',
  failure: '',
  onChainId: '',
  partnerId: '',
  payoutProvider: '',
  status: '',
  stuckMinutes: '',
  targetCurrency: '',
  transactionId: '',
}

const readChoice = <TValue extends string>(
  params: URLSearchParams,
  key: string,
  values: readonly TValue[],
): '' | TValue => {
  const value = params.get(key)
  return value && values.includes(value as TValue) ? value as TValue : ''
}

const readText = (params: URLSearchParams, key: string): string => params.get(key)?.trim() ?? ''

export const readFlowFilterDraft = (params: URLSearchParams): FlowFilterDraft => ({
  blockchain: readChoice(params, 'blockchain', blockchains),
  createdFrom: readText(params, 'createdFrom'),
  createdTo: readText(params, 'createdTo'),
  cryptoCurrency: readChoice(params, 'cryptoCurrency', cryptoCurrencies),
  failure: readChoice(params, 'failure', failureFilters),
  onChainId: readText(params, 'onChainId'),
  partnerId: readText(params, 'partnerId'),
  payoutProvider: readChoice(params, 'payoutProvider', payoutProviders),
  status: readChoice(params, 'status', flowInstanceStatuses),
  stuckMinutes: readText(params, 'stuckMinutes'),
  targetCurrency: readChoice(params, 'targetCurrency', targetCurrencies),
  transactionId: readText(params, 'transactionId'),
})

export const readFlowPage = (params: URLSearchParams): number => {
  const value = Number(params.get('page') ?? '1')
  return Number.isInteger(value) && value > 0 ? value : 1
}

export const flowDraftToParams = (draft: FlowFilterDraft, page = 1): URLSearchParams => {
  const params = new URLSearchParams()
  Object.entries(draft).forEach(([key, value]) => {
    const normalized = value.trim()
    if (normalized) params.set(key, normalized)
  })
  if (page > 1) params.set('page', String(page))
  return params
}

export const toFlowFilters = (
  draft: FlowFilterDraft,
  page: number,
  pageSize = 20,
): FlowInstanceSearchFilters => {
  const stuckMinutes = Number(draft.stuckMinutes)
  return {
    blockchain: draft.blockchain || undefined,
    createdFrom: draft.createdFrom || undefined,
    createdTo: draft.createdTo || undefined,
    cryptoCurrency: draft.cryptoCurrency || undefined,
    failure: draft.failure || undefined,
    onChainId: draft.onChainId.trim() || undefined,
    page,
    pageSize,
    partnerId: draft.partnerId.trim() || undefined,
    payoutProvider: draft.payoutProvider || undefined,
    status: draft.status || undefined,
    stuckMinutes: Number.isInteger(stuckMinutes) && stuckMinutes > 0 ? stuckMinutes : undefined,
    targetCurrency: draft.targetCurrency || undefined,
    transactionId: draft.transactionId.trim() || undefined,
  }
}

import type { OpsSavedViewFilters } from '../../../services/admin/opsInvestigationTypes'
import type {
  OpsAttentionFilter,
  OpsCaseStatus,
  OpsProofStatus,
  OpsRefundStatus,
  OpsTransactionSearchFilters,
  TransactionStatus,
} from '../../../services/admin/transactionAdminTypes'

import {
  opsAttentionFilters,
  opsProofStatuses,
  opsRefundStatuses,
  opsWebhookStatuses,
  transactionStatuses,
} from '../../../services/admin/transactionAdminTypes'

const paymentMethods = [
  'BREB',
  'MOVII',
  'NEQUI',
  'PIX',
] as const
const cryptoCurrencies = ['USDC', 'USDT'] as const
const networks = [
  'CELO',
  'SOLANA',
  'STELLAR',
] as const
const targetCurrencies = ['BRL', 'COP'] as const
const caseStatuses = [
  'ACKNOWLEDGED',
  'OPEN',
  'RESOLVED',
] as const

export type TransactionFilterDraft = {
  attention: '' | OpsAttentionFilter
  caseOwnerId: string
  caseStatus: '' | OpsCaseStatus
  createdFrom: string
  createdTo: string
  cryptoCurrency: '' | NonNullable<OpsTransactionSearchFilters['cryptoCurrency']>
  network: '' | NonNullable<OpsTransactionSearchFilters['network']>
  partnerId: string
  paymentMethod: '' | NonNullable<OpsTransactionSearchFilters['paymentMethod']>
  proofStatus: '' | OpsProofStatus
  query: string
  refundStatus: '' | OpsRefundStatus
  status: '' | TransactionStatus
  targetCurrency: '' | NonNullable<OpsTransactionSearchFilters['targetCurrency']>
  webhookStatus: '' | NonNullable<OpsTransactionSearchFilters['webhookStatus']>
}

export const emptyTransactionFilterDraft: TransactionFilterDraft = {
  attention: '',
  caseOwnerId: '',
  caseStatus: '',
  createdFrom: '',
  createdTo: '',
  cryptoCurrency: '',
  network: '',
  partnerId: '',
  paymentMethod: '',
  proofStatus: '',
  query: '',
  refundStatus: '',
  status: '',
  targetCurrency: '',
  webhookStatus: '',
}

const readChoice = <TValue extends string>(
  params: URLSearchParams,
  key: string,
  choices: readonly TValue[],
): '' | TValue => {
  const value = params.get(key)
  return value && choices.includes(value as TValue) ? value as TValue : ''
}

const readText = (params: URLSearchParams, key: string): string => params.get(key)?.trim() ?? ''

const readSavedChoice = <TValue extends string>(
  value: unknown,
  choices: readonly TValue[],
): '' | TValue => (
  typeof value === 'string' && choices.includes(value as TValue) ? value as TValue : ''
)

const readSavedText = (value: unknown): string => typeof value === 'string' ? value : ''

export const readTransactionFilterDraft = (params: URLSearchParams): TransactionFilterDraft => ({
  attention: readChoice(params, 'attention', opsAttentionFilters),
  caseOwnerId: readText(params, 'caseOwnerId'),
  caseStatus: readChoice(params, 'caseStatus', caseStatuses),
  createdFrom: readText(params, 'createdFrom'),
  createdTo: readText(params, 'createdTo'),
  cryptoCurrency: readChoice(params, 'cryptoCurrency', cryptoCurrencies),
  network: readChoice(params, 'network', networks),
  partnerId: readText(params, 'partnerId'),
  paymentMethod: readChoice(params, 'paymentMethod', paymentMethods),
  proofStatus: readChoice(params, 'proofStatus', opsProofStatuses),
  query: readText(params, 'query'),
  refundStatus: readChoice(params, 'refundStatus', opsRefundStatuses),
  status: readChoice(params, 'status', transactionStatuses),
  targetCurrency: readChoice(params, 'targetCurrency', targetCurrencies),
  webhookStatus: readChoice(params, 'webhookStatus', opsWebhookStatuses),
})

export const readTransactionPage = (params: URLSearchParams): number => {
  const value = Number(params.get('page') ?? '1')
  return Number.isInteger(value) && value > 0 ? value : 1
}

export const toTransactionFilters = (
  draft: TransactionFilterDraft,
  page: number,
  pageSize = 20,
): OpsTransactionSearchFilters => ({
  attention: draft.attention || undefined,
  caseOwnerId: draft.caseOwnerId.trim() || undefined,
  caseStatus: draft.caseStatus || undefined,
  createdFrom: draft.createdFrom || undefined,
  createdTo: draft.createdTo || undefined,
  cryptoCurrency: draft.cryptoCurrency || undefined,
  network: draft.network || undefined,
  page,
  pageSize,
  partnerId: draft.partnerId.trim() || undefined,
  paymentMethod: draft.paymentMethod || undefined,
  proofStatus: draft.proofStatus || undefined,
  query: draft.query.trim() || undefined,
  refundStatus: draft.refundStatus || undefined,
  status: draft.status || undefined,
  targetCurrency: draft.targetCurrency || undefined,
  webhookStatus: draft.webhookStatus || undefined,
})

export const transactionDraftToParams = (
  draft: TransactionFilterDraft,
  page = 1,
): URLSearchParams => {
  const params = new URLSearchParams()
  Object.entries(draft).forEach(([key, value]) => {
    const normalized = value.trim()
    if (normalized) params.set(key, normalized)
  })
  if (page > 1) params.set('page', String(page))
  return params
}

export const transactionFiltersToDraft = (
  filters: OpsSavedViewFilters,
): TransactionFilterDraft => ({
  attention: readSavedChoice(filters.attention, opsAttentionFilters),
  caseOwnerId: readSavedText(filters.caseOwnerId),
  caseStatus: readSavedChoice(filters.caseStatus, caseStatuses),
  createdFrom: readSavedText(filters.createdFrom),
  createdTo: readSavedText(filters.createdTo),
  cryptoCurrency: readSavedChoice(filters.cryptoCurrency, cryptoCurrencies),
  network: readSavedChoice(filters.network, networks),
  partnerId: readSavedText(filters.partnerId),
  paymentMethod: readSavedChoice(filters.paymentMethod, paymentMethods),
  proofStatus: readSavedChoice(filters.proofStatus, opsProofStatuses),
  query: readSavedText(filters.query),
  refundStatus: readSavedChoice(filters.refundStatus, opsRefundStatuses),
  status: readSavedChoice(filters.status, transactionStatuses),
  targetCurrency: readSavedChoice(filters.targetCurrency, targetCurrencies),
  webhookStatus: readSavedChoice(filters.webhookStatus, opsWebhookStatuses),
})

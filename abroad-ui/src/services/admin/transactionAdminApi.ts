import type { OpsMutationDetails } from './opsMutationTypes'

import { adminRequest, unwrapAdminResult } from './adminRequest'
import {
  OpsReconcileTransactionHashInput,
  OpsReconcileTransactionHashResponse,
  OpsRefundRecovery,
  OpsTransactionDetail,
  OpsTransactionEvidenceExport,
  OpsTransactionFilteredEvidenceExport,
  OpsTransactionListResponse,
  OpsTransactionSearchFilters,
} from './transactionAdminTypes'

type OpsRefundRecoveryWire = {
  amount: null | number
  asset: string
  attempts: number
  block_reason: null | string
  candidate_hash_fingerprint: null | string
  canonical_refund_recorded: boolean
  last_failure_category: null | string
  last_reconciliation: null | {
    at: string
    result: 'ABSENT' | 'AMBIGUOUS' | 'BLOCKED' | 'CONFIRMED'
  }
  network: string
  replacement_eligible: boolean
  status: OpsRefundRecovery['status']
  transaction_id: string
  version: number
}

const toRefundRecovery = (response: OpsRefundRecoveryWire): OpsRefundRecovery => ({
  amount: response.amount,
  asset: response.asset,
  attempts: response.attempts,
  blockReason: response.block_reason,
  candidateHashFingerprint: response.candidate_hash_fingerprint,
  canonicalRefundRecorded: response.canonical_refund_recorded,
  lastFailureCategory: response.last_failure_category,
  lastReconciliation: response.last_reconciliation,
  network: response.network,
  replacementEligible: response.replacement_eligible,
  status: response.status,
  transactionId: response.transaction_id,
  version: response.version,
})

export const searchTransactions = async (
  filters: OpsTransactionSearchFilters,
  signal?: AbortSignal,
): Promise<OpsTransactionListResponse> => {
  const result = await adminRequest<OpsTransactionListResponse>('/ops/transactions', {
    method: 'GET',
    query: {
      attention: filters.attention,
      caseOwnerId: filters.caseOwnerId,
      caseStatus: filters.caseStatus,
      createdFrom: filters.createdFrom,
      createdTo: filters.createdTo,
      cryptoCurrency: filters.cryptoCurrency,
      network: filters.network,
      page: filters.page,
      pageSize: filters.pageSize,
      partnerId: filters.partnerId,
      paymentMethod: filters.paymentMethod,
      proofStatus: filters.proofStatus,
      query: filters.query,
      refundStatus: filters.refundStatus,
      status: filters.status,
      targetCurrency: filters.targetCurrency,
      webhookStatus: filters.webhookStatus,
    },
    signal,
  })

  return unwrapAdminResult(result)
}

export const getTransaction = async (
  transactionId: string,
  signal?: AbortSignal,
): Promise<OpsTransactionDetail> => {
  const result = await adminRequest<OpsTransactionDetail>(`/ops/transactions/${transactionId}`, {
    method: 'GET',
    signal,
  })

  return unwrapAdminResult(result)
}

export const getRefundRecovery = async (
  transactionId: string,
  signal?: AbortSignal,
): Promise<OpsRefundRecovery> => {
  const result = await adminRequest<OpsRefundRecoveryWire>(
    `/ops/transactions/${encodeURIComponent(transactionId)}/refund-recovery`,
    { method: 'GET', signal },
  )
  return toRefundRecovery(unwrapAdminResult(result))
}

export const reconcileRefundRecovery = async (
  transactionId: string,
  mutation: OpsMutationDetails,
): Promise<OpsRefundRecovery> => {
  const result = await adminRequest<OpsRefundRecoveryWire>(
    `/ops/transactions/${encodeURIComponent(transactionId)}/refund-recovery/reconcile`,
    { method: 'POST', mutation },
  )
  return toRefundRecovery(unwrapAdminResult(result))
}

export const issueReplacementRefund = async (
  transactionId: string,
  mutation: OpsMutationDetails,
): Promise<OpsRefundRecovery> => {
  const result = await adminRequest<OpsRefundRecoveryWire>(
    `/ops/transactions/${encodeURIComponent(transactionId)}/refund-recovery/replace`,
    { method: 'POST', mutation },
  )
  return toRefundRecovery(unwrapAdminResult(result))
}

export const getTransactionReceipt = async (
  transactionId: string,
  language: 'en' | 'pt-BR' = 'pt-BR',
): Promise<{
  contentBase64: string
  contentType: 'application/pdf'
  fileName: string
  sizeBytes: number
}> => {
  const result = await adminRequest<{
    contentBase64: string
    contentType: 'application/pdf'
    fileName: string
    sizeBytes: number
  }>(`/ops/transactions/${encodeURIComponent(transactionId)}/receipt`, {
    method: 'GET',
    query: { lang: language },
  })
  return unwrapAdminResult(result)
}

export const exportTransactionEvidence = async (
  transactionId: string,
): Promise<OpsTransactionEvidenceExport> => {
  const result = await adminRequest<OpsTransactionEvidenceExport>(
    `/ops/transactions/${encodeURIComponent(transactionId)}/evidence`,
    { method: 'GET' },
  )
  return unwrapAdminResult(result)
}

export const exportFilteredTransactionEvidence = async (
  filters: OpsTransactionSearchFilters,
): Promise<OpsTransactionFilteredEvidenceExport> => {
  const result = await adminRequest<OpsTransactionFilteredEvidenceExport>('/ops/transactions/export', {
    method: 'GET',
    query: {
      attention: filters.attention,
      caseOwnerId: filters.caseOwnerId,
      caseStatus: filters.caseStatus,
      createdFrom: filters.createdFrom,
      createdTo: filters.createdTo,
      cryptoCurrency: filters.cryptoCurrency,
      network: filters.network,
      partnerId: filters.partnerId,
      paymentMethod: filters.paymentMethod,
      proofStatus: filters.proofStatus,
      query: filters.query,
      refundStatus: filters.refundStatus,
      status: filters.status,
      targetCurrency: filters.targetCurrency,
      webhookStatus: filters.webhookStatus,
    },
  })
  return unwrapAdminResult(result)
}

export const reconcileTransactionHash = async (
  payload: OpsReconcileTransactionHashInput,
  mutation: OpsMutationDetails,
): Promise<OpsReconcileTransactionHashResponse> => {
  const normalizedPayload = {
    ...payload,
    transaction_id: payload.transaction_id?.trim() || undefined,
  }

  const result = await adminRequest<OpsReconcileTransactionHashResponse>(
    '/ops/transactions/reconcile-hash',
    {
      body: JSON.stringify(normalizedPayload),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
      mutation,
    },
  )

  return unwrapAdminResult(result)
}

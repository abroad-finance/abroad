import type { OpsMutationDetails } from './opsMutationTypes'

import { adminRequest, unwrapAdminResult } from './adminRequest'
import {
  OpsReconcileTransactionHashInput,
  OpsReconcileTransactionHashResponse,
  OpsTransactionDetail,
  OpsTransactionEvidenceExport,
  OpsTransactionFilteredEvidenceExport,
  OpsTransactionListResponse,
  OpsTransactionSearchFilters,
} from './transactionAdminTypes'

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

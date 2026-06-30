import { adminRequest, unwrapAdminResult } from './adminRequest'
import {
  OpsReconcileTransactionHashInput,
  OpsReconcileTransactionHashResponse,
  OpsTransactionDetail,
  OpsTransactionListResponse,
  OpsTransactionSearchFilters,
} from './transactionAdminTypes'

export const searchTransactions = async (
  filters: OpsTransactionSearchFilters,
): Promise<OpsTransactionListResponse> => {
  const result = await adminRequest<OpsTransactionListResponse>('/ops/transactions', {
    method: 'GET',
    query: {
      externalId: filters.externalId,
      onChainId: filters.onChainId,
      page: filters.page,
      pageSize: filters.pageSize,
      partnerId: filters.partnerId,
      status: filters.status,
      userId: filters.userId,
    },
  })

  return unwrapAdminResult(result)
}

export const getTransaction = async (transactionId: string): Promise<OpsTransactionDetail> => {
  const result = await adminRequest<OpsTransactionDetail>(`/ops/transactions/${transactionId}`, {
    method: 'GET',
  })

  return unwrapAdminResult(result)
}

export const reconcileTransactionHash = async (
  payload: OpsReconcileTransactionHashInput,
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
    },
  )

  return unwrapAdminResult(result)
}

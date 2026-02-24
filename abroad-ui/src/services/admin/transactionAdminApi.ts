import { adminRequest, unwrapAdminResult } from './adminRequest'
import {
  OpsReconcileTransactionHashInput,
  OpsReconcileTransactionHashResponse,
} from './transactionAdminTypes'

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

import type { OpsMutationDetails } from './opsMutationTypes'

import { adminRequest, unwrapAdminResult } from './adminRequest'
import {
  OpsTreasuryBalancesResponse,
  OpsTreasuryMovementsResponse,
  OpsTreasurySnapshotsResponse,
  OpsTreasuryThreshold,
  OpsTreasuryThresholdInput,
} from './treasuryTypes'

export const getTreasuryBalances = async (): Promise<OpsTreasuryBalancesResponse> => {
  const result = await adminRequest<OpsTreasuryBalancesResponse>('/ops/treasury/balances', {
    method: 'GET',
  })

  return unwrapAdminResult(result)
}

export const getTreasuryMovements = async (days: number): Promise<OpsTreasuryMovementsResponse> => {
  const result = await adminRequest<OpsTreasuryMovementsResponse>(`/ops/treasury/movements?days=${days}`, {
    method: 'GET',
  })

  return unwrapAdminResult(result)
}

export const getTreasurySnapshots = async (days: number): Promise<OpsTreasurySnapshotsResponse> => {
  const result = await adminRequest<OpsTreasurySnapshotsResponse>(`/ops/treasury/snapshots?days=${days}`, {
    method: 'GET',
  })

  return unwrapAdminResult(result)
}

export const createTreasuryThreshold = async (
  input: OpsTreasuryThresholdInput,
  mutation: OpsMutationDetails,
): Promise<OpsTreasuryThreshold> => {
  const result = await adminRequest<OpsTreasuryThreshold>('/ops/treasury/thresholds', {
    body: JSON.stringify(input),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
    mutation,
  })
  return unwrapAdminResult(result)
}

export const updateTreasuryThreshold = async (
  thresholdId: string,
  input: OpsTreasuryThresholdInput,
  mutation: OpsMutationDetails,
): Promise<OpsTreasuryThreshold> => {
  const result = await adminRequest<OpsTreasuryThreshold>(`/ops/treasury/thresholds/${encodeURIComponent(thresholdId)}`, {
    body: JSON.stringify(input),
    headers: { 'Content-Type': 'application/json' },
    method: 'PATCH',
    mutation,
  })
  return unwrapAdminResult(result)
}

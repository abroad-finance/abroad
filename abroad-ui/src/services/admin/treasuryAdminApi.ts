import { adminRequest, unwrapAdminResult } from './adminRequest'
import {
  OpsTreasuryBalancesResponse,
  OpsTreasuryMovementsResponse,
  OpsTreasurySnapshotsResponse,
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

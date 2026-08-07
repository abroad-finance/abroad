import type { OpsMutationDetails } from './opsMutationTypes'

import { adminRequest, unwrapAdminResult } from './adminRequest'
import {
  OpsStablebondExecutionResult,
  OpsStablebondResponse,
  OpsStablebondTrustline,
  OpsTreasuryBalancesResponse,
  OpsTreasuryMovementsResponse,
  OpsTreasurySnapshotsResponse,
  OpsTreasuryThreshold,
  OpsTreasuryThresholdInput,
} from './treasuryTypes'

export const getStablebondPosition = async (): Promise<OpsStablebondResponse> => {
  const result = await adminRequest<OpsStablebondResponse>('/ops/treasury/stablebond', {
    method: 'GET',
  })

  return unwrapAdminResult(result)
}

/** Buys into the Stablebond position. Moves real treasury funds. */
export const acquireStablebond = async (
  spendUsdc: number,
  mutation: OpsMutationDetails,
): Promise<OpsStablebondExecutionResult> => {
  const result = await adminRequest<OpsStablebondExecutionResult>('/ops/treasury/stablebond/acquisitions', {
    body: JSON.stringify({ spendUsdc }),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
    mutation,
  })
  return unwrapAdminResult(result)
}

/** Opens the Stellar trustline the position needs. Idempotent; moves no funds. */
export const openStablebondTrustline = async (
  mutation: OpsMutationDetails,
): Promise<OpsStablebondTrustline> => {
  const result = await adminRequest<OpsStablebondTrustline>('/ops/treasury/stablebond/trustline', {
    method: 'POST',
    mutation,
  })
  return unwrapAdminResult(result)
}

/** Re-bases the position from the chain's own numbers. Moves no funds. */
export const registerStablebondBasis = async (
  mutation: OpsMutationDetails,
): Promise<OpsStablebondResponse> => {
  const result = await adminRequest<OpsStablebondResponse>('/ops/treasury/stablebond/basis', {
    method: 'POST',
    mutation,
  })
  return unwrapAdminResult(result)
}

/** Sells part of the position for USDC. Moves real treasury funds. */
export const unwindStablebond = async (
  requiredUsdc: number,
  mutation: OpsMutationDetails,
): Promise<OpsStablebondExecutionResult> => {
  const result = await adminRequest<OpsStablebondExecutionResult>('/ops/treasury/stablebond/unwinds', {
    body: JSON.stringify({ requiredUsdc }),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
    mutation,
  })
  return unwrapAdminResult(result)
}

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

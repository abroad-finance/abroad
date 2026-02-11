import type {
  CryptoAssetCoverage,
  CryptoAssetCoverageResponse,
  CryptoAssetUpdateInput,
  FlowCorridorListResponse,
  FlowCorridorUpdateInput,
  FlowDefinition,
  FlowDefinitionInput,
  FlowInstanceDetail,
  FlowInstanceListResponse,
  FlowInstanceStatus,
  FlowStepInstance,
} from './flowTypes'

import { adminRequest, unwrapAdminResult } from './adminRequest'

export const listFlowInstances = async (params: {
  page?: number
  pageSize?: number
  status?: FlowInstanceStatus
  stuckMinutes?: number
  transactionId?: string
}): Promise<FlowInstanceListResponse> => {
  const result = await adminRequest<FlowInstanceListResponse>('/ops/flows/instances', {
    method: 'GET',
    query: {
      page: params.page,
      pageSize: params.pageSize,
      status: params.status,
      stuckMinutes: params.stuckMinutes,
      transactionId: params.transactionId,
    },
  })

  return unwrapAdminResult(result)
}

export const listFlowDefinitions = async (): Promise<FlowDefinition[]> => {
  const result = await adminRequest<FlowDefinition[]>('/ops/flows/definitions', {
    method: 'GET',
  })

  return unwrapAdminResult(result)
}

export const listCryptoAssets = async (): Promise<CryptoAssetCoverageResponse> => {
  const result = await adminRequest<CryptoAssetCoverageResponse>('/ops/crypto-assets', {
    method: 'GET',
  })

  return unwrapAdminResult(result)
}

export const updateCryptoAsset = async (payload: CryptoAssetUpdateInput): Promise<CryptoAssetCoverage> => {
  const result = await adminRequest<CryptoAssetCoverage>('/ops/crypto-assets', {
    body: JSON.stringify(payload),
    headers: { 'Content-Type': 'application/json' },
    method: 'PATCH',
  })

  return unwrapAdminResult(result)
}

export const listFlowCorridors = async (): Promise<FlowCorridorListResponse> => {
  const result = await adminRequest<FlowCorridorListResponse>('/ops/flows/corridors', {
    method: 'GET',
  })

  return unwrapAdminResult(result)
}

export const updateFlowCorridor = async (
  payload: FlowCorridorUpdateInput,
): Promise<FlowCorridorListResponse['corridors'][number]> => {
  const result = await adminRequest<FlowCorridorListResponse['corridors'][number]>('/ops/flows/corridors', {
    body: JSON.stringify(payload),
    headers: { 'Content-Type': 'application/json' },
    method: 'PATCH',
  })

  return unwrapAdminResult(result)
}

export const createFlowDefinition = async (payload: FlowDefinitionInput): Promise<FlowDefinition> => {
  const result = await adminRequest<FlowDefinition>('/ops/flows/definitions', {
    body: JSON.stringify(payload),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  })

  return unwrapAdminResult(result)
}

export const updateFlowDefinition = async (
  flowDefinitionId: string,
  payload: FlowDefinitionInput,
): Promise<FlowDefinition> => {
  const result = await adminRequest<FlowDefinition>(`/ops/flows/definitions/${flowDefinitionId}`, {
    body: JSON.stringify(payload),
    headers: { 'Content-Type': 'application/json' },
    method: 'PATCH',
  })

  return unwrapAdminResult(result)
}

export const getFlowInstance = async (flowInstanceId: string): Promise<FlowInstanceDetail> => {
  const result = await adminRequest<FlowInstanceDetail>(`/ops/flows/instances/${flowInstanceId}`, {
    method: 'GET',
  })

  return unwrapAdminResult(result)
}

export const retryFlowStep = async (
  flowInstanceId: string,
  stepInstanceId: string,
): Promise<FlowStepInstance> => {
  const result = await adminRequest<FlowStepInstance>(
    `/ops/flows/instances/${flowInstanceId}/steps/${stepInstanceId}/retry`,
    { method: 'POST' },
  )

  return unwrapAdminResult(result)
}

export const requeueFlowStep = async (
  flowInstanceId: string,
  stepInstanceId: string,
): Promise<FlowStepInstance> => {
  const result = await adminRequest<FlowStepInstance>(
    `/ops/flows/instances/${flowInstanceId}/steps/${stepInstanceId}/requeue`,
    { method: 'POST' },
  )

  return unwrapAdminResult(result)
}

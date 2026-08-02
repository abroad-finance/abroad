import type {
  CryptoAssetCoverage,
  CryptoAssetCoverageResponse,
  CryptoAssetUpdateInput,
  FlowBulkRetryResponse,
  FlowCorridorListResponse,
  FlowCorridorUpdateInput,
  FlowDefinition,
  FlowDefinitionInput,
  FlowInstanceDetail,
  FlowInstanceListResponse,
  FlowInstanceSearchFilters,
  FlowStepInstance,
} from './flowTypes'
import type { OpsMutationDetails } from './opsMutationTypes'

import { adminRequest, unwrapAdminResult } from './adminRequest'

export const listFlowInstances = async (
  params: FlowInstanceSearchFilters,
  signal?: AbortSignal,
): Promise<FlowInstanceListResponse> => {
  const result = await adminRequest<FlowInstanceListResponse>('/ops/flows/instances', {
    method: 'GET',
    query: {
      blockchain: params.blockchain,
      createdFrom: params.createdFrom,
      createdTo: params.createdTo,
      cryptoCurrency: params.cryptoCurrency,
      failure: params.failure,
      onChainId: params.onChainId,
      page: params.page,
      pageSize: params.pageSize,
      partnerId: params.partnerId,
      payoutProvider: params.payoutProvider,
      status: params.status,
      stuckMinutes: params.stuckMinutes,
      targetCurrency: params.targetCurrency,
      transactionId: params.transactionId,
    },
    signal,
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

export const updateCryptoAsset = async (
  payload: CryptoAssetUpdateInput,
  mutation: OpsMutationDetails,
): Promise<CryptoAssetCoverage> => {
  const result = await adminRequest<CryptoAssetCoverage>('/ops/crypto-assets', {
    body: JSON.stringify(payload),
    headers: { 'Content-Type': 'application/json' },
    method: 'PATCH',
    mutation,
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
  mutation: OpsMutationDetails,
): Promise<FlowCorridorListResponse['corridors'][number]> => {
  const result = await adminRequest<FlowCorridorListResponse['corridors'][number]>('/ops/flows/corridors', {
    body: JSON.stringify(payload),
    headers: { 'Content-Type': 'application/json' },
    method: 'PATCH',
    mutation,
  })

  return unwrapAdminResult(result)
}

export const createFlowDefinition = async (
  payload: FlowDefinitionInput,
  mutation: OpsMutationDetails,
): Promise<FlowDefinition> => {
  const result = await adminRequest<FlowDefinition>('/ops/flows/definitions', {
    body: JSON.stringify(payload),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
    mutation,
  })

  return unwrapAdminResult(result)
}

export const updateFlowDefinition = async (
  flowDefinitionId: string,
  payload: FlowDefinitionInput,
  mutation: OpsMutationDetails,
): Promise<FlowDefinition> => {
  const result = await adminRequest<FlowDefinition>(`/ops/flows/definitions/${flowDefinitionId}`, {
    body: JSON.stringify(payload),
    headers: { 'Content-Type': 'application/json' },
    method: 'PATCH',
    mutation,
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
  mutation: OpsMutationDetails,
  options?: { force?: boolean },
): Promise<FlowStepInstance> => {
  const result = await adminRequest<FlowStepInstance>(
    `/ops/flows/instances/${flowInstanceId}/steps/${stepInstanceId}/retry`,
    {
      method: 'POST',
      mutation,
      query: { force: options?.force ? true : undefined },
    },
  )

  return unwrapAdminResult(result)
}

export const resumeFlowInstance = async (
  flowInstanceId: string,
  mutation: OpsMutationDetails,
): Promise<FlowStepInstance> => {
  const result = await adminRequest<FlowStepInstance>(
    `/ops/flows/instances/${flowInstanceId}/resume`,
    { method: 'POST', mutation },
  )

  return unwrapAdminResult(result)
}

export const bulkRetryFlowInstances = async (
  flowInstanceIds: string[],
  mutation: OpsMutationDetails,
): Promise<FlowBulkRetryResponse> => {
  const result = await adminRequest<FlowBulkRetryResponse>('/ops/flows/instances/bulk-retry', {
    body: JSON.stringify({ flowInstanceIds }),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
    mutation,
  })

  return unwrapAdminResult(result)
}

export const requeueFlowStep = async (
  flowInstanceId: string,
  stepInstanceId: string,
  mutation: OpsMutationDetails,
): Promise<FlowStepInstance> => {
  const result = await adminRequest<FlowStepInstance>(
    `/ops/flows/instances/${flowInstanceId}/steps/${stepInstanceId}/requeue`,
    { method: 'POST', mutation },
  )

  return unwrapAdminResult(result)
}

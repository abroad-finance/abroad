import type { ApiResult, HttpRequestConfig } from '../http/types'
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

import { httpClient } from '../http/httpClient'
import { getOpsApiKey } from './opsAuthStore'

const mergeHeaders = (...sets: Array<HeadersInit | undefined>): Headers => {
  const merged = new Headers()
  sets.forEach((set) => {
    if (!set) return
    const asHeaders = new Headers(set)
    asHeaders.forEach((value, key) => merged.set(key, value))
  })
  return merged
}

const adminRequest = async <TData, TError = unknown>(
  path: string,
  config: HttpRequestConfig & { method: NonNullable<HttpRequestConfig['method']> },
): Promise<ApiResult<TData, TError>> => {
  const opsApiKey = getOpsApiKey()
  if (!opsApiKey) {
    throw new Error('Ops API key is required')
  }
  const headers = mergeHeaders({ 'X-OPS-API-KEY': opsApiKey }, config.headers)
  return httpClient.request(path, {
    ...config,
    headers,
  })
}

const unwrap = <TData>(result: ApiResult<TData>): TData => {
  if (result.ok) return result.data
  const message = result.error.message || 'Request failed'
  throw new Error(message)
}

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

  return unwrap(result)
}

export const listFlowDefinitions = async (): Promise<FlowDefinition[]> => {
  const result = await adminRequest<FlowDefinition[]>('/ops/flows/definitions', {
    method: 'GET',
  })

  return unwrap(result)
}

export const listCryptoAssets = async (): Promise<CryptoAssetCoverageResponse> => {
  const result = await adminRequest<CryptoAssetCoverageResponse>('/ops/crypto-assets', {
    method: 'GET',
  })

  return unwrap(result)
}

export const updateCryptoAsset = async (payload: CryptoAssetUpdateInput): Promise<CryptoAssetCoverage> => {
  const result = await adminRequest<CryptoAssetCoverage>('/ops/crypto-assets', {
    body: JSON.stringify(payload),
    headers: { 'Content-Type': 'application/json' },
    method: 'PATCH',
  })

  return unwrap(result)
}

export const listFlowCorridors = async (): Promise<FlowCorridorListResponse> => {
  const result = await adminRequest<FlowCorridorListResponse>('/ops/flows/corridors', {
    method: 'GET',
  })

  return unwrap(result)
}

export const updateFlowCorridor = async (
  payload: FlowCorridorUpdateInput,
): Promise<FlowCorridorListResponse['corridors'][number]> => {
  const result = await adminRequest<FlowCorridorListResponse['corridors'][number]>('/ops/flows/corridors', {
    body: JSON.stringify(payload),
    headers: { 'Content-Type': 'application/json' },
    method: 'PATCH',
  })

  return unwrap(result)
}

export const createFlowDefinition = async (payload: FlowDefinitionInput): Promise<FlowDefinition> => {
  const result = await adminRequest<FlowDefinition>('/ops/flows/definitions', {
    body: JSON.stringify(payload),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  })

  return unwrap(result)
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

  return unwrap(result)
}

export const getFlowInstance = async (flowInstanceId: string): Promise<FlowInstanceDetail> => {
  const result = await adminRequest<FlowInstanceDetail>(`/ops/flows/instances/${flowInstanceId}`, {
    method: 'GET',
  })

  return unwrap(result)
}

export const retryFlowStep = async (
  flowInstanceId: string,
  stepInstanceId: string,
): Promise<FlowStepInstance> => {
  const result = await adminRequest<FlowStepInstance>(
    `/ops/flows/instances/${flowInstanceId}/steps/${stepInstanceId}/retry`,
    { method: 'POST' },
  )

  return unwrap(result)
}

export const requeueFlowStep = async (
  flowInstanceId: string,
  stepInstanceId: string,
): Promise<FlowStepInstance> => {
  const result = await adminRequest<FlowStepInstance>(
    `/ops/flows/instances/${flowInstanceId}/steps/${stepInstanceId}/requeue`,
    { method: 'POST' },
  )

  return unwrap(result)
}

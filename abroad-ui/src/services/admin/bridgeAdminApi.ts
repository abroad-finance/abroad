import { adminRequest, unwrapAdminResult } from './adminRequest'
import { OpsBridgeBatchDetail, OpsBridgeOverview } from './bridgeTypes'

export const getBridgeOverview = async (): Promise<OpsBridgeOverview> => {
  const result = await adminRequest<OpsBridgeOverview>('/ops/bridge/overview', {
    method: 'GET',
  })

  return unwrapAdminResult(result)
}

export const getBridgeBatchDetail = async (batchId: string): Promise<OpsBridgeBatchDetail> => {
  const result = await adminRequest<OpsBridgeBatchDetail>(`/ops/bridge/batches/${encodeURIComponent(batchId)}`, {
    method: 'GET',
  })
  return unwrapAdminResult(result)
}

import { adminRequest, unwrapAdminResult } from './adminRequest'
import { OpsBridgeOverview } from './bridgeTypes'

export const getBridgeOverview = async (): Promise<OpsBridgeOverview> => {
  const result = await adminRequest<OpsBridgeOverview>('/ops/bridge/overview', {
    method: 'GET',
  })

  return unwrapAdminResult(result)
}

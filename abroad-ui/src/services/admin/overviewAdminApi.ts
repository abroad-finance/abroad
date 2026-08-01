import type { OpsOverviewRange, OpsOverviewResponse } from './overviewTypes'

import { adminRequest, unwrapAdminResult } from './adminRequest'

export const getOpsOverview = async (range: OpsOverviewRange): Promise<OpsOverviewResponse> => {
  const result = await adminRequest<OpsOverviewResponse>(
    `/ops/overview?range=${encodeURIComponent(range)}`,
    { method: 'GET' },
  )

  return unwrapAdminResult(result)
}

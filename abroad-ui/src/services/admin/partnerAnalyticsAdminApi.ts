import type {
  OpsPartnerActivityFilter,
  OpsPartnerAnalyticsRange,
  OpsPartnerDirectoryResponse,
  OpsPartnerLifecycleFilter,
  OpsPartnerScorecard,
} from './partnerAnalyticsTypes'

import { adminRequest, unwrapAdminResult } from './adminRequest'

export const listOpsPartnerDirectory = async (params: {
  activity?: OpsPartnerActivityFilter
  country?: string
  lifecycle?: OpsPartnerLifecycleFilter
  page?: number
  pageSize?: number
  query?: string
  range?: OpsPartnerAnalyticsRange
}): Promise<OpsPartnerDirectoryResponse> => {
  const result = await adminRequest<OpsPartnerDirectoryResponse>('/ops/partner-analytics', {
    method: 'GET',
    query: params,
  })
  return unwrapAdminResult(result)
}

export const getOpsPartnerScorecard = async (
  partnerId: string,
  range: OpsPartnerAnalyticsRange,
): Promise<OpsPartnerScorecard> => {
  const result = await adminRequest<OpsPartnerScorecard>(`/ops/partner-analytics/${encodeURIComponent(partnerId)}`, {
    method: 'GET',
    query: { range },
  })
  return unwrapAdminResult(result)
}

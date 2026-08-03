import type {
  BusinessPerformanceRequest,
  BusinessPerformanceResponse,
} from './businessPerformanceTypes'

import { adminRequest, unwrapAdminResult } from './adminRequest'

export const getBusinessPerformance = async (
  request: BusinessPerformanceRequest,
): Promise<BusinessPerformanceResponse> => {
  const query = new URLSearchParams({
    from: request.primary.from,
    to: request.primary.to,
  })
  if (request.comparison) {
    query.set('comparisonFrom', request.comparison.from)
    query.set('comparisonTo', request.comparison.to)
  }
  const result = await adminRequest<BusinessPerformanceResponse>(
    `/ops/business-performance?${query.toString()}`,
    { method: 'GET' },
  )
  return unwrapAdminResult(result)
}

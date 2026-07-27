import type { TransparencyMetricsResponse } from '../../api'

import { httpClient } from '../http/httpClient'

const DEFAULT_API_BASE_URL = 'https://api.abroad.finance'

export const transparencyMetricsUrl = `${
  (import.meta.env.VITE_API_URL || DEFAULT_API_BASE_URL).replace(/\/+$/, '')
}/public/transparency`

export const fetchTransparencyMetrics = async (
  signal?: AbortSignal,
): Promise<TransparencyMetricsResponse> => {
  const result = await httpClient.request<TransparencyMetricsResponse>(
    '/public/transparency',
    {
      cache: 'no-store',
      method: 'GET',
      signal,
    },
  )

  if (result.ok) return result.data

  throw new Error(result.error.message || 'Current transparency metrics are unavailable')
}

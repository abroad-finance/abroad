import type { ApiResult, HttpRequestConfig } from '../http/types'

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

type ApiErrorBody = {
  reason?: string
}

const getErrorMessage = (result: ApiResult<unknown>): string => {
  if (result.ok) return ''
  const body = result.error.body
  if (typeof body === 'object' && body !== null && 'reason' in body) {
    const reason = (body as ApiErrorBody).reason
    if (typeof reason === 'string' && reason.trim().length > 0) {
      return reason
    }
  }
  return result.error.message || 'Request failed'
}

export const adminRequest = async <TData, TError = unknown>(
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

export const unwrapAdminResult = <TData>(result: ApiResult<TData>): TData => {
  if (result.ok) return result.data
  throw new Error(getErrorMessage(result))
}

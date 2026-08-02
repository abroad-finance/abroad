import type { ApiResult, HttpRequestConfig } from '../http/types'

import { HttpClient } from '../http/httpClient'
import { getOpsCredentialHeaders } from './opsIdentityApi'
import { OpsMutationDetails } from './opsMutationTypes'

const adminHttpClient = new HttpClient({ getAuthToken: () => null })

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
  code?: string
  reason?: string
}

export class OpsAdminRequestError extends Error {
  public readonly code: null | string

  public readonly status: null | number

  public constructor(message: string, status: null | number, code: null | string) {
    super(message)
    this.code = code
    this.name = 'OpsAdminRequestError'
    this.status = status
  }
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

const getErrorCode = (result: ApiResult<unknown>): null | string => {
  if (result.ok) return null
  const body = result.error.body
  if (typeof body !== 'object' || body === null || !('code' in body)) return null
  const code = (body as ApiErrorBody).code
  return typeof code === 'string' && code.trim() ? code : null
}

const getMutationHeaders = (mutation: OpsMutationDetails | undefined): Headers | undefined => {
  if (!mutation) return undefined
  const headers = new Headers({
    'X-Ops-Confirmation': mutation.confirmation,
    'X-Ops-Idempotency-Key': mutation.idempotencyKey,
    'X-Ops-Reason': mutation.reason,
  })
  if (mutation.expectedVersion !== undefined) {
    headers.set('If-Match', `"${mutation.expectedVersion}"`)
  }
  if (mutation.reference) {
    headers.set('X-Ops-Reference', mutation.reference)
  }
  return headers
}

type AdminRequestConfig = HttpRequestConfig & {
  method: NonNullable<HttpRequestConfig['method']>
  mutation?: OpsMutationDetails
}

export const adminRequest = async <TData, TError = unknown>(
  path: string,
  config: AdminRequestConfig,
): Promise<ApiResult<TData, TError>> => {
  const {
    mutation,
    ...requestConfig
  } = config
  const headers = mergeHeaders(
    await getOpsCredentialHeaders(),
    getMutationHeaders(mutation),
    requestConfig.headers,
  )
  return adminHttpClient.request(path, {
    ...requestConfig,
    headers,
  })
}

export const unwrapAdminResult = <TData>(result: ApiResult<TData>): TData => {
  if (result.ok) return result.data
  throw new OpsAdminRequestError(getErrorMessage(result), result.status, getErrorCode(result))
}

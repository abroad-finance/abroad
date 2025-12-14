import type {
  ApiResult, HttpErrorBody, HttpRequestConfig,
} from '../services/http/types'

import { httpClient } from '../services/http/httpClient'

export type ApiClientResponse<TResponse, TError = unknown> = TResponse & {
  error?: HttpErrorBody<TError>
  ok: boolean
  status: number
}

export type ClientOptions = HttpRequestConfig & { method: NonNullable<HttpRequestConfig['method']> }

const normalizeHeaders = (headers: Headers | null): Headers => headers ?? new Headers()
const normalizeStatus = (status: null | number): number => status ?? 0

export const customClient = async <TResponse, TError = unknown>(
  url: string,
  options: ClientOptions,
): Promise<ApiClientResponse<TResponse, TError>> => {
  const result: ApiResult<unknown, TError> = await httpClient.request(url, options)

  if (result.ok) {
    const success = {
      data: result.data,
      headers: normalizeHeaders(result.headers),
      ok: true,
      status: normalizeStatus(result.status),
    } as unknown as ApiClientResponse<TResponse, TError>
    return success
  }

  const failure = {
    data: (result.error.body ?? null),
    error: result.error,
    headers: normalizeHeaders(result.headers),
    ok: false,
    status: normalizeStatus(result.status),
  } as unknown as ApiClientResponse<TResponse, TError>
  return failure
}

export default customClient

export type BodyType<BodyData> = BodyData
export type ErrorType<Error> = ApiResult<Error>

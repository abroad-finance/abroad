import type { ApiResult, HttpRequestConfig } from '../services/http/types'

import { httpClient } from '../services/http/httpClient'

export type ClientOptions = HttpRequestConfig & { method: NonNullable<HttpRequestConfig['method']> }

export const customClient = async <TSuccess, TError = unknown>(
  url: string,
  options: ClientOptions,
): Promise<ApiResult<TSuccess, TError>> => {
  return httpClient.request<TSuccess, TError>(url, options)
}

export default customClient

export type BodyType<BodyData> = BodyData
export type ErrorType<Error> = ApiResult<Error>

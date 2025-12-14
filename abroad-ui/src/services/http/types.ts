export interface ApiFailure<TError = unknown> {
  error: HttpErrorBody<TError>
  headers: Headers | null
  ok: false
  status: null | number
}

export type ApiResult<TData, TError = unknown> = ApiFailure<TError> | ApiSuccess<TData>

export interface ApiSuccess<TData> {
  data: TData
  headers: Headers
  ok: true
  status: number
}

export interface HttpErrorBody<TError = unknown> {
  body?: null | TError
  message: string
  status?: null | number
  type: HttpErrorType
}

export type HttpErrorType = 'aborted' | 'http' | 'network' | 'parse'

export type HttpMethod = 'DELETE' | 'GET' | 'PATCH' | 'POST' | 'PUT'

export interface HttpRequestConfig extends Omit<RequestInit, 'body' | 'headers' | 'method'> {
  body?: BodyInit | null
  headers?: HeadersInit
  method?: HttpMethod
  query?: QueryParams
  signal?: AbortSignal | null
}

export type QueryParams = Record<string, boolean | null | number | string | undefined>

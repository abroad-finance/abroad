import type {
  ApiFailure, ApiResult, ApiSuccess, HttpErrorBody, HttpRequestConfig,
} from './types'

import { authTokenStore } from '../auth/authTokenStore'

type HttpClientOptions = {
  baseUrl?: string
  getAuthToken?: () => null | string
  headers?: HeadersInit
}

const defaultBaseUrl = import.meta.env.VITE_API_URL || 'https://api.abroad.finance'

const isJsonResponse = (response: Response): boolean => {
  const contentType = response.headers.get('content-type') || ''
  return contentType.toLowerCase().includes('application/json')
}

const buildUrl = (baseUrl: string, path: string, query?: HttpRequestConfig['query']): string => {
  const target = path.startsWith('http') ? path : `${baseUrl}${path}`
  if (!query || Object.keys(query).length === 0) return target
  const params = new URLSearchParams()
  Object.entries(query).forEach(([key, value]) => {
    if (value === undefined) return
    params.append(key, value === null ? 'null' : String(value))
  })
  const suffix = params.toString()
  return suffix ? `${target}?${suffix}` : target
}

const mergeHeaders = (...sets: Array<HeadersInit | undefined>): Headers => {
  const merged = new Headers()
  sets.forEach((set) => {
    if (!set) return
    const asHeaders = new Headers(set)
    asHeaders.forEach((value, key) => merged.set(key, value))
  })
  return merged
}

export class HttpClient {
  private readonly baseUrl: string

  private readonly defaultHeaders?: HeadersInit

  private readonly getAuthToken?: () => null | string

  constructor(options: HttpClientOptions = {}) {
    this.baseUrl = options.baseUrl || defaultBaseUrl
    this.getAuthToken = options.getAuthToken || (() => authTokenStore.getToken())
    this.defaultHeaders = options.headers
  }

  async request<TData, TError = unknown>(path: string, config: HttpRequestConfig): Promise<ApiResult<TData, TError>> {
    const {
      body,
      headers,
      method = 'GET',
      query,
      signal,
      ...rest
    } = config

    const token = this.getAuthToken?.()
    const mergedHeaders = mergeHeaders(
      this.defaultHeaders,
      headers,
      token ? { Authorization: `Bearer ${token}` } : undefined,
    )

    const url = buildUrl(this.baseUrl, path, query)

    let response: Response
    try {
      response = await fetch(url, {
        ...rest,
        body,
        headers: mergedHeaders,
        method,
        signal,
      })
    }
    catch (err) {
      const errorBody: HttpErrorBody<TError> = {
        body: null,
        message: err instanceof Error ? err.message : String(err),
        status: null,
        type: err instanceof DOMException && err.name === 'AbortError' ? 'aborted' : 'network',
      }
      const failure: ApiFailure<TError> = {
        error: errorBody,
        headers: null,
        ok: false,
        status: null,
      }
      return failure
    }

    const { headers: responseHeaders, ok, status } = response
    const parsePayload = async (): Promise<unknown> => {
      if (status === 204) return null
      if (isJsonResponse(response)) {
        try {
          return await response.json()
        }
        catch (err) {
          const parseError: ApiFailure<TError> = {
            error: {
              body: null,
              message: err instanceof Error ? err.message : 'Failed to parse JSON response',
              status,
              type: 'parse',
            },
            headers: responseHeaders,
            ok: false,
            status,
          }
          return parseError
        }
      }
      return response.text()
    }

    const payload = await parsePayload()
    if (!ok) {
      const error: ApiFailure<TError> = {
        error: {
          body: (payload as TError) ?? null,
          message: `Request failed with status ${status}`,
          status,
          type: status === 0 ? 'network' : 'http',
        },
        headers: responseHeaders,
        ok: false,
        status,
      }
      return error
    }

    if (typeof (payload as ApiFailure<TError>)?.ok === 'boolean' && !(payload as ApiFailure<TError>).ok) {
      return payload as ApiFailure<TError>
    }

    const success: ApiSuccess<TData> = {
      data: payload as TData,
      headers: responseHeaders,
      ok: true,
      status,
    }
    return success
  }
}

export const httpClient = new HttpClient()

import { AxiosError } from 'axios'

const baseURL = import.meta.env.VITE_API_URL || 'https://api.abroad.finance'

export const customClient = async <T>(
  url: string,
  {
    body,
    headers = [],
    method,
    params,
  }: {
    body?: BodyInit | null
    headers?: HeadersInit
    method: 'DELETE' | 'GET' | 'PATCH' | 'POST' | 'PUT'
    params?: Record<string, string>
    responseType?: string
  },
): Promise<T> => {
  let targetUrl = `${baseURL}${url}`

  if (params) {
    targetUrl += '?' + new URLSearchParams(params)
  }

  let token: null | string = null

  const tokenFromStorage = localStorage.getItem('token')
  if (tokenFromStorage) {
    token = tokenFromStorage
    headers = {
      ...headers,
      Authorization: `Bearer ${token}`,
    }
  }

  const response = await fetch(targetUrl, {
    body,
    headers,
    method,
  })

  return {
    data: await response.json(),
    status: response.status,
    statusText: response.statusText,
  } as unknown as T
}

export default customClient

export type BodyType<BodyData> = BodyData
export type ErrorType<Error> = AxiosError<Error>

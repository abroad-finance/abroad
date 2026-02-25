import type { ApiResult } from '../http/types'
import type {
  AcceptTransactionRequest,
  AcceptTransactionResponse,
  NotifyPaymentRequest,
  PublicCorridorResponse,
  QuoteRequest,
  QuoteResponse,
  ReverseQuoteRequest,
} from './types'
import type { PaginatedTransactionList } from './transactionTypes'

import { httpClient } from '../http/httpClient'

const jsonHeaders = { 'Content-Type': 'application/json' }

export const fetchPublicCorridors = async (): Promise<PublicCorridorResponse> => {
  const result = await httpClient.request<PublicCorridorResponse>('/public/corridors', { method: 'GET' })
  if (result.ok) return result.data
  throw new Error(result.error.message || 'Failed to fetch corridors')
}

export const requestQuote = async (
  payload: QuoteRequest,
  options?: { signal?: AbortSignal | null },
): Promise<ApiResult<QuoteResponse>> => {
  return httpClient.request<QuoteResponse>('/quote', {
    body: JSON.stringify(payload),
    headers: jsonHeaders,
    method: 'POST',
    signal: options?.signal ?? null,
  })
}

export const requestReverseQuote = async (
  payload: ReverseQuoteRequest,
  options?: { signal?: AbortSignal | null },
): Promise<ApiResult<QuoteResponse>> => {
  return httpClient.request<QuoteResponse>('/quote/reverse', {
    body: JSON.stringify(payload),
    headers: jsonHeaders,
    method: 'POST',
    signal: options?.signal ?? null,
  })
}

export const acceptTransactionRequest = async (
  payload: AcceptTransactionRequest,
): Promise<ApiResult<AcceptTransactionResponse>> => {
  return httpClient.request<AcceptTransactionResponse>('/transaction', {
    body: JSON.stringify(payload),
    headers: jsonHeaders,
    method: 'POST',
  })
}

export const notifyPayment = async (
  payload: NotifyPaymentRequest,
): Promise<ApiResult<{ enqueued: boolean }>> => {
  return httpClient.request<{ enqueued: boolean }>('/payments/notify', {
    body: JSON.stringify(payload),
    headers: jsonHeaders,
    method: 'POST',
  })
}

export const getUserTransactions = async (
  options?: { page?: number; pageSize?: number; confirmedOnly?: boolean; signal?: AbortSignal | null },
): Promise<ApiResult<PaginatedTransactionList>> => {
  const { page = 1, pageSize = 20, confirmedOnly = false, signal = null } = options ?? {}

  const endpoint = confirmedOnly ? '/transactions/list/confirmed' : '/transactions/list'

  return httpClient.request<PaginatedTransactionList>(endpoint, {
    method: 'GET',
    query: { page, pageSize },
    signal,
  })
}

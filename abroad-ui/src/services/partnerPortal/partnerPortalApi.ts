import type { ApiResult } from '../http/types'
import type {
  PartnerPortalSession,
  PartnerTransactionDetail,
  PartnerTransactionFilters,
  PartnerTransactionListResponse,
} from './partnerPortalTypes'

import { HttpClient } from '../http/httpClient'
import { clearPartnerPortalSession, getPartnerPortalToken } from './partnerPortalSessionStore'

type ApiErrorBody = { reason?: string }

const bootstrapClient = new HttpClient({ getAuthToken: () => null })
const portalClient = new HttpClient({ getAuthToken: getPartnerPortalToken })

const errorMessage = (result: ApiResult<unknown, ApiErrorBody>): string => {
  if (result.ok) return ''
  const reason = result.error.body?.reason
  if (typeof reason === 'string' && reason.trim()) return reason
  if (result.status === 401) return 'Your session is no longer valid. Sign in again.'
  return result.error.message || 'Request failed'
}

const unwrap = <TData>(result: ApiResult<TData, ApiErrorBody>): TData => {
  if (result.ok) return result.data
  if (result.status === 401) clearPartnerPortalSession()
  throw new Error(errorMessage(result))
}

const queryFromFilters = (filters: PartnerTransactionFilters) => ({
  createdFrom: filters.createdFrom,
  createdTo: filters.createdTo,
  page: filters.page,
  pageSize: filters.pageSize,
  query: filters.query,
  status: filters.status,
})

export const createPartnerPortalSession = async (apiKey: string): Promise<PartnerPortalSession> => {
  const result = await bootstrapClient.request<PartnerPortalSession, ApiErrorBody>(
    '/partner-portal/session',
    {
      headers: { 'X-API-Key': apiKey.trim() },
      method: 'POST',
    },
  )
  return unwrap(result)
}

export const exportPartnerTransactions = async (
  filters: PartnerTransactionFilters,
): Promise<string> => {
  const result = await portalClient.request<string, ApiErrorBody>(
    '/partner-portal/transactions/export.csv',
    {
      method: 'GET',
      query: queryFromFilters(filters),
    },
  )
  return unwrap(result)
}

export const getPartnerTransaction = async (
  transactionId: string,
  signal?: AbortSignal,
): Promise<PartnerTransactionDetail> => {
  const result = await portalClient.request<PartnerTransactionDetail, ApiErrorBody>(
    `/partner-portal/transactions/${encodeURIComponent(transactionId)}`,
    { method: 'GET', signal },
  )
  return unwrap(result)
}

export const listPartnerTransactions = async (
  filters: PartnerTransactionFilters,
  signal?: AbortSignal,
): Promise<PartnerTransactionListResponse> => {
  const result = await portalClient.request<PartnerTransactionListResponse, ApiErrorBody>(
    '/partner-portal/transactions',
    {
      method: 'GET',
      query: queryFromFilters(filters),
      signal,
    },
  )
  return unwrap(result)
}

import type { TransactionStatus } from '../../api'
import type { ConsumerUxTelemetryRequest } from '../../observability/consumerUxTelemetry'
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

import { httpClient } from '../http/httpClient'
import { publicCorridorResponseSchema, quoteResponseSchema } from './types'

export type PixCheckoutTelemetryRequest = {
  blockchain: 'CELO' | 'OTHER' | 'SOLANA' | 'STELLAR'
  chainFamily: 'evm' | 'other' | 'solana' | 'stellar'
  entryPoint: 'manual' | 'qr'
  eventName:
    | 'checkout_ready'
    | 'confirmation_viewed'
    | 'gate_blocked'
    | 'quote_ready'
    | 'submission_accepted'
    | 'submission_rejected'
    | 'submission_started'
  gate?:
    | 'above_maximum'
    | 'amount_missing'
    | 'balance_pending'
    | 'below_minimum'
    | 'cpf_missing'
    | 'insufficient_balance'
    | 'pix_key_missing'
    | 'quote_pending'
    | 'quote_unavailable'
    | 'wallet_not_authenticated'
    | 'wallet_not_ready'
  rail: 'PIX'
  schemaVersion: 1
  sourceAsset: 'OTHER' | 'USDC' | 'USDT'
  statusClass?:
    | 'client_error'
    | 'network_error'
    | 'server_error'
    | 'unexpected'
  targetCurrency: 'BRL'
  walletSurface: 'minipay' | 'web'
}

export type TransactionStatusResponse = {
  id: string
  kycRequired: boolean
  on_chain_tx_hash: null | string
  status: TransactionStatus
  transaction_reference: null | string
  user_id: string
}

const jsonHeaders = { 'Content-Type': 'application/json' }

/**
 * Lists corridors for one direction. Payouts and onramps are separate corridors
 * with separate limits, so asking for both at once cannot tell them apart.
 */
export const fetchPublicCorridors = async (
  direction?: 'FIAT_TO_CRYPTO',
): Promise<PublicCorridorResponse> => {
  const path = direction ? `/public/corridors?direction=${direction}` : '/public/corridors'
  const result = await httpClient.request<PublicCorridorResponse>(path, { method: 'GET' })
  if (result.ok) {
    const parsed = publicCorridorResponseSchema.safeParse(result.data)
    if (parsed.success) return parsed.data
    throw new Error('Invalid corridor configuration response')
  }
  throw new Error(result.error.message || 'Failed to fetch corridors')
}

const validateQuoteResult = (
  result: ApiResult<QuoteResponse>,
): ApiResult<QuoteResponse> => {
  if (!result.ok) return result
  const parsed = quoteResponseSchema.safeParse(result.data)
  if (parsed.success) return { ...result, data: parsed.data }
  return {
    error: {
      body: null,
      message: 'Invalid quote response',
      status: result.status,
      type: 'parse',
    },
    headers: result.headers,
    ok: false,
    status: result.status,
  }
}

export const requestQuote = async (
  payload: QuoteRequest,
  options?: { signal?: AbortSignal | null },
): Promise<ApiResult<QuoteResponse>> => {
  const result = await httpClient.request<QuoteResponse>('/quote', {
    body: JSON.stringify(payload),
    headers: jsonHeaders,
    method: 'POST',
    signal: options?.signal ?? null,
  })
  return validateQuoteResult(result)
}

export const requestReverseQuote = async (
  payload: ReverseQuoteRequest,
  options?: { signal?: AbortSignal | null },
): Promise<ApiResult<QuoteResponse>> => {
  const result = await httpClient.request<QuoteResponse>('/quote/reverse', {
    body: JSON.stringify(payload),
    headers: jsonHeaders,
    method: 'POST',
    signal: options?.signal ?? null,
  })
  return validateQuoteResult(result)
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

export const sendPixCheckoutTelemetry = async (
  payload: PixCheckoutTelemetryRequest,
): Promise<ApiResult<{ accepted: true }>> => {
  return httpClient.request<{ accepted: true }>('/telemetry/pix-checkout', {
    body: JSON.stringify(payload),
    headers: jsonHeaders,
    keepalive: true,
    method: 'POST',
  })
}

export const sendConsumerUxTelemetry = async (
  payload: ConsumerUxTelemetryRequest,
): Promise<ApiResult<{ accepted: true }>> => {
  return httpClient.request<{ accepted: true }>('/telemetry/consumer-ux', {
    body: JSON.stringify(payload),
    headers: jsonHeaders,
    keepalive: true,
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

export const getTransactionStatus = async (
  transactionId: string,
  options?: { signal?: AbortSignal | null },
): Promise<ApiResult<TransactionStatusResponse>> => {
  return httpClient.request<TransactionStatusResponse>(`/transaction/${encodeURIComponent(transactionId)}`, {
    method: 'GET',
    signal: options?.signal ?? null,
  })
}

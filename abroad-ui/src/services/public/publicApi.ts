import type { TransactionStatus } from '../../api'
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

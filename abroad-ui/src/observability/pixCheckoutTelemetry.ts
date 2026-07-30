import type { PixCheckoutTelemetryRequest } from '../services/public/publicApi'

import { sendPixCheckoutTelemetry } from '../services/public/publicApi'

export type PixCheckoutEntryPoint = 'manual' | 'qr'
export type PixCheckoutEvent
  = | PixCheckoutBaseEvent & {
    gate: PixCheckoutGate
    name: 'gate_blocked'
  }
  | PixCheckoutBaseEvent & {
    name: 'submission_rejected'
    statusClass: PixCheckoutStatusClass
  }
  | PixCheckoutBaseEvent & {
    name:
      | 'checkout_ready'
      | 'confirmation_viewed'
      | 'quote_ready'
      | 'submission_accepted'
      | 'submission_started'
  }
export type PixCheckoutGate
  = | 'above_maximum'
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

export type PixCheckoutGateSnapshot = {
  authenticated: boolean
  balanceLoading: boolean
  hasAmounts: boolean
  hasPixKey: boolean
  hasQuote: boolean
  hasTaxId: boolean
  insufficientBalance: boolean
  isAboveMaximum: boolean
  isBelowMinimum: boolean
  isMiniPay: boolean
  isMiniPayReady: boolean
  quoteLoading: boolean
}
export type PixCheckoutStatusClass
  = | 'client_error'
    | 'network_error'
    | 'server_error'
    | 'unexpected'
export type PixCheckoutTelemetryContext = {
  blockchain: PixCheckoutBlockchain
  chainFamily: PixCheckoutChainFamily
  entryPoint: PixCheckoutEntryPoint
  sourceAsset: PixCheckoutSourceAsset
  walletSurface: PixCheckoutWalletSurface
}
export type PixCheckoutTelemetryPayload = PixCheckoutTelemetryRequest

export type PixCheckoutWalletSurface = 'minipay' | 'web'

type PixCheckoutBaseEvent = {
  context: PixCheckoutTelemetryContext
}

type PixCheckoutBlockchain = 'CELO' | 'OTHER' | 'SOLANA' | 'STELLAR'

type PixCheckoutChainFamily = 'evm' | 'other' | 'solana' | 'stellar'

type PixCheckoutSourceAsset = 'OTHER' | 'USDC' | 'USDT'

const normalizeBlockchain = (value: string): PixCheckoutBlockchain => {
  switch (value.trim().toUpperCase()) {
    case 'CELO':
      return 'CELO'
    case 'SOLANA':
      return 'SOLANA'
    case 'STELLAR':
      return 'STELLAR'
    default:
      return 'OTHER'
  }
}

const normalizeChainFamily = (value: string): PixCheckoutChainFamily => {
  switch (value.trim().toLowerCase()) {
    case 'evm':
      return 'evm'
    case 'solana':
      return 'solana'
    case 'stellar':
      return 'stellar'
    default:
      return 'other'
  }
}

const normalizeSourceAsset = (value: string): PixCheckoutSourceAsset => {
  switch (value.trim().toUpperCase()) {
    case 'USDC':
      return 'USDC'
    case 'USDT':
      return 'USDT'
    default:
      return 'OTHER'
  }
}

export const buildPixCheckoutTelemetryContext = ({
  blockchain,
  chainFamily,
  cryptoCurrency,
  entryPoint,
  walletSurface,
}: {
  blockchain: string
  chainFamily: string
  cryptoCurrency: string
  entryPoint: PixCheckoutEntryPoint
  walletSurface: PixCheckoutWalletSurface
}): PixCheckoutTelemetryContext => ({
  blockchain: normalizeBlockchain(blockchain),
  chainFamily: normalizeChainFamily(chainFamily),
  entryPoint,
  sourceAsset: normalizeSourceAsset(cryptoCurrency),
  walletSurface,
})

export const resolvePixCheckoutGate = ({
  authenticated,
  balanceLoading,
  hasAmounts,
  hasPixKey,
  hasQuote,
  hasTaxId,
  insufficientBalance,
  isAboveMaximum,
  isBelowMinimum,
  isMiniPay,
  isMiniPayReady,
  quoteLoading,
}: PixCheckoutGateSnapshot): null | PixCheckoutGate => {
  if (!authenticated) return 'wallet_not_authenticated'
  if (isMiniPay && !isMiniPayReady) return 'wallet_not_ready'
  if (isBelowMinimum) return 'below_minimum'
  if (isAboveMaximum) return 'above_maximum'
  if (quoteLoading) return 'quote_pending'
  if (!hasAmounts) return 'amount_missing'
  if (!hasQuote) return 'quote_unavailable'
  if (balanceLoading) return 'balance_pending'
  if (insufficientBalance) return 'insufficient_balance'
  if (!hasPixKey) return 'pix_key_missing'
  if (!hasTaxId) return 'cpf_missing'
  return null
}

export const classifyPixCheckoutStatus = (status: null | number): PixCheckoutStatusClass => {
  if (status == null) return 'network_error'
  if (status >= 400 && status < 500) return 'client_error'
  if (status >= 500 && status < 600) return 'server_error'
  return 'unexpected'
}

export const buildPixCheckoutTelemetryPayload = (
  event: PixCheckoutEvent,
): PixCheckoutTelemetryPayload => {
  const payload: PixCheckoutTelemetryPayload = {
    blockchain: event.context.blockchain,
    chainFamily: event.context.chainFamily,
    entryPoint: event.context.entryPoint,
    eventName: event.name,
    rail: 'PIX',
    schemaVersion: 1,
    sourceAsset: event.context.sourceAsset,
    targetCurrency: 'BRL',
    walletSurface: event.context.walletSurface,
  }

  if (event.name === 'gate_blocked') {
    payload.gate = event.gate
  }
  else if (event.name === 'submission_rejected') {
    payload.statusClass = event.statusClass
  }

  return payload
}

export const recordPixCheckoutEvent = (event: PixCheckoutEvent): void => {
  try {
    void sendPixCheckoutTelemetry(buildPixCheckoutTelemetryPayload(event))
      .catch(() => undefined)
  }
  catch {
    // Observability must never interrupt checkout.
  }
}

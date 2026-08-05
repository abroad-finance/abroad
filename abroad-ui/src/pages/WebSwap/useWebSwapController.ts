import { useTranslate } from '@tolgee/react'
import React, {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react'

import type { ApiClientResponse } from '../../api/customClient'
import type { ConfirmQrProps } from '../../features/swap/components/ConfirmQr'
import type { SwapProps } from '../../features/swap/components/Swap'
import type { IWallet, WalletConnectOptions } from '../../interfaces/IWallet'
import type { ApiFailure } from '../../services/http/types'
import type { PublicCorridor, QuoteResponse } from '../../services/public/types'
import type { WebSwapControllerProps } from './WebSwap'

import {
  decodeQrCodeBR,
  type DecodeQrCodeBR400,
  type decodeQrCodeBRResponse,
  _36EnumsTargetCurrency as TargetCurrency,
  type WalletConnectMetadata,
} from '../../api'
import { useNotices } from '../../contexts/NoticeContext'
import { BRL_BACKGROUND_IMAGE } from '../../features/swap/constants'
import { useOnrampPurchase } from '../../features/swap/hooks/useOnrampPurchase'
import { useStablecoinBalances } from '../../features/swap/hooks/useStablecoinBalances'
import {
  isSupportedStablecoinSymbol,
  parseStablecoinBalance,
} from '../../features/swap/lib/stablecoinPortfolio'
import {
  canRetryWalletAuthorization,
  destinationForCurrency,
  parsePaymentContextSnapshot,
  parseRestorablePaymentDraft,
  type PaymentDestination,
  type PendingWalletIntent,
  type RestorableAcceptedPayment,
  type RestorablePaymentDraft,
} from '../../features/swap/model/paymentIntent'
import {
  classifyQuoteFailure,
  isQuoteExpired,
  type QuoteIssue,
  type QuoteSnapshot,
} from '../../features/swap/model/quote'
import {
  classifyWalletConnectionFailure,
  type WalletConnectionIssue,
} from '../../features/swap/model/walletConnection'
import {
  authorizeAcceptedPayment,
  PaymentAuthorizationError,
} from '../../features/swap/services/paymentAuthorization'
import { QrInputError } from '../../features/swap/shared/QrInputError'
import {
  type KycFormValues, type KycSubmitOutcome, type OnboardingRates, type QrEntryMode, SwapView,
} from '../../features/swap/types'
import {
  buildChainLabel,
  chainKeyOf,
  corridorKeyOf,
  sortStellarFirst,
} from '../../features/swap/utils/corridorHelpers'
import { parseEMVQR } from '../../lib/qr/emv-parser'
import {
  bucketElapsedMilliseconds,
  type ConsumerUxChain,
  type ConsumerUxDimensions,
  type ConsumerUxEventName,
  type ConsumerUxMethod,
  getCheckoutTelemetrySessionKey,
  recordConsumerUxEvent,
  rotateCheckoutTelemetrySessionKey,
} from '../../observability/consumerUxTelemetry'
import {
  buildPixCheckoutTelemetryContext,
  classifyPixCheckoutStatus,
  recordPixCheckoutEvent,
  resolvePixCheckoutGate,
} from '../../observability/pixCheckoutTelemetry'
import { submitKyc } from '../../services/public/kycApi'
import {
  acceptTransactionRequest, fetchPublicCorridors, notifyPayment, requestQuote, requestReverseQuote,
} from '../../services/public/publicApi'
import { ASSET_URLS, PENDING_TX_KEY } from '../../shared/constants'
import { useWalletAuth } from '../../shared/hooks'
import { extractReason } from '../../shared/utils'
import {
  buildWalletUserId,
  resolveMiniPayNotice,
  resolvePreferredMiniPayCorridor,
  scopeCorridorsForWalletSurface,
} from './minipayPolicy'

type DecodeQrApiResponse = ApiClientResponse<decodeQrCodeBRResponse, DecodeQrCodeBR400>
const QUOTE_REQUEST_TIMEOUT_MS = 15_000
type SwapAction
  = | { acceptedPayment: null | RestorableAcceptedPayment, type: 'SET_ACCEPTED_PAYMENT' }
    | { accountNumber?: string, pixKey?: string, recipientName?: string, type: 'SET_BANK_DETAILS' }
    | { corridorKey: string, type: 'SET_CORRIDOR' }
    | { destination: null | PaymentDestination, type: 'SET_PENDING_DESTINATION' }
    | { destination: PaymentDestination, type: 'CHANGE_DESTINATION' }
    | { destination: PaymentDestination, type: 'SET_DESTINATION' }
    | { entryMode: QrEntryMode, type: 'OPEN_QR' }
    | { isDecodingQr: boolean, type: 'SET_DECODING' }
    | { isDesktop: boolean, type: 'SET_DESKTOP' }
    | { issue: null | QuoteIssue, type: 'SET_QUOTE_ISSUE' }
    | { loadingSource?: boolean, loadingTarget?: boolean, type: 'SET_LOADING' }
    | { loadingSubmit: boolean, type: 'SET_SUBMITTING' }
    | { payload: Partial<SwapControllerState>, type: 'HYDRATE' }
    | { qrCode: null | string, type: 'SET_QR_CODE' }
    | { quote?: null | QuoteSnapshot, sourceAmount?: string, targetAmount?: string, type: 'SET_AMOUNTS' }
    | { rates: OnboardingRates, type: 'SET_ONBOARDING_RATES' }
    | { transactionId: null | string, type: 'SET_TRANSACTION_ID' }
    | { type: 'CLOSE_QR' }
    | { type: 'RESET' }
    | { type: 'SET_VIEW', view: SwapView }

type SwapControllerState = {
  acceptedPayment: null | RestorableAcceptedPayment
  accountNumber: string
  corridorKey: string
  destination: PaymentDestination
  isDecodingQr: boolean
  isDesktop: boolean
  isQrOpen: boolean
  loadingSource: boolean
  loadingSubmit: boolean
  loadingTarget: boolean
  onboardingRates: OnboardingRates
  pendingDestination: null | PaymentDestination
  pixKey: string
  qrCode: null | string
  qrEntryMode: QrEntryMode
  quote: null | QuoteSnapshot
  quoteIssue: null | QuoteIssue
  recipientName: string
  sourceAmount: string
  targetAmount: string
  transactionId: null | string
  view: SwapView
}

/**
 * Parse target amount (BRL/COP).
 * - Comma present: locale format (1,00 = 1.00, 1.000,50 = 1000.50)
 * - Dot only: "5.000" = 5000 (thousands) or "1.00" = 1 (decimal, e.g. from QR)
 *   Use 3-digit segment after dot as thousands (es-CO); else decimal.
 */
const parseTargetAmount = (value: string): number => {
  const raw = value.replace(/[^0-9.,]/g, '')
  if (raw.includes(',')) {
    return Number.parseFloat(raw.replace(/\./g, '').replace(/,/g, '.'))
  }
  const dotCount = (raw.match(/\./g) || []).length
  if (dotCount === 0) return Number.parseFloat(raw) || 0
  if (dotCount >= 2) return Number.parseFloat(raw.replace(/\./g, ''))
  const [, fracPart] = raw.split('.')
  const frac = fracPart ?? ''
  if (frac.length === 3 && /^\d{3}$/.test(frac)) {
    return Number.parseFloat(raw.replace(/\./g, ''))
  }
  return Number.parseFloat(raw)
}

const createInitialState = (isDesktop: boolean): SwapControllerState => ({
  acceptedPayment: null,
  accountNumber: '',
  corridorKey: '',
  destination: destinationForCurrency('BRL'),
  isDecodingQr: false,
  isDesktop,
  isQrOpen: false,
  loadingSource: false,
  loadingSubmit: false,
  loadingTarget: false,
  onboardingRates: {
    brl: { USDC: null, USDT: null },
    cop: { USDC: null, USDT: null },
    updatedAt: null,
  },
  pendingDestination: null,
  pixKey: '',
  qrCode: null,
  qrEntryMode: 'camera',
  quote: null,
  quoteIssue: null,
  recipientName: '',
  sourceAmount: '',
  targetAmount: '',
  transactionId: null,
  view: 'home',
})

const reducer = (state: SwapControllerState, action: SwapAction): SwapControllerState => {
  switch (action.type) {
    case 'CHANGE_DESTINATION':
      // Quotes and recipient details are corridor-specific, but changing the
      // country must not eject the user from the active payment form.
      return {
        ...createInitialState(state.isDesktop),
        destination: action.destination,
        onboardingRates: state.onboardingRates,
        pendingDestination: null,
        view: state.view === 'home' ? 'home' : 'swap',
      }
    case 'CLOSE_QR':
      return { ...state, isQrOpen: false }
    case 'HYDRATE':
      return { ...state, ...action.payload }
    case 'OPEN_QR':
      return {
        ...state,
        isQrOpen: true,
        qrEntryMode: action.entryMode,
      }
    case 'RESET':
      return {
        ...createInitialState(state.isDesktop),
        destination: state.destination,
      }
    case 'SET_ACCEPTED_PAYMENT':
      return {
        ...state,
        acceptedPayment: action.acceptedPayment,
        transactionId: action.acceptedPayment?.authorization.transactionId ?? null,
      }
    case 'SET_AMOUNTS':
      return {
        ...state,
        quote: 'quote' in action ? action.quote ?? null : state.quote,
        sourceAmount: action.sourceAmount ?? state.sourceAmount,
        targetAmount: action.targetAmount ?? state.targetAmount,
      }
    case 'SET_BANK_DETAILS':
      return {
        ...state,
        accountNumber: action.accountNumber ?? state.accountNumber,
        pixKey: action.pixKey ?? state.pixKey,
        recipientName: action.recipientName ?? state.recipientName,
      }
    case 'SET_CORRIDOR':
      return { ...state, corridorKey: action.corridorKey }
    case 'SET_DECODING':
      return { ...state, isDecodingQr: action.isDecodingQr }
    case 'SET_DESKTOP':
      return { ...state, isDesktop: action.isDesktop }
    case 'SET_DESTINATION':
      return { ...state, destination: action.destination }
    case 'SET_LOADING':
      return {
        ...state,
        loadingSource: action.loadingSource ?? state.loadingSource,
        loadingTarget: action.loadingTarget ?? state.loadingTarget,
      }
    case 'SET_ONBOARDING_RATES':
      return { ...state, onboardingRates: action.rates }
    case 'SET_PENDING_DESTINATION':
      return { ...state, pendingDestination: action.destination }
    case 'SET_QR_CODE':
      return { ...state, qrCode: action.qrCode }
    case 'SET_QUOTE_ISSUE':
      return { ...state, quoteIssue: action.issue }
    case 'SET_SUBMITTING':
      return { ...state, loadingSubmit: action.loadingSubmit }
    case 'SET_TRANSACTION_ID':
      return { ...state, transactionId: action.transactionId }
    case 'SET_VIEW':
      return { ...state, view: action.view }
    default:
      return state
  }
}

const readPersisted = (): null | RestorablePaymentDraft => {
  try {
    const raw = sessionStorage.getItem(PENDING_TX_KEY)
    if (!raw) return null
    return parseRestorablePaymentDraft(JSON.parse(raw) as unknown)
  }
  catch {
    return null
  }
}

const persistState = (state: SwapControllerState) => {
  const payload: RestorablePaymentDraft = {
    acceptedPayment: state.acceptedPayment,
    corridorKey: state.corridorKey,
    destination: state.destination,
    quote: state.quote,
    schemaVersion: 4,
    sourceAmount: state.sourceAmount,
    targetAmount: state.targetAmount,
    view: state.view,
  }
  const hasData = Boolean(
    state.acceptedPayment
    || state.transactionId
    || state.quote
    || state.targetAmount
    || state.sourceAmount,
  )
  if (hasData) {
    sessionStorage.setItem(PENDING_TX_KEY, JSON.stringify(payload))
  }
  else {
    sessionStorage.removeItem(PENDING_TX_KEY)
  }
}

const clearPersistedPaymentDraft = (): void => {
  sessionStorage.removeItem(PENDING_TX_KEY)
  // Remove legacy drafts that may contain recipient identifiers.
  localStorage.removeItem(PENDING_TX_KEY)
}

const formatError = (message: string, description?: string) => ({
  description,
  kind: 'error' as const,
  message,
})

const parseLocalizedNumber = (value: string): number => {
  const raw = value.replace(/[^0-9.,]/g, '')
  // Dots as thousand separators: has comma (e.g. "1.000,50") or dot-separated groups of 3 (e.g. "7.280", "1.234.567")
  const dotsAreThousands = raw.includes(',') || /^\d{1,3}(\.\d{3})+$/.test(raw)
  const normalized = dotsAreThousands
    ? raw.replace(/\./g, '').replace(/,/g, '.')
    : raw
  return parseFloat(normalized)
}

const isAbortError = (result: { error?: { type?: string } }) => result.error?.type === 'aborted'

const walletConnectOptions = (
  wallet: { walletId: null | string },
  corridor: { chainId: string, walletConnect: WalletConnectMetadata },
): undefined | WalletConnectOptions =>
  wallet.walletId === 'wallet-connect'
    ? { chainId: corridor.chainId, walletConnect: corridor.walletConnect }
    : undefined

const normalizeTelemetryChain = (value: string): ConsumerUxChain => {
  switch (value.trim().toUpperCase()) {
    case 'CELO':
      return 'CELO'
    case 'POLYGON':
      return 'POLYGON'
    case 'SOLANA':
      return 'SOLANA'
    case 'STELLAR':
      return 'STELLAR'
    default:
      return 'OTHER'
  }
}

const normalizeTelemetryAsset = (value: string | undefined): 'OTHER' | 'USDC' | 'USDT' => {
  if (value === 'USDC' || value === 'USDT') return value
  return 'OTHER'
}

const normalizeTelemetryWallet = (
  value: null | string,
): 'browser' | 'minipay' | 'stellar' | 'unknown' | 'walletconnect' => {
  if (value === 'mini-pay') return 'minipay'
  if (value === 'wallet-connect' || value === 'solana') return 'walletconnect'
  if (value === 'stellar-kit' || value === 'sep24') return 'stellar'
  if (value) return 'browser'
  return 'unknown'
}

const telemetryDestination = (
  destination: PaymentDestination,
): 'BRAZIL_PIX_BRL' | 'COLOMBIA_BREB_COP' => (
  destination.country === 'BR' ? 'BRAZIL_PIX_BRL' : 'COLOMBIA_BREB_COP'
)

const telemetryRecipientKeyType = (
  value: string,
  fromQr: boolean,
): 'alphanumeric' | 'document' | 'email' | 'phone' | 'qr' | 'unknown' => {
  if (fromQr) return 'qr'
  const normalized = value.trim()
  if (!normalized) return 'unknown'
  if (normalized.includes('@')) return 'email'
  const digits = normalized.replace(/\D/g, '')
  if (digits.length === 11 && /^\d+$/.test(normalized)) return 'document'
  if (normalized.startsWith('+') || /^\d{7,15}$/.test(normalized)) return 'phone'
  return 'alphanumeric'
}

const handleQuoteError = (
  response: ApiFailure<unknown>,
  loadingKey: 'loadingSource' | 'loadingTarget',
  amountFields: { sourceAmount: string, targetAmount: string },
  dispatchFn: React.Dispatch<SwapAction>,
  setMinFlag: (v: boolean) => void,
): void => {
  if (!isAbortError(response)) {
    const issue = classifyQuoteFailure(response)
    setMinFlag(issue.code === 'minimum')
    dispatchFn({ quote: null, ...amountFields, type: 'SET_AMOUNTS' })
    dispatchFn({ issue, type: 'SET_QUOTE_ISSUE' })
  }
  dispatchFn({ [loadingKey]: false, type: 'SET_LOADING' })
}

const buildQuoteSnapshot = (params: {
  corridor: PublicCorridor
  quote: QuoteResponse
  sourceAmount: number
  targetAmount: number
}): null | QuoteSnapshot => {
  const {
    corridor,
    quote,
    sourceAmount,
    targetAmount,
  } = params
  const rail = corridor.paymentMethod === 'PIX'
    ? 'PIX'
    : corridor.paymentMethod === 'BREB'
      ? 'BREB'
      : null
  if (
    !rail
    || !isSupportedStablecoinSymbol(corridor.cryptoCurrency)
    || (corridor.targetCurrency !== 'BRL' && corridor.targetCurrency !== 'COP')
    || !quote.quote_id
    || !Number.isInteger(quote.expiration_time)
    || quote.expiration_time <= 0
    || !Number.isFinite(sourceAmount)
    || sourceAmount <= 0
    || !Number.isFinite(targetAmount)
    || targetAmount <= 0
  ) {
    return null
  }

  return {
    corridorKey: corridorKeyOf(corridor),
    expiresAt: quote.expiration_time,
    fee: quote.fee
      ? {
          amount: quote.fee.amount,
          currency: quote.fee.currency,
          type: quote.fee.type,
        }
      : null,
    id: quote.quote_id,
    network: corridor.blockchain,
    rail,
    sourceAmount,
    sourceCurrency: corridor.cryptoCurrency,
    targetAmount,
    targetCurrency: corridor.targetCurrency,
  }
}

export const useWebSwapController = (): WebSwapControllerProps => {
  const initialDesktop = typeof window !== 'undefined' ? window.innerWidth >= 768 : true
  const [state, dispatch] = useReducer(reducer, createInitialState(initialDesktop))
  const { t } = useTranslate()
  const { addNotice } = useNotices()
  const {
    defaultWallet,
    getWalletHandler,
    miniPay,
    setActiveWallet,
    wallet,
    walletAuthentication,
  } = useWalletAuth()
  // Capture the JWT value at mount time so HYDRATE only restores state on page reload
  // (existing session), not when the user freshly connects during the same session.
  const jwtOnMount = useRef(walletAuthentication?.jwtToken)

  const [corridors, setCorridors] = useState<PublicCorridor[]>([])
  const [corridorError, setCorridorError] = useState<null | string>(null)
  const [chainKey, setChainKey] = useState('')
  const [pendingConnectAfterSourceSelect, setPendingConnectAfterSourceSelect] = useState(false)

  const sep24TokenPresent = useMemo(() => {
    if (typeof window === 'undefined') return false
    return new URLSearchParams(window.location.search).has('token')
  }, [])

  const lastEditedRef = useRef<'source' | 'target' | null>(null)
  const lastQuoteRateRef = useRef<null | number>(null)
  const sep24AutoSelectedRef = useRef(false)
  const directAbortRef = useRef<AbortController | null>(null)
  const reverseAbortRef = useRef<AbortController | null>(null)
  const directReqIdRef = useRef(0)
  const reverseReqIdRef = useRef(0)
  const decodeAbortRef = useRef<AbortController | null>(null)
  const miniPayManualAssetSelectionRef = useRef(false)
  const pendingWalletIntentRef = useRef<null | PendingWalletIntent>(null)
  const checkoutTelemetrySessionKeyRef = useRef(getCheckoutTelemetrySessionKey())
  const checkoutStartedAtRef = useRef(Date.now())
  const lastDestinationSelectionAtRef = useRef<null | number>(null)
  const lastPixGateTelemetryRef = useRef<null | string>(null)
  const lastPixQuoteTelemetryRef = useRef<null | string>(null)
  const previousTelemetryViewRef = useRef<SwapView>(state.view)
  const selectedRecipientMethodRef = useRef<ConsumerUxMethod | null>(null)
  const kycResumeInFlightRef = useRef(false)
  const [quoteBelowMinimum, setQuoteBelowMinimum] = useState(false)
  const [quoteClock, setQuoteClock] = useState(() => Date.now())
  const [walletConnectionIssue, setWalletConnectionIssue] = useState<null | WalletConnectionIssue>(null)
  const [walletConnectionInProgress, setWalletConnectionInProgress] = useState(false)
  const walletConnectionAttemptRef = useRef(0)

  const recordCheckoutEvent = useCallback((
    name: ConsumerUxEventName,
    dimensions: ConsumerUxDimensions = {},
    onceKey?: string,
  ): void => {
    const sessionKey = checkoutTelemetrySessionKeyRef.current
    if (!sessionKey) return
    recordConsumerUxEvent({
      dimensions: {
        elapsed_bucket: bucketElapsedMilliseconds(Date.now() - checkoutStartedAtRef.current),
        ...dimensions,
      },
      name,
      session: { key: sessionKey, kind: 'checkout' },
    }, { onceKey })
  }, [])

  useEffect(() => {
    const sessionKey = checkoutTelemetrySessionKeyRef.current
    if (!sessionKey) return
    recordCheckoutEvent('destination_control_viewed', {
      initial_destination: telemetryDestination(state.destination),
      source_surface: 'journey',
      step: 'destination',
    }, `${sessionKey}:destination-control:${state.destination.country}`)
  }, [recordCheckoutEvent, state.destination])
  const stablecoinBalances = useStablecoinBalances({
    address: wallet?.address,
    chainId: wallet?.chainId,
  })
  const isMiniPay = miniPay.isActive

  useEffect(() => {
    if (!state.quote) return
    setQuoteClock(Date.now())
    const timer = window.setInterval(() => setQuoteClock(Date.now()), 1_000)
    return () => window.clearInterval(timer)
  }, [state.quote])

  // Fetch onboarding rates when corridors are loaded
  const fetchOnboardingRates = useCallback(async (
    availableCorridors: PublicCorridor[],
    signal: AbortSignal,
  ): Promise<OnboardingRates> => {
    const rates: OnboardingRates = {
      brl: { USDC: null, USDT: null },
      cop: { USDC: null, USDT: null },
      updatedAt: null,
    }

    const fetchRate = async (corridor: PublicCorridor): Promise<null | number> => {
      try {
        // Use a larger amount to avoid minimum amount errors
        // 10 USDC/USDT should be above minimum for all corridors
        const testAmount = 10
        const response = await requestReverseQuote({
          crypto_currency: corridor.cryptoCurrency,
          network: corridor.blockchain,
          payment_method: corridor.paymentMethod,
          source_amount: testAmount,
          target_currency: corridor.targetCurrency,
        }, { signal })
        if (response.ok && response.data) {
          // Calculate rate per 1 unit
          return response.data.value / testAmount
        }
        return null
      }
      catch {
        return null
      }
    }

    // Find corridors for each token/currency combination
    const usdcCopCorridor = availableCorridors.find(
      c => c.cryptoCurrency === 'USDC' && c.targetCurrency === TargetCurrency.COP,
    )
    const usdtCopCorridor = availableCorridors.find(
      c => c.cryptoCurrency === 'USDT' && c.targetCurrency === TargetCurrency.COP,
    )
    const usdcBrlCorridor = availableCorridors.find(
      c => c.cryptoCurrency === 'USDC' && c.targetCurrency === TargetCurrency.BRL,
    )
    const usdtBrlCorridor = availableCorridors.find(
      c => c.cryptoCurrency === 'USDT' && c.targetCurrency === TargetCurrency.BRL,
    )

    // Fetch rates in parallel
    const [
      copUsdc,
      copUsdt,
      brlUsdc,
      brlUsdt,
    ] = await Promise.all([
      usdcCopCorridor ? fetchRate(usdcCopCorridor) : Promise.resolve(null),
      usdtCopCorridor ? fetchRate(usdtCopCorridor) : Promise.resolve(null),
      usdcBrlCorridor ? fetchRate(usdcBrlCorridor) : Promise.resolve(null),
      usdtBrlCorridor ? fetchRate(usdtBrlCorridor) : Promise.resolve(null),
    ])

    rates.cop.USDC = copUsdc
    rates.cop.USDT = copUsdt
    rates.brl.USDC = brlUsdc
    rates.brl.USDT = brlUsdt
    rates.updatedAt = [
      copUsdc,
      copUsdt,
      brlUsdc,
      brlUsdt,
    ].some(rate => rate !== null)
      ? new Date().toISOString()
      : null

    return rates
  }, [])

  useEffect(() => {
    let active = true
    const controller = new AbortController()
    fetchPublicCorridors()
      .then(async (data) => {
        if (!active) return
        setCorridors(data.corridors)
        setCorridorError(null)
        const rates = await fetchOnboardingRates(data.corridors, controller.signal)
        if (active) dispatch({ rates, type: 'SET_ONBOARDING_RATES' })
      })
      .catch((err) => {
        if (!active) return
        const message = err instanceof Error ? err.message : 'Failed to load corridors'
        setCorridorError(message)
      })
    return () => {
      active = false
      controller.abort()
    }
  }, [fetchOnboardingRates])

  const targetLocale = useMemo(
    () => (state.destination.currency === TargetCurrency.BRL ? 'pt-BR' : 'es-CO'),
    [state.destination.currency],
  )
  const scopedCorridors = useMemo(() => scopeCorridorsForWalletSurface({
    corridors,
    isMiniPay,
  }), [corridors, isMiniPay])
  const availableCorridors = useMemo(() => {
    const filtered = scopedCorridors.filter(corridor => corridor.targetCurrency === state.destination.currency)
    return isMiniPay ? filtered : sortStellarFirst(filtered)
  }, [
    isMiniPay,
    scopedCorridors,
    state.destination.currency,
  ])
  const selectedCorridor = useMemo(() => {
    const match = availableCorridors.find(corridor => corridorKeyOf(corridor) === state.corridorKey)
    if (match && (!chainKey || chainKeyOf(match) === chainKey)) return match
    if (chainKey) {
      return availableCorridors.find(corridor => chainKeyOf(corridor) === chainKey) ?? null
    }
    return availableCorridors[0] ?? null
  }, [
    availableCorridors,
    chainKey,
    state.corridorKey,
  ])
  const activeChainKey = useMemo(() => (
    chainKey || (selectedCorridor ? chainKeyOf(selectedCorridor) : '')
  ), [chainKey, selectedCorridor])
  const chainFilteredCorridors = useMemo(() => {
    if (!activeChainKey) return availableCorridors
    return availableCorridors.filter(corridor => chainKeyOf(corridor) === activeChainKey)
  }, [activeChainKey, availableCorridors])
  const chainVariants = useMemo(() => {
    const map = new Map<string, Set<string>>()
    scopedCorridors.forEach((corridor) => {
      const current = map.get(corridor.blockchain) ?? new Set<string>()
      current.add(corridor.chainId)
      map.set(corridor.blockchain, current)
    })
    return map
  }, [scopedCorridors])
  const chainOptions = useMemo(() => {
    const seen = new Map<string, PublicCorridor>()
    scopedCorridors.forEach((corridor) => {
      const key = chainKeyOf(corridor)
      if (!seen.has(key)) seen.set(key, corridor)
    })
    const entries = Array.from(seen.entries()).map(([key, corridor]) => {
      const includeChainId = (chainVariants.get(corridor.blockchain)?.size ?? 0) > 1
      return { key, label: buildChainLabel(corridor, includeChainId) }
    })
    return entries.sort((a, b) => {
      const corridorA = seen.get(a.key)
      const corridorB = seen.get(b.key)
      const aStellar = corridorA?.blockchain.toLowerCase() === 'stellar'
      const bStellar = corridorB?.blockchain.toLowerCase() === 'stellar'
      if (aStellar && !bStellar) return -1
      if (!aStellar && bStellar) return 1
      return 0
    })
  }, [chainVariants, scopedCorridors])
  const walletSourceOptions = useMemo(() => availableCorridors.map(corridor => ({
    chainKey: chainKeyOf(corridor),
    chainLabel: buildChainLabel(
      corridor,
      (chainVariants.get(corridor.blockchain)?.size ?? 0) > 1,
    ),
    key: corridorKeyOf(corridor),
    sourceAsset: corridor.cryptoCurrency,
    walletLabel: corridor.chainFamily === 'stellar'
      ? t('connect_wallet.stellar_wallets', 'Stellar-compatible wallets')
      : t('connect_wallet.walletconnect_wallets', 'WalletConnect-compatible wallets'),
  })), [
    availableCorridors,
    chainVariants,
    t,
  ])
  const assetOptions = useMemo(() => chainFilteredCorridors.map(corridor => ({
    key: corridorKeyOf(corridor),
    label: corridor.cryptoCurrency,
  })), [chainFilteredCorridors])
  const selectedAssetLabel = useMemo(() => {
    if (!selectedCorridor) return t('swap.asset_placeholder', 'Select asset')
    return selectedCorridor.cryptoCurrency
  }, [selectedCorridor, t])
  const selectedSourceBalance = useMemo(() => {
    if (!selectedCorridor || !isSupportedStablecoinSymbol(selectedCorridor.cryptoCurrency)) {
      return null
    }

    return stablecoinBalances.supportedBalanceFor(selectedCorridor.cryptoCurrency)
  }, [selectedCorridor, stablecoinBalances])
  const hasInsufficientFunds = useMemo(() => {
    if (selectedSourceBalance === null) {
      return false
    }
    const requestedAmount = parseStablecoinBalance(state.sourceAmount)
    if (requestedAmount <= 0) {
      return false
    }
    return requestedAmount > parseStablecoinBalance(selectedSourceBalance)
  }, [selectedSourceBalance, state.sourceAmount])
  const miniPayNotice = useMemo(() => resolveMiniPayNotice({
    copy: {
      addCashLabel: t('swap.minipay.add_cash', 'Add Cash'),
      cUsdDescription: t(
        'swap.minipay.cusd_notice',
        'MiniPay is ready, but Abroad currently works with USDC and USDT. If your main balance is cUSD, switch to a supported stablecoin or add cash in MiniPay.',
      ),
      cUsdTitle: t('swap.minipay.cusd_title', 'Use USDC or USDT'),
      lowBalanceDescription: t(
        'swap.minipay.low_balance_notice',
        'This payment needs more supported stablecoin than you have available in MiniPay.',
      ),
      lowBalanceTitle: t('swap.minipay.low_balance_title', 'Low balance'),
    },
    hasInsufficientFunds,
    isMiniPay,
    preference: stablecoinBalances.preference,
  }), [
    hasInsufficientFunds,
    isMiniPay,
    stablecoinBalances.preference,
    t,
  ])

  useEffect(() => {
    if (!selectedCorridor) return
    const key = corridorKeyOf(selectedCorridor)
    if (state.corridorKey !== key) {
      dispatch({ corridorKey: key, type: 'SET_CORRIDOR' })
    }
    const chain = chainKeyOf(selectedCorridor)
    if (chainKey !== chain) {
      setChainKey(chain)
    }
  }, [
    chainKey,
    selectedCorridor,
    state.corridorKey,
  ])

  const attemptWalletConnection = useCallback(async (
    candidate: IWallet,
    corridor: PublicCorridor,
  ): Promise<boolean> => {
    const attemptId = ++walletConnectionAttemptRef.current
    setWalletConnectionIssue(null)
    setWalletConnectionInProgress(true)
    let timeoutId: number | undefined
    const timeout = new Promise<{ kind: 'timeout' }>((resolve) => {
      timeoutId = window.setTimeout(() => resolve({ kind: 'timeout' }), 30_000)
    })
    const connection = candidate.connect(walletConnectOptions(candidate, corridor))
      .then(() => ({ kind: 'connected' as const }))
      .catch((error: unknown) => ({ error, kind: 'failed' as const }))
    const result = await Promise.race([connection, timeout])
    if (timeoutId !== undefined) window.clearTimeout(timeoutId)
    if (attemptId !== walletConnectionAttemptRef.current) return false
    setWalletConnectionInProgress(false)

    if (result.kind === 'connected') {
      setWalletConnectionIssue(null)
      recordCheckoutEvent('wallet_connect_outcome', {
        chain: normalizeTelemetryChain(corridor.blockchain),
        outcome: 'success',
        source_asset: normalizeTelemetryAsset(corridor.cryptoCurrency),
        trigger_location: 'flow',
        wallet_category: normalizeTelemetryWallet(candidate.walletId),
      })
      return true
    }
    const issue = result.kind === 'timeout'
      ? { code: 'timeout' as const, retryable: true }
      : classifyWalletConnectionFailure(result.error)
    setWalletConnectionIssue(issue)
    recordCheckoutEvent('wallet_connect_outcome', {
      chain: normalizeTelemetryChain(corridor.blockchain),
      outcome: issue.code === 'rejected'
        ? 'rejected'
        : issue.code === 'timeout'
          ? 'timeout'
          : issue.code === 'unsupported-network' || issue.code === 'unsupported-wallet'
            ? 'unsupported'
            : 'failed',
      source_asset: normalizeTelemetryAsset(corridor.cryptoCurrency),
      trigger_location: 'flow',
      wallet_category: normalizeTelemetryWallet(candidate.walletId),
    })
    return false
  }, [recordCheckoutEvent])

  useEffect(() => {
    if (sep24AutoSelectedRef.current) return
    if (!sep24TokenPresent) return
    const stellarCorridor = corridors.find(corridor => corridor.chainFamily === 'stellar')
    if (!stellarCorridor) return

    sep24AutoSelectedRef.current = true

    const nextChainKey = chainKeyOf(stellarCorridor)
    const nextCorridorKey = corridorKeyOf(stellarCorridor)

    if (state.destination.currency !== stellarCorridor.targetCurrency) {
      dispatch({ destination: destinationForCurrency(stellarCorridor.targetCurrency), type: 'SET_DESTINATION' })
    }
    if (chainKey !== nextChainKey) {
      setChainKey(nextChainKey)
    }
    if (state.corridorKey !== nextCorridorKey) {
      dispatch({ corridorKey: nextCorridorKey, type: 'SET_CORRIDOR' })
      dispatch({
        quote: null, sourceAmount: '', targetAmount: '', type: 'SET_AMOUNTS',
      })
    }
  }, [
    chainKey,
    corridors,
    sep24TokenPresent,
    state.corridorKey,
    state.destination.currency,
  ])

  useEffect(() => {
    if (!isMiniPay) return
    if (miniPayManualAssetSelectionRef.current) return
    const preferredCorridor = resolvePreferredMiniPayCorridor({
      availableCorridors,
      preference: stablecoinBalances.preference,
    })
    if (!preferredCorridor) return

    const preferredCorridorKey = corridorKeyOf(preferredCorridor)
    const preferredChainKey = chainKeyOf(preferredCorridor)
    if (state.corridorKey !== preferredCorridorKey) {
      dispatch({ corridorKey: preferredCorridorKey, type: 'SET_CORRIDOR' })
    }
    if (chainKey !== preferredChainKey) {
      setChainKey(preferredChainKey)
    }
  }, [
    availableCorridors,
    chainKey,
    isMiniPay,
    stablecoinBalances.preference,
    state.corridorKey,
  ])

  useEffect(() => {
    if (!selectedCorridor || !getWalletHandler || !setActiveWallet) return
    const nextWallet = isMiniPay
      ? defaultWallet
      : selectedCorridor.chainFamily === 'stellar'
        ? defaultWallet
        : getWalletHandler('wallet-connect')
    if (!nextWallet) return
    if (nextWallet !== wallet) setActiveWallet(nextWallet)
    // The source/network confirmation is applied before opening the matching wallet.
    // (do it here so we use nextWallet, not the possibly stale wallet from context)
    if (pendingConnectAfterSourceSelect) {
      setPendingConnectAfterSourceSelect(false)
      void attemptWalletConnection(nextWallet, selectedCorridor)
    }
  }, [
    defaultWallet,
    attemptWalletConnection,
    getWalletHandler,
    isMiniPay,
    pendingConnectAfterSourceSelect,
    selectedCorridor,
    setActiveWallet,
    wallet,
  ])

  const targetPaymentMethod = selectedCorridor?.paymentMethod ?? 'BREB'

  const formatTargetNumber = useCallback((value: number) => {
    const isBRL = state.destination.currency === TargetCurrency.BRL
    return new Intl.NumberFormat(targetLocale, {
      maximumFractionDigits: isBRL ? 2 : 0,
      minimumFractionDigits: isBRL ? 2 : 0,
    }).format(value)
  }, [targetLocale, state.destination.currency])

  const formatCryptoAmount = useCallback((value: number) => {
    if (!Number.isFinite(value)) return ''
    return new Intl.NumberFormat('en-US', {
      maximumFractionDigits: 8,
      minimumFractionDigits: 0,
      useGrouping: false,
    }).format(value)
  }, [])

  const notifyError = useCallback((message: string, description?: string) => {
    addNotice(formatError(message, description))
  }, [addNotice])

  useEffect(() => {
    if (!corridorError) return
    notifyError(t('swap.corridor_load_error', 'We could not load the available assets.'))
  }, [
    corridorError,
    notifyError,
    t,
  ])

  const exchangeRateDisplay = useMemo(() => {
    const tc = state.destination.currency === TargetCurrency.BRL ? 'BRL' : 'COP'
    if (state.loadingSource || state.loadingTarget) {
      return `1 ${selectedAssetLabel} = - ${tc}`
    }
    if (state.quote) {
      // sourceAmount is what the customer pays, so it already contains the
      // customer fee. Dividing by it folds the fee into the rate and makes it
      // look far worse than the rate actually quoted, so net the fee off:
      // sourceAmount - fee == baseRate * targetAmount by construction.
      const feeAmount = Number(state.quote.fee?.amount ?? 0)
      const baseSource = Number.isFinite(feeAmount)
        ? state.quote.sourceAmount - feeAmount
        : state.quote.sourceAmount
      const divisor = baseSource > 0 ? baseSource : state.quote.sourceAmount
      const rate = state.quote.targetAmount / divisor
      return `1 ${selectedAssetLabel} = ${formatTargetNumber(rate)} ${tc}`
    }
    return `1 ${selectedAssetLabel} = - ${tc}`
  }, [
    formatTargetNumber,
    selectedAssetLabel,
    state.loadingSource,
    state.loadingTarget,
    state.quote,
    state.destination.currency,
  ])

  const formatMoney = useCallback((value: number | string, currency: 'BRL' | 'COP' | 'USDC' | 'USDT'): string => {
    const numericValue = Number(value)
    if (currency === 'USDC' || currency === 'USDT') {
      return `${new Intl.NumberFormat('en-US', {
        maximumFractionDigits: 6,
        minimumFractionDigits: 2,
      }).format(numericValue)} ${currency}`
    }
    return new Intl.NumberFormat(currency === 'BRL' ? 'pt-BR' : 'es-CO', {
      currency,
      currencyDisplay: 'symbol',
      maximumFractionDigits: currency === 'COP' ? 0 : 2,
      minimumFractionDigits: currency === 'COP' ? 0 : 2,
      style: 'currency',
    }).format(numericValue)
  }, [])

  const feeDisplay = state.quote?.fee
    ? `${formatMoney(state.quote.fee.amount, state.quote.fee.currency)} · ${state.quote.fee.type === 'combined'
      ? t('swap.fee_type.combined', 'Combined fee')
      : state.quote.fee.type === 'fixed'
        ? t('swap.fee_type.fixed', 'Fixed fee')
        : state.quote.fee.type === 'percentage'
          ? t('swap.fee_type.percentage', 'Percentage fee')
          : t('swap.fee_type.none', 'No fee')}`
    : null
  const minimumAmountDisplay = selectedCorridor?.minAmount === null || selectedCorridor?.minAmount === undefined
    ? null
    : formatMoney(selectedCorridor.minAmount, state.destination.currency)
  const maximumAmountDisplay = selectedCorridor?.maxAmount === null || selectedCorridor?.maxAmount === undefined
    ? null
    : formatMoney(selectedCorridor.maxAmount, state.destination.currency)
  const quoteRemainingSeconds = state.quote
    ? Math.max(0, Math.ceil((state.quote.expiresAt - quoteClock) / 1_000))
    : null

  const isWalletConnected = Boolean(wallet?.address && wallet?.chainId && (isMiniPay || walletAuthentication?.jwtToken))
  const isAuthenticated = isWalletConnected
  const resolvedChainId = wallet?.chainId ?? selectedCorridor?.chainId ?? null
  const walletUserId = buildWalletUserId(resolvedChainId, wallet?.address ?? null)

  // A PIX onramp is its own short journey: price, accept, then show the code.
  // It shares the wallet and corridor context but none of the payout state, so
  // it lives beside the reducer rather than inside it.
  const onramp = useOnrampPurchase()

  const startBuyCrypto = useCallback(() => {
    onramp.reset()
    dispatch({ type: 'SET_VIEW', view: 'buy-crypto' })
  }, [onramp])

  const cancelBuyCrypto = useCallback(() => {
    onramp.reset()
    dispatch({ type: 'SET_VIEW', view: 'home' })
  }, [onramp])

  const submitBuyCrypto = useCallback(async (values: {
    fiatAmount: number
    taxId: string
  }) => {
    const destinationAddress = wallet?.address ?? null
    const corridor = selectedCorridor
    if (!destinationAddress || !walletUserId || !corridor) return

    await onramp.startPurchase({
      cryptoCurrency: corridor.cryptoCurrency === 'USDT' ? 'USDT' : 'USDC',
      destinationAddress,
      fiatAmount: values.fiatAmount,
      network: corridor.blockchain,
      taxId: values.taxId,
      userId: walletUserId,
    })
  }, [
    onramp,
    selectedCorridor,
    wallet?.address,
    walletUserId,
  ])

  // The code screen is reached only once there is something payable to show;
  // a KYC requirement routes to verification instead, matching the payout flow.
  useEffect(() => {
    if (onramp.state.instructions) {
      dispatch({ type: 'SET_VIEW', view: 'buy-crypto-pix' })
      return
    }
    if (onramp.state.kycRequired) {
      dispatch({ type: 'SET_VIEW', view: 'kyc-needed' })
    }
  }, [onramp.state.instructions, onramp.state.kycRequired])
  const hasKycRecipientData = state.destination.currency === TargetCurrency.BRL
    ? Boolean(state.pixKey.trim() || state.qrCode)
    : Boolean(state.accountNumber.trim() || state.qrCode)
  const kycCanResumePayment = Boolean(
    hasKycRecipientData
    && state.view === 'kyc-needed'
    && !state.acceptedPayment
    && selectedCorridor
    && state.quote
    && !isQuoteExpired(state.quote)
    && walletUserId,
  )

  const connectWallet = useCallback(async (): Promise<boolean> => {
    if (!wallet) {
      setWalletConnectionIssue({ code: 'unsupported-wallet', retryable: false })
      recordCheckoutEvent('wallet_connect_outcome', {
        outcome: 'unsupported',
        trigger_location: 'flow',
        wallet_category: 'unknown',
      })
      return false
    }
    if (!selectedCorridor) {
      setWalletConnectionIssue({ code: 'unsupported-network', retryable: false })
      recordCheckoutEvent('wallet_connect_outcome', {
        outcome: 'unsupported',
        trigger_location: 'flow',
        wallet_category: normalizeTelemetryWallet(wallet.walletId),
      })
      return false
    }
    if (isWalletConnected && !isMiniPay) return true
    return attemptWalletConnection(wallet, selectedCorridor)
  }, [
    attemptWalletConnection,
    isMiniPay,
    isWalletConnected,
    recordCheckoutEvent,
    selectedCorridor,
    wallet,
  ])

  const clearWalletConnectionIssue = useCallback((): void => {
    pendingWalletIntentRef.current = null
    setWalletConnectionIssue(null)
  }, [])

  const onDisconnectWallet = useCallback(async (): Promise<void> => {
    if (!wallet) return
    await wallet.disconnect()
  }, [wallet])

  const retryWalletConnection = useCallback((): void => {
    void connectWallet()
  }, [connectWallet])

  const requestConnectAfterSourceSelect = useCallback(() => {
    setPendingConnectAfterSourceSelect(true)
  }, [])

  useEffect(() => {
    if (!wallet?.address || !wallet?.chainId || !selectedCorridor) return
    if (wallet.chainId === selectedCorridor.chainId) return
    if (isMiniPay) return
    // Silently try to restore a saved session for the new chain.
    // If no session exists, disconnect so the UI reflects the need to reconnect.
    if (wallet.walletId === 'wallet-connect' && selectedCorridor.walletConnect) {
      void attemptWalletConnection(wallet, selectedCorridor).then(async (connected) => {
        if (connected) return
        try {
          await wallet.disconnect()
        }
        catch (error) {
          setWalletConnectionIssue(classifyWalletConnectionFailure(error))
        }
      })
    }
  }, [
    attemptWalletConnection,
    isMiniPay,
    selectedCorridor,
    wallet,
  ])

  const isBelowMinimum = useMemo(() => {
    if (quoteBelowMinimum) return true
    if (!selectedCorridor) return false
    const min = selectedCorridor.minAmount
      || (selectedCorridor.targetCurrency === 'BRL' ? 1 : 0)
    if (!min) return false
    const numericTarget = parseLocalizedNumber(String(state.targetAmount))
    if (Number.isNaN(numericTarget) || numericTarget <= 0) return false
    return numericTarget < min
  }, [
    quoteBelowMinimum,
    selectedCorridor,
    state.targetAmount,
  ])

  const isAboveMaximum = useMemo(() => {
    if (!selectedCorridor) return false
    const max = selectedCorridor.maxAmount || 0
    if (!max) return false
    const numericTarget = parseLocalizedNumber(String(state.targetAmount))
    if (Number.isNaN(numericTarget) || numericTarget <= 0) return false
    return numericTarget > max
  }, [selectedCorridor, state.targetAmount])

  const isPrimaryDisabled = useCallback(() => {
    const numericSource = parseFloat(String(state.sourceAmount))
    const numericTarget = parseLocalizedNumber(String(state.targetAmount))
    return !(numericSource > 0 && numericTarget > 0)
  }, [state.sourceAmount, state.targetAmount])

  const quoteExpired = state.quote ? isQuoteExpired(state.quote, quoteClock) : false

  const continueDisabled = useMemo(() => {
    if (isMiniPay && !miniPay.isReady) {
      return true
    }
    if (!isAuthenticated) return false
    const baseDisabled = isPrimaryDisabled()
      || !state.quote
      || quoteExpired
      || isBelowMinimum
      || isAboveMaximum
      || state.quoteIssue !== null
    if (state.destination.currency === TargetCurrency.BRL) {
      return baseDisabled || (!state.pixKey.trim() && !state.qrCode)
    }
    if (state.destination.currency === TargetCurrency.COP) {
      return baseDisabled || state.accountNumber.trim().length < 6
    }
    return baseDisabled
  }, [
    isAboveMaximum,
    isAuthenticated,
    isBelowMinimum,
    isPrimaryDisabled,
    isMiniPay,
    miniPay.isReady,
    quoteExpired,
    state.accountNumber,
    state.pixKey,
    state.qrCode,
    state.quote,
    state.quoteIssue,
    state.destination.currency,
  ])

  const pixCheckoutTelemetryContext = useMemo(() => {
    if (
      state.destination.currency !== TargetCurrency.BRL
      || selectedCorridor?.paymentMethod !== 'PIX'
    ) {
      return null
    }

    return buildPixCheckoutTelemetryContext({
      blockchain: selectedCorridor.blockchain,
      chainFamily: selectedCorridor.chainFamily,
      cryptoCurrency: selectedCorridor.cryptoCurrency,
      entryPoint: state.qrCode ? 'qr' : 'manual',
      walletSurface: isMiniPay ? 'minipay' : 'web',
    })
  }, [
    isMiniPay,
    selectedCorridor,
    state.qrCode,
    state.destination.currency,
  ])

  const hasPixCheckoutIntent = Boolean(
    state.pixKey
    || state.qrCode
    || state.quote
    || state.sourceAmount
    || state.targetAmount,
  )

  const pixCheckoutGate = useMemo(() => resolvePixCheckoutGate({
    authenticated: isAuthenticated,
    balanceLoading: stablecoinBalances.isLoading,
    hasAmounts: !isPrimaryDisabled(),
    hasPixKey: Boolean(state.pixKey.trim() || state.qrCode),
    hasQuote: Boolean(state.quote),
    insufficientBalance: hasInsufficientFunds,
    isAboveMaximum,
    isBelowMinimum,
    isMiniPay,
    isMiniPayReady: miniPay.isReady,
    quoteLoading: state.loadingSource || state.loadingTarget,
  }), [
    hasInsufficientFunds,
    isAboveMaximum,
    isAuthenticated,
    isBelowMinimum,
    isMiniPay,
    isPrimaryDisabled,
    miniPay.isReady,
    stablecoinBalances.isLoading,
    state.loadingSource,
    state.loadingTarget,
    state.pixKey,
    state.qrCode,
    state.quote,
  ])

  useEffect(() => {
    if (!pixCheckoutTelemetryContext || !state.quote) {
      if (!state.quote) {
        lastPixQuoteTelemetryRef.current = null
      }
      return
    }

    const quoteTelemetryKey = [
      pixCheckoutTelemetryContext.blockchain,
      pixCheckoutTelemetryContext.sourceAsset,
      state.quote.id,
    ].join(':')
    if (lastPixQuoteTelemetryRef.current === quoteTelemetryKey) return

    lastPixQuoteTelemetryRef.current = quoteTelemetryKey
    recordPixCheckoutEvent({
      context: pixCheckoutTelemetryContext,
      name: 'quote_ready',
    })
  }, [pixCheckoutTelemetryContext, state.quote])

  useEffect(() => {
    if (!pixCheckoutTelemetryContext || !hasPixCheckoutIntent) {
      lastPixGateTelemetryRef.current = null
      return
    }

    const gateState = pixCheckoutGate ?? 'ready'
    const gateTelemetryKey = [
      pixCheckoutTelemetryContext.blockchain,
      pixCheckoutTelemetryContext.sourceAsset,
      pixCheckoutTelemetryContext.entryPoint,
      gateState,
    ].join(':')
    if (lastPixGateTelemetryRef.current === gateTelemetryKey) return

    lastPixGateTelemetryRef.current = gateTelemetryKey
    recordPixCheckoutEvent(pixCheckoutGate
      ? {
          context: pixCheckoutTelemetryContext,
          gate: pixCheckoutGate,
          name: 'gate_blocked',
        }
      : {
          context: pixCheckoutTelemetryContext,
          name: 'checkout_ready',
        })
  }, [
    hasPixCheckoutIntent,
    pixCheckoutGate,
    pixCheckoutTelemetryContext,
  ])

  useEffect(() => {
    const previousView = previousTelemetryViewRef.current
    previousTelemetryViewRef.current = state.view

    if (
      pixCheckoutTelemetryContext
      && state.view === 'confirm-qr'
      && previousView !== 'confirm-qr'
    ) {
      recordPixCheckoutEvent({
        context: pixCheckoutTelemetryContext,
        name: 'confirmation_viewed',
      })
    }
  }, [pixCheckoutTelemetryContext, state.view])

  const sourceAmountForBalanceCheck = useMemo(() => {
    if (state.sourceAmount) return state.sourceAmount
    if (!state.loadingSource || !state.targetAmount || lastQuoteRateRef.current == null) return ''
    const numericTarget = parseTargetAmount(state.targetAmount)
    if (numericTarget <= 0) return ''
    const estimated = numericTarget / lastQuoteRateRef.current
    return String(estimated)
  }, [
    state.loadingSource,
    state.sourceAmount,
    state.targetAmount,
  ])

  const persistableView = state.view !== 'swap'

  useEffect(() => {
    if (!persistableView) {
      clearPersistedPaymentDraft()
      return
    }
    persistState(state)
  }, [persistableView, state])

  useEffect(() => {
    // Only restore persisted state when the user already had a JWT on mount (page reload
    // with an existing session). Skip restoration when jwtToken transitions from null →
    // non-null during the same session (fresh wallet connect) so the user lands on the
    // authenticated HomeScreen instead of a previously stored payment view.
    if (!jwtOnMount.current) return

    const stored = readPersisted()
    if (stored && (isMiniPay || walletAuthentication?.jwtToken)) {
      const restoredAcceptedPayment = stored.acceptedPayment?.authorization.kind === 'authorizing'
        ? {
            ...stored.acceptedPayment,
            authorization: {
              kind: 'broadcast-unknown' as const,
              transactionId: stored.acceptedPayment.authorization.transactionId,
            },
          }
        : stored.acceptedPayment
      // Once a transaction is accepted, restoration must reconcile that exact
      // ID instead of recreating the request or replaying a wallet mutation.
      const restoredView = restoredAcceptedPayment
        ? 'txStatus'
        : stored.view === 'wait-sign'
          ? 'home'
          : stored.view === 'kyc-needed'
            ? 'swap'
            : stored.view
      dispatch({
        payload: {
          acceptedPayment: restoredAcceptedPayment,
          corridorKey: stored.corridorKey ?? '',
          destination: stored.destination,
          quote: stored.quote && !isQuoteExpired(stored.quote) ? stored.quote : null,
          sourceAmount: stored.sourceAmount ?? '',
          targetAmount: stored.targetAmount ?? '',
          transactionId: restoredAcceptedPayment?.authorization.transactionId ?? null,
          view: restoredView,
        },
        type: 'HYDRATE',
      })
    }
  }, [isMiniPay, walletAuthentication?.jwtToken])

  // When the user first becomes authenticated, ensure they see the authenticated home screen
  // (dashboard with balance, scan QR, enter amount) instead of swap view with pre-filled data.
  // BUT: Skip this if there's a pending action (user is connecting to complete a payment)
  const prevIsAuthRef = useRef(false)
  useEffect(() => {
    if (isAuthenticated && !prevIsAuthRef.current) {
      // If there's a pending action, let the other useEffect handle navigation
      if (pendingWalletIntentRef.current) {
        prevIsAuthRef.current = isAuthenticated
        return
      }
      // Clear any previous transaction data to show clean dashboard
      dispatch({
        accountNumber: '', pixKey: '', recipientName: '', type: 'SET_BANK_DETAILS',
      })
      dispatch({
        quote: null, sourceAmount: '', targetAmount: '', type: 'SET_AMOUNTS',
      })
      dispatch({ type: 'SET_VIEW', view: 'home' })
    }
    prevIsAuthRef.current = isAuthenticated
  }, [isAuthenticated])

  useEffect(() => {
    const handleResize = () => {
      dispatch({ isDesktop: window.innerWidth >= 768, type: 'SET_DESKTOP' })
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  useEffect(() => {
    return () => {
      directAbortRef.current?.abort()
      reverseAbortRef.current?.abort()
      decodeAbortRef.current?.abort()
    }
  }, [])

  const quoteFromSource = useCallback(async (value: string) => {
    if (!selectedCorridor) {
      notifyError(t('swap.corridor_error', 'No corridor available for this currency.'))
      return
    }
    lastEditedRef.current = 'source'
    directAbortRef.current?.abort()
    reverseAbortRef.current?.abort()
    const controller = new AbortController()
    directAbortRef.current = controller
    const reqId = ++directReqIdRef.current

    const num = parseFloat(value)
    if (Number.isNaN(num)) {
      setQuoteBelowMinimum(false)
      dispatch({
        quote: null, sourceAmount: value, targetAmount: '', type: 'SET_AMOUNTS',
      })
      dispatch({ issue: value ? { action: 'change-amount', code: 'malformed-amount' } : null, type: 'SET_QUOTE_ISSUE' })
      dispatch({ loadingTarget: false, type: 'SET_LOADING' })
      return
    }

    dispatch({ loadingTarget: true, type: 'SET_LOADING' })
    dispatch({ quote: null, type: 'SET_AMOUNTS' })
    dispatch({ issue: null, type: 'SET_QUOTE_ISSUE' })
    let timedOut = false
    const timeout = window.setTimeout(() => {
      timedOut = true
      controller.abort()
    }, QUOTE_REQUEST_TIMEOUT_MS)
    const response = await requestReverseQuote(
      {
        crypto_currency: selectedCorridor.cryptoCurrency,
        network: selectedCorridor.blockchain,
        payment_method: targetPaymentMethod,
        source_amount: num,
        target_currency: selectedCorridor.targetCurrency,
      },
      { signal: controller.signal },
    )
    window.clearTimeout(timeout)

    if (reqId !== directReqIdRef.current || lastEditedRef.current !== 'source') return
    if (timedOut) {
      dispatch({ issue: { action: 'retry', code: 'timeout' }, type: 'SET_QUOTE_ISSUE' })
      dispatch({ loadingTarget: false, type: 'SET_LOADING' })
      return
    }
    if (controller.signal.aborted) return

    if (!response.ok) {
      handleQuoteError(response, 'loadingTarget', { sourceAmount: value, targetAmount: '' }, dispatch, setQuoteBelowMinimum)
      return
    }

    setQuoteBelowMinimum(false)
    const quote = response.data
    const formatted = formatTargetNumber(quote.value)
    const numericTarget = parseTargetAmount(formatted) || 0
    const snapshot = buildQuoteSnapshot({
      corridor: selectedCorridor,
      quote,
      sourceAmount: num,
      targetAmount: numericTarget,
    })
    if (!snapshot) {
      dispatch({ issue: { action: 'retry', code: 'server' }, type: 'SET_QUOTE_ISSUE' })
      dispatch({ loadingTarget: false, type: 'SET_LOADING' })
      return
    }
    if (numericTarget > 0) lastQuoteRateRef.current = numericTarget / num
    dispatch({
      quote: snapshot,
      sourceAmount: value,
      targetAmount: formatted,
      type: 'SET_AMOUNTS',
    })
    dispatch({ loadingTarget: false, type: 'SET_LOADING' })
  }, [
    formatTargetNumber,
    notifyError,
    selectedCorridor,
    targetPaymentMethod,
    t,
  ])

  const quoteFromTarget = useCallback(async (value: string): Promise<boolean> => {
    if (!selectedCorridor) {
      notifyError(t('swap.corridor_error', 'No corridor available for this currency.'))
      return false
    }
    lastEditedRef.current = 'target'
    reverseAbortRef.current?.abort()
    directAbortRef.current?.abort()

    const controller = new AbortController()
    reverseAbortRef.current = controller
    const reqId = ++reverseReqIdRef.current

    const num = parseLocalizedNumber(value)
    if (Number.isNaN(num)) {
      setQuoteBelowMinimum(false)
      dispatch({
        quote: null, sourceAmount: '', targetAmount: value, type: 'SET_AMOUNTS',
      })
      dispatch({ issue: value ? { action: 'change-amount', code: 'malformed-amount' } : null, type: 'SET_QUOTE_ISSUE' })
      dispatch({ loadingSource: false, type: 'SET_LOADING' })
      return false
    }

    // Skip API call if below minimum - inline validation handles the UI
    const minAmount = selectedCorridor.minAmount
      || (selectedCorridor.targetCurrency === 'BRL' ? 1 : 0)
    if (minAmount && num < minAmount) {
      dispatch({
        quote: null, sourceAmount: '', targetAmount: value, type: 'SET_AMOUNTS',
      })
      dispatch({ issue: { action: 'change-amount', code: 'minimum' }, type: 'SET_QUOTE_ISSUE' })
      dispatch({ loadingSource: false, type: 'SET_LOADING' })
      return false
    }

    dispatch({ loadingSource: true, type: 'SET_LOADING' })
    dispatch({ quote: null, type: 'SET_AMOUNTS' })
    dispatch({ issue: null, type: 'SET_QUOTE_ISSUE' })
    let timedOut = false
    const timeout = window.setTimeout(() => {
      timedOut = true
      controller.abort()
    }, QUOTE_REQUEST_TIMEOUT_MS)
    const response = await requestQuote(
      {
        amount: num,
        crypto_currency: selectedCorridor.cryptoCurrency,
        network: selectedCorridor.blockchain,
        payment_method: targetPaymentMethod,
        target_currency: selectedCorridor.targetCurrency,
      },
      { signal: controller.signal },
    )
    window.clearTimeout(timeout)

    if (reqId !== reverseReqIdRef.current || lastEditedRef.current !== 'target') return false
    if (timedOut) {
      dispatch({ issue: { action: 'retry', code: 'timeout' }, type: 'SET_QUOTE_ISSUE' })
      dispatch({ loadingSource: false, type: 'SET_LOADING' })
      return false
    }
    if (controller.signal.aborted) return false

    if (!response.ok) {
      handleQuoteError(response, 'loadingSource', { sourceAmount: '', targetAmount: value }, dispatch, setQuoteBelowMinimum)
      return false
    }

    setQuoteBelowMinimum(false)
    const quote = response.data
    const numericSource = Number(quote.value) || 0
    const snapshot = buildQuoteSnapshot({
      corridor: selectedCorridor,
      quote,
      sourceAmount: numericSource,
      targetAmount: num,
    })
    if (!snapshot) {
      dispatch({ issue: { action: 'retry', code: 'server' }, type: 'SET_QUOTE_ISSUE' })
      dispatch({ loadingSource: false, type: 'SET_LOADING' })
      return false
    }
    if (numericSource > 0) lastQuoteRateRef.current = num / numericSource
    dispatch({
      quote: snapshot,
      sourceAmount: formatCryptoAmount(quote.value),
      targetAmount: value,
      type: 'SET_AMOUNTS',
    })
    dispatch({ loadingSource: false, type: 'SET_LOADING' })
    return true
  }, [
    formatCryptoAmount,
    notifyError,
    selectedCorridor,
    targetPaymentMethod,
    t,
  ])

  const onSourceChange = useCallback((val: string) => {
    const sanitized = val.replace(/[^0-9.]/g, '')
    dispatch({ sourceAmount: sanitized, type: 'SET_AMOUNTS' })
    void quoteFromSource(sanitized)
  }, [quoteFromSource])

  const onTargetChange = useCallback((val: string) => {
    const sanitized = val.replace(/[^0-9.,]/g, '')
    // Strip existing thousand separators (dots), split on comma (decimal sep)
    const stripped = sanitized.replace(/\./g, '')
    const parts = stripped.split(',')
    const intPart = parts[0] || ''
    // Format integer part with dot thousand separators
    const num = parseInt(intPart, 10)
    const formattedInt = Number.isNaN(num) || intPart === ''
      ? intPart
      : num.toLocaleString('es-CO', { maximumFractionDigits: 0, useGrouping: true })
    // Reassemble: keep decimal part exactly as user typed
    const formatted = parts.length > 1
      ? `${formattedInt},${parts[1]}`
      : formattedInt
    dispatch({ targetAmount: formatted, type: 'SET_AMOUNTS' })
    void quoteFromTarget(formatted)
  }, [quoteFromTarget])

  const retryQuote = useCallback((): void => {
    if (lastEditedRef.current === 'source' && state.sourceAmount) {
      void quoteFromSource(state.sourceAmount)
      return
    }
    if (state.targetAmount) {
      void quoteFromTarget(state.targetAmount)
      return
    }
    if (state.sourceAmount) void quoteFromSource(state.sourceAmount)
  }, [
    quoteFromSource,
    quoteFromTarget,
    state.sourceAmount,
    state.targetAmount,
  ])

  const openQr = useCallback((entryMode: QrEntryMode) => {
    // Always allow opening QR scanner - auth check happens on scan result
    const method: ConsumerUxMethod = entryMode === 'camera'
      ? 'camera'
      : entryMode === 'paste'
        ? 'pasted_qr'
        : 'uploaded_image'
    recordCheckoutEvent('recipient_method_selected', {
      method,
      rail: state.destination.rail,
      step: 'payment_details',
    })
    if (selectedRecipientMethodRef.current && selectedRecipientMethodRef.current !== method) {
      recordCheckoutEvent('recipient_method_switched', {
        method,
        rail: state.destination.rail,
        step: 'payment_details',
      })
    }
    selectedRecipientMethodRef.current = method
    dispatch({ entryMode, type: 'OPEN_QR' })
  }, [recordCheckoutEvent, state.destination.rail])

  const closeQr = useCallback(() => {
    pendingWalletIntentRef.current = null
    dispatch({ type: 'CLOSE_QR' })
  }, [])

  const selectAssetOption = useCallback((key: string) => {
    if (isMiniPay) {
      miniPayManualAssetSelectionRef.current = true
    }
    setQuoteBelowMinimum(false)
    dispatch({ corridorKey: key, type: 'SET_CORRIDOR' })
    const selected = availableCorridors.find(corridor => corridorKeyOf(corridor) === key)
    if (selected) {
      setChainKey(chainKeyOf(selected))
      recordCheckoutEvent('wallet_option_selected', {
        chain: normalizeTelemetryChain(selected.blockchain),
        source_asset: normalizeTelemetryAsset(selected.cryptoCurrency),
        trigger_location: 'source_pill',
        wallet_category: normalizeTelemetryWallet(wallet?.walletId ?? null),
      })
    }
    dispatch({ quote: null, type: 'SET_AMOUNTS' })
    dispatch({ issue: null, type: 'SET_QUOTE_ISSUE' })
    lastEditedRef.current = null
    directAbortRef.current?.abort()
    reverseAbortRef.current?.abort()
  }, [
    availableCorridors,
    isMiniPay,
    recordCheckoutEvent,
    wallet?.walletId,
  ])

  const applyDestinationChange = useCallback((currency: TargetCurrency): void => {
    miniPayManualAssetSelectionRef.current = false
    // Preserve the current network/wallet when the new currency supports it, so
    // switching currency does not change the active wallet or force a reconnect.
    // Fall back to the default (stellar-first → supported network) only when the
    // currency has no corridor on the current chain.
    const currentChainKey = activeChainKey
    const currentCrypto = selectedCorridor?.cryptoCurrency
    const currencyCorridors = scopedCorridors.filter(corridor => corridor.targetCurrency === currency)
    const preservedCorridor = currentChainKey
      ? (currencyCorridors.find(corridor => chainKeyOf(corridor) === currentChainKey && corridor.cryptoCurrency === currentCrypto)
        ?? currencyCorridors.find(corridor => chainKeyOf(corridor) === currentChainKey))
      : undefined
    const now = Date.now()
    recordCheckoutEvent('destination_selected', {
      immediate_reversal: lastDestinationSelectionAtRef.current !== null
        && now - lastDestinationSelectionAtRef.current <= 10_000,
      initial_destination: telemetryDestination(state.destination),
      selected_destination: telemetryDestination(destinationForCurrency(currency)),
      source_surface: 'journey',
      step: 'destination',
    })
    lastDestinationSelectionAtRef.current = now
    dispatch({ destination: destinationForCurrency(currency), type: 'CHANGE_DESTINATION' })
    setQuoteBelowMinimum(false)
    if (preservedCorridor) {
      dispatch({ corridorKey: corridorKeyOf(preservedCorridor), type: 'SET_CORRIDOR' })
      setChainKey(chainKeyOf(preservedCorridor))
    }
    else {
      dispatch({ corridorKey: '', type: 'SET_CORRIDOR' })
      setChainKey('')
    }
    lastEditedRef.current = null
    directAbortRef.current?.abort()
    reverseAbortRef.current?.abort()
  }, [
    activeChainKey,
    recordCheckoutEvent,
    scopedCorridors,
    selectedCorridor,
    state.destination,
  ])

  const hasDestinationSpecificDraft = Boolean(
    state.acceptedPayment
    || state.accountNumber
    || state.pixKey
    || state.qrCode
    || state.quote
    || state.sourceAmount
    || state.targetAmount,
  )

  const selectCurrency = useCallback((currency: TargetCurrency): void => {
    if (currency === state.destination.currency) return
    if (hasDestinationSpecificDraft) {
      dispatch({
        destination: destinationForCurrency(currency),
        type: 'SET_PENDING_DESTINATION',
      })
      return
    }
    applyDestinationChange(currency)
  }, [
    applyDestinationChange,
    hasDestinationSpecificDraft,
    state.destination.currency,
  ])

  const cancelDestinationChange = useCallback((): void => {
    dispatch({ destination: null, type: 'SET_PENDING_DESTINATION' })
  }, [])

  const confirmDestinationChange = useCallback((): void => {
    const destination = state.pendingDestination
    if (!destination) return
    applyDestinationChange(destination.currency)
  }, [applyDestinationChange, state.pendingDestination])

  const selectChain = useCallback((key: string) => {
    setChainKey(key)
    const currentCrypto = selectedCorridor?.cryptoCurrency
    const next = availableCorridors.find(corridor => (
      chainKeyOf(corridor) === key && corridor.cryptoCurrency === currentCrypto
    )) ?? availableCorridors.find(corridor => chainKeyOf(corridor) === key)
    if (next) {
      dispatch({ corridorKey: corridorKeyOf(next), type: 'SET_CORRIDOR' })
      recordCheckoutEvent('wallet_chain_selected', {
        chain: normalizeTelemetryChain(next.blockchain),
        source_asset: normalizeTelemetryAsset(next.cryptoCurrency),
        trigger_location: 'source_pill',
      })
    }
    else {
      const fallback = corridors.find(corridor => (
        chainKeyOf(corridor) === key && corridor.cryptoCurrency === currentCrypto
      )) ?? corridors.find(corridor => chainKeyOf(corridor) === key)
      if (fallback) {
        if (fallback.targetCurrency !== state.destination.currency) {
          dispatch({ type: 'RESET' })
          dispatch({ destination: destinationForCurrency(fallback.targetCurrency), type: 'SET_DESTINATION' })
        }
        dispatch({ corridorKey: corridorKeyOf(fallback), type: 'SET_CORRIDOR' })
        recordCheckoutEvent('wallet_chain_selected', {
          chain: normalizeTelemetryChain(fallback.blockchain),
          source_asset: normalizeTelemetryAsset(fallback.cryptoCurrency),
          trigger_location: 'source_pill',
        })
      }
      else {
        dispatch({ corridorKey: '', type: 'SET_CORRIDOR' })
      }
    }
    dispatch({ quote: null, type: 'SET_AMOUNTS' })
    dispatch({ issue: null, type: 'SET_QUOTE_ISSUE' })
    lastEditedRef.current = null
    directAbortRef.current?.abort()
    reverseAbortRef.current?.abort()
  }, [
    availableCorridors,
    corridors,
    recordCheckoutEvent,
    selectedCorridor,
    state.destination.currency,
  ])

  const resetToHome = useCallback((...extra: SwapAction[]) => {
    clearPersistedPaymentDraft()
    pendingWalletIntentRef.current = null
    setWalletConnectionIssue(null)
    checkoutTelemetrySessionKeyRef.current = rotateCheckoutTelemetrySessionKey()
    checkoutStartedAtRef.current = Date.now()
    lastDestinationSelectionAtRef.current = null
    selectedRecipientMethodRef.current = null
    dispatch({ type: 'RESET' })
    for (const action of extra) dispatch(action)
    dispatch({ type: 'SET_VIEW', view: 'home' })
  }, [])

  const handleBackToSwap = useCallback(() => resetToHome(), [resetToHome])

  const resetForNewTransaction = useCallback(() => resetToHome({ transactionId: null, type: 'SET_TRANSACTION_ID' }), [resetToHome])

  const goToManual = useCallback(() => {
    if (selectedRecipientMethodRef.current && selectedRecipientMethodRef.current !== 'payment_key') {
      recordCheckoutEvent('recipient_method_switched', {
        method: 'payment_key',
        rail: state.destination.rail,
        step: 'payment_details',
      })
    }
    selectedRecipientMethodRef.current = 'payment_key'
    recordCheckoutEvent('recipient_method_selected', {
      method: 'payment_key',
      rail: state.destination.rail,
      step: 'payment_details',
    })
    dispatch({ type: 'SET_VIEW', view: 'swap' })
  }, [recordCheckoutEvent, state.destination.rail])

  const onPrimaryAction = useCallback(async () => {
    if (!isAuthenticated) {
      if (isMiniPay) {
        return
      }
      pendingWalletIntentRef.current = {
        destination: state.destination,
        kind: 'review-manual',
        targetAmount: state.targetAmount,
      }
      await connectWallet()
      return
    }
    if (!state.quote) {
      notifyError(t('swap.wait_for_quote', 'Please wait for the quote before continuing'))
      return
    }
    if (isQuoteExpired(state.quote)) {
      dispatch({ issue: { action: 'retry', code: 'rate-expired' }, type: 'SET_QUOTE_ISSUE' })
      dispatch({ quote: null, type: 'SET_AMOUNTS' })
      return
    }
    dispatch({ type: 'SET_VIEW', view: 'confirm-qr' })
  }, [
    connectWallet,
    isAuthenticated,
    isMiniPay,
    notifyError,
    state.destination,
    state.quote,
    state.targetAmount,
    t,
  ])

  const currentBgUrl = state.destination.currency === TargetCurrency.BRL ? BRL_BACKGROUND_IMAGE : ASSET_URLS.BACKGROUND_IMAGE

  const processQrPayload = useCallback(async (
    text: string,
    destination: PaymentDestination,
  ): Promise<void> => {
    if (
      destination.currency !== state.destination.currency
      || destination.rail !== state.destination.rail
    ) {
      throw new QrInputError('wrong-rail', t('swap.qr_wrong_rail', 'The destination changed. Reopen the QR option for the selected payment rail.'))
    }
    if (
      !selectedCorridor
      || selectedCorridor.targetCurrency !== destination.currency
      || selectedCorridor.paymentMethod !== destination.rail
    ) {
      throw new QrInputError('wrong-rail', t('swap.qr_wrong_rail', 'This QR does not match the selected payment rail.'))
    }
    dispatch({ isDecodingQr: true, type: 'SET_DECODING' })

    try {
      if (destination.rail === 'BREB') {
        const parsed = parseEMVQR(text)

        if (!parsed.keyInfo?.value) {
          throw new QrInputError('invalid-payload', t('swap.qr_decode_error', 'We could not read a Llave Bre-B from this QR code.'))
        }

        if (parsed.currency && parsed.currency !== '170') {
          throw new QrInputError('unsupported-currency', t('swap.qr_wrong_currency', 'This QR code is not denominated in Colombian pesos.'))
        }

        dispatch({ qrCode: text, type: 'SET_QR_CODE' })
        dispatch({ accountNumber: parsed.keyInfo.value, type: 'SET_BANK_DETAILS' })
        if (parsed.merchantName) {
          dispatch({ recipientName: parsed.merchantName, type: 'SET_BANK_DETAILS' })
        }

        if (parsed.amount && Number.isFinite(parsed.amount) && parsed.amount > 0) {
          const amountStr = String(parsed.amount)
          const minAmount = selectedCorridor?.minAmount ?? 0
          if (minAmount && parsed.amount < minAmount) {
            throw new QrInputError(
              'below-minimum',
              t('swap.qr_below_minimum', `The QR amount (${parsed.amount} COP) is below the ${minAmount} COP minimum.`),
            )
          }
          const quoted = await quoteFromTarget(amountStr)
          if (!quoted) {
            throw new QrInputError('quote-unavailable', t('swap.qr_quote_error', 'We could not create a quote for this QR amount. Check the amount and try again.'))
          }
          dispatch({ type: 'CLOSE_QR' })
          dispatch({ type: 'SET_VIEW', view: 'confirm-qr' })
          return
        }

        dispatch({ type: 'CLOSE_QR' })
        dispatch({ type: 'SET_VIEW', view: 'swap' })
      }
      else {
        decodeAbortRef.current?.abort()
        const controller = new AbortController()
        decodeAbortRef.current = controller
        const response = await decodeQrCodeBR({ qrCode: text }, { signal: controller.signal }) as DecodeQrApiResponse
        if (controller.signal.aborted) {
          throw new QrInputError('invalid-payload', t('swap.qr_decode_cancelled', 'QR checking was interrupted. Try again.'))
        }
        if (!response.ok) {
          const reason = extractReason(response.data) || t('swap.qr_decode_error', 'We could not verify this Pix QR code. Check the code and try again.')
          throw new QrInputError('invalid-payload', reason)
        }
        const decoded = response.data && 'decoded' in response.data ? response.data.decoded : null
        if (!decoded) {
          throw new QrInputError('invalid-payload', t('swap.qr_decode_error', 'We could not verify this Pix QR code. Check the code and try again.'))
        }

        const amountRaw = decoded.amount
        const amountText = typeof amountRaw === 'string' ? amountRaw : null
        const normalizedAmount = amountText?.replace(',', '.').trim() ?? ''
        const parsedAmount = normalizedAmount ? Number.parseFloat(normalizedAmount) : Number.NaN
        const pixKey = decoded.account
        const name = decoded.name

        dispatch({ qrCode: text, type: 'SET_QR_CODE' })
        if (name) dispatch({ recipientName: name, type: 'SET_BANK_DETAILS' })
        if (pixKey) dispatch({ pixKey, type: 'SET_BANK_DETAILS' })

        if (Number.isFinite(parsedAmount) && parsedAmount > 0) {
          const quoted = await quoteFromTarget(normalizedAmount)
          if (!quoted) {
            throw new QrInputError('quote-unavailable', t('swap.qr_quote_error', 'We could not create a quote for this QR amount. Check the amount and try again.'))
          }
          dispatch({ type: 'CLOSE_QR' })
          dispatch({ type: 'SET_VIEW', view: 'confirm-qr' })
          return
        }

        dispatch({ type: 'CLOSE_QR' })
        dispatch({ type: 'SET_VIEW', view: 'swap' })
      }
    }
    finally {
      dispatch({ isDecodingQr: false, type: 'SET_DECODING' })
    }
  }, [
    quoteFromTarget,
    selectedCorridor,
    state.destination,
    t,
  ])

  const handleQrResult = useCallback(async (text: string): Promise<void> => {
    const pendingIntent: PendingWalletIntent = {
      destination: state.destination,
      kind: 'decode-qr',
      mode: state.qrEntryMode,
      payload: text,
    }
    if (!isAuthenticated) {
      if (isMiniPay) {
        throw new QrInputError('wallet-connection', t('swap.minipay.not_ready', 'Open MiniPay and try again when the wallet is ready.'))
      }
      pendingWalletIntentRef.current = pendingIntent
      dispatch({ type: 'CLOSE_QR' })
      const connected = await connectWallet()
      if (!connected) {
        dispatch({ entryMode: pendingIntent.mode, type: 'OPEN_QR' })
        throw new QrInputError('wallet-connection', t('swap.wallet_connect_error', 'We could not connect your wallet. Your QR code was not submitted.'))
      }
      return
    }

    await processQrPayload(text, state.destination)
  }, [
    connectWallet,
    isAuthenticated,
    isMiniPay,
    processQrPayload,
    state.destination,
    state.qrEntryMode,
    t,
  ])

  useEffect(() => {
    if (!isAuthenticated) return
    const pendingIntent = pendingWalletIntentRef.current
    if (!pendingIntent) return
    pendingWalletIntentRef.current = null

    if (
      pendingIntent.destination.currency !== state.destination.currency
      || pendingIntent.destination.rail !== state.destination.rail
    ) {
      notifyError(t('swap.pending_destination_changed', 'The destination changed while connecting. Your previous payment was not submitted.'))
      return
    }

    if (pendingIntent.kind === 'decode-qr') {
      void processQrPayload(pendingIntent.payload, pendingIntent.destination).catch((error: unknown) => {
        notifyError(
          error instanceof QrInputError
            ? error.message
            : t('swap.qr_decode_error', 'We could not process this QR code.'),
        )
        dispatch({ entryMode: pendingIntent.mode, type: 'OPEN_QR' })
      })
      return
    }

    void quoteFromTarget(pendingIntent.targetAmount).then((quoted) => {
      dispatch({ type: 'SET_VIEW', view: quoted ? 'confirm-qr' : 'swap' })
    }).catch(() => {
      notifyError(t('swap.quote_error', 'We could not refresh the quote. Your payment details are still here.'))
      dispatch({ type: 'SET_VIEW', view: 'swap' })
    })
  }, [
    isAuthenticated,
    notifyError,
    processQrPayload,
    quoteFromTarget,
    state.destination.currency,
    state.destination.rail,
    t,
  ])

  const persistAcceptedPayment = useCallback((
    acceptedPayment: RestorableAcceptedPayment,
    view: SwapView,
  ): void => {
    const transactionId = acceptedPayment.authorization.transactionId
    const nextState: SwapControllerState = {
      ...state,
      acceptedPayment,
      transactionId,
      view,
    }
    // Persist synchronously before a wallet request can suspend, reject, or
    // broadcast. React state is then updated for the current render tree.
    persistState(nextState)
    dispatch({ acceptedPayment, type: 'SET_ACCEPTED_PAYMENT' })
    dispatch({ type: 'SET_VIEW', view })
  }, [state])

  const authorizePayment = useCallback(async (
    acceptedPayment: RestorableAcceptedPayment,
  ): Promise<void> => {
    const transactionId = acceptedPayment.authorization.transactionId
    if (!wallet || !acceptedPayment.paymentContext) {
      persistAcceptedPayment(acceptedPayment, 'txStatus')
      notifyError(t('swap.errors.payment_context_saved', 'Your Abroad request was created, but wallet authorization is not available. Track this request in Activity or contact support.'))
      return
    }

    const authorizingPayment: RestorableAcceptedPayment = {
      ...acceptedPayment,
      authorization: { kind: 'authorizing', transactionId },
    }
    persistAcceptedPayment(authorizingPayment, 'wait-sign')

    try {
      const { onChainId } = await authorizeAcceptedPayment({
        context: acceptedPayment.paymentContext,
        t,
        wallet,
      })
      const confirmedPayment: RestorableAcceptedPayment = {
        ...acceptedPayment,
        authorization: { kind: 'broadcast-confirmed', onChainId, transactionId },
      }
      persistAcceptedPayment(confirmedPayment, 'txStatus')

      if (acceptedPayment.paymentContext.notify.required) {
        const notifyResponse = await notifyPayment({
          blockchain: acceptedPayment.paymentContext.blockchain,
          on_chain_tx: onChainId,
          transaction_id: transactionId,
        })
        if (!notifyResponse.ok && !isAbortError(notifyResponse)) {
          notifyError(
            t('swap.notify_reconciliation', 'Your transfer was submitted and Abroad is reconciling it. Do not send it again.'),
          )
        }
      }
    }
    catch (error) {
      const authorization = error instanceof PaymentAuthorizationError
        ? error.kind === 'wallet-rejected'
          ? { kind: 'wallet-rejected' as const, transactionId }
          : error.kind === 'broadcast-unknown'
            ? { kind: 'broadcast-unknown' as const, transactionId }
            : { kind: 'accepted' as const, transactionId }
        : { kind: 'broadcast-unknown' as const, transactionId }
      persistAcceptedPayment({ ...acceptedPayment, authorization }, 'txStatus')
      notifyError(
        error instanceof PaymentAuthorizationError
          ? error.message
          : t('swap.errors.broadcast_unknown', 'The network did not confirm whether the transfer was sent. Do not submit it again while Abroad reconciles the result.'),
      )
    }
  }, [
    notifyError,
    persistAcceptedPayment,
    t,
    wallet,
  ])

  const handleTransactionFlow = useCallback(async () => {
    dispatch({ loadingSubmit: true, type: 'SET_SUBMITTING' })
    try {
      if (!selectedCorridor) {
        throw new Error(t('swap.errors.missing_corridor', 'No corridor available.'))
      }
      if (!state.quote) {
        throw new Error(t('swap.errors.missing_quote', 'Missing quote or wallet address.'))
      }
      if (isQuoteExpired(state.quote)) {
        dispatch({ issue: { action: 'retry', code: 'rate-expired' }, type: 'SET_QUOTE_ISSUE' })
        dispatch({ quote: null, type: 'SET_AMOUNTS' })
        dispatch({ type: 'SET_VIEW', view: 'swap' })
        return
      }
      if (!wallet?.address || !walletUserId || !wallet.chainId) {
        throw new Error(t('swap.errors.missing_wallet', 'Connect your wallet before continuing.'))
      }

      const redirectUrl = encodeURIComponent(
        window.location.href.replace(/^https?:\/\//, ''),
      )
      const isBrazil = state.destination.currency === TargetCurrency.BRL

      if (pixCheckoutTelemetryContext) {
        recordPixCheckoutEvent({
          context: pixCheckoutTelemetryContext,
          name: 'submission_started',
        })
      }

      let response: Awaited<ReturnType<typeof acceptTransactionRequest>>
      try {
        response = await acceptTransactionRequest({
          account_number:
            isBrazil ? state.pixKey : state.accountNumber.trim(),
          qr_code: state.qrCode,
          quote_id: state.quote.id,
          redirectUrl,
          user_id: walletUserId,
        })
      }
      catch (error) {
        if (pixCheckoutTelemetryContext) {
          recordPixCheckoutEvent({
            context: pixCheckoutTelemetryContext,
            name: 'submission_rejected',
            statusClass: 'network_error',
          })
        }
        throw error
      }

      if (!response.ok) {
        if (pixCheckoutTelemetryContext) {
          recordPixCheckoutEvent({
            context: pixCheckoutTelemetryContext,
            name: 'submission_rejected',
            statusClass: classifyPixCheckoutStatus(response.status),
          })
        }
        if (!isAbortError(response)) {
          const isDefinitiveClientRejection = response.error.type === 'http'
            && response.status !== null
            && response.status >= 400
            && response.status < 500
          if (isDefinitiveClientRejection) {
            dispatch({ issue: classifyQuoteFailure(response), type: 'SET_QUOTE_ISSUE' })
            dispatch({ type: 'SET_VIEW', view: 'swap' })
          }
          else {
            notifyError(t(
              'swap.errors.acceptance_unknown',
              'We could not confirm whether your request was created. Check Activity before trying again.',
            ))
          }
        }
        return
      }

      if (pixCheckoutTelemetryContext) {
        recordPixCheckoutEvent({
          context: pixCheckoutTelemetryContext,
          name: 'submission_accepted',
        })
      }

      const {
        id: acceptedTxId,
        kycRequired,
        payment_context: paymentContext,
        transaction_reference,
      } = response.data

      if (kycRequired) {
        dispatch({ type: 'SET_VIEW', view: 'kyc-needed' })
        return
      }

      if (!acceptedTxId) {
        notifyError(t('swap.accept_error', 'We could not start the transaction.'))
        return
      }

      const acceptedPayment: RestorableAcceptedPayment = {
        authorization: { kind: 'accepted', transactionId: acceptedTxId },
        paymentContext: parsePaymentContextSnapshot(paymentContext),
        transactionReference: transaction_reference,
      }
      persistAcceptedPayment(acceptedPayment, 'wait-sign')

      if (wallet.walletId === 'sep24' && selectedCorridor.chainFamily === 'stellar') {
        const queryParams = new URLSearchParams(window.location.search)
        const callbackUrl = queryParams.get('callback')
        const onChangeCallbackUrl = queryParams.get('on_change_callback')
        const sepTransactionId = queryParams.get('transaction_id')
        const sepBaseUrl = import.meta.env.VITE_SEP_BASE_URL || 'http://localhost:8000'
        let url = encodeURI(
          `${sepBaseUrl}/sep24/transactions/withdraw/interactive/complete?amount_expected=${state.sourceAmount}&transaction_id=${sepTransactionId}`,
        )
        if (callbackUrl && callbackUrl.toLowerCase() !== 'none') {
          url += `&callback=${encodeURIComponent(callbackUrl)}`
        }
        if (onChangeCallbackUrl && onChangeCallbackUrl.toLowerCase() !== 'none') {
          url += `&on_change_callback=${encodeURIComponent(onChangeCallbackUrl)}`
        }
        if (transaction_reference) {
          url += `&memo=${encodeURIComponent(transaction_reference)}`
        }
        window.location.href = url
        return
      }

      await authorizePayment(acceptedPayment)
    }
    catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return
      notifyError(t('swap.accept_error', 'We could not start the transaction.'))
    }
    finally {
      dispatch({ loadingSubmit: false, type: 'SET_SUBMITTING' })
    }
  }, [
    authorizePayment,
    notifyError,
    persistAcceptedPayment,
    pixCheckoutTelemetryContext,
    selectedCorridor,
    state.accountNumber,
    state.pixKey,
    state.qrCode,
    state.quote,
    state.sourceAmount,
    state.destination.currency,
    t,
    wallet,
    walletUserId,
  ])

  const resumeAcceptedAuthorization = useCallback(async (): Promise<void> => {
    const acceptedPayment = state.acceptedPayment
    if (
      !acceptedPayment
      || !acceptedPayment.paymentContext
      || !canRetryWalletAuthorization(acceptedPayment.authorization)
    ) {
      notifyError(t('swap.errors.authorization_not_retryable', 'This payment must be reconciled before another wallet action. Check its status in Activity.'))
      dispatch({ type: 'SET_VIEW', view: 'txStatus' })
      return
    }

    dispatch({ loadingSubmit: true, type: 'SET_SUBMITTING' })
    try {
      await authorizePayment(acceptedPayment)
    }
    finally {
      dispatch({ loadingSubmit: false, type: 'SET_SUBMITTING' })
    }
  }, [
    authorizePayment,
    notifyError,
    state.acceptedPayment,
    t,
  ])

  const handleConfirmQr = useCallback(() => {
    if (!state.targetAmount || !state.sourceAmount) {
      notifyError(t('confirm_qr.missing_amount', 'Missing amounts to continue.'))
      dispatch({ type: 'SET_VIEW', view: 'swap' })
      return
    }
    if (
      state.destination.currency === TargetCurrency.BRL
      && !state.pixKey.trim()
      && !state.qrCode
    ) {
      notifyError(t('confirm_qr.missing_data', 'Missing data to complete the transaction.'))
      dispatch({ type: 'SET_VIEW', view: 'swap' })
      return
    }
    void handleTransactionFlow()
  }, [
    handleTransactionFlow,
    notifyError,
    state.pixKey,
    state.qrCode,
    state.sourceAmount,
    state.targetAmount,
    state.destination.currency,
    t,
  ])

  const recordRecipientChange = useCallback((value: string, fromQr = false): void => {
    const sessionKey = checkoutTelemetrySessionKeyRef.current
    recordCheckoutEvent('recipient_input_started', {
      key_type: telemetryRecipientKeyType(value, fromQr),
      method: fromQr ? 'pasted_qr' : 'payment_key',
      rail: state.destination.rail,
      step: 'payment_details',
    }, sessionKey ? `${sessionKey}:recipient-input-started:${state.destination.rail}` : undefined)
    if (state.quoteIssue?.code === 'invalid-recipient') {
      recordCheckoutEvent('recipient_correction', {
        key_type: telemetryRecipientKeyType(value, fromQr),
        method: fromQr ? 'pasted_qr' : 'payment_key',
        rail: state.destination.rail,
        step: 'payment_details',
      })
    }
  }, [
    recordCheckoutEvent,
    state.destination.rail,
    state.quoteIssue?.code,
  ])

  const recordManualRecipientAbandonment = useCallback((): void => {
    recordCheckoutEvent('recipient_entry_abandoned', {
      method: 'payment_key',
      outcome: 'cancelled',
      rail: state.destination.rail,
      step: 'payment_details',
    })
  }, [recordCheckoutEvent, state.destination.rail])

  const recordManualRecipientHelp = useCallback((): void => {
    recordCheckoutEvent('recipient_help_opened', {
      action: 'help',
      key_type: telemetryRecipientKeyType(
        state.destination.currency === TargetCurrency.BRL
          ? state.pixKey
          : state.accountNumber,
        false,
      ),
      method: 'payment_key',
      rail: state.destination.rail,
      step: 'payment_details',
    })
  }, [
    recordCheckoutEvent,
    state.accountNumber,
    state.destination.currency,
    state.destination.rail,
    state.pixKey,
  ])

  const swapProps: SwapProps = {
    continueDisabled,
    exchangeRateDisplay,
    feeDisplay,
    fromQr: !!state.qrCode,
    hasInsufficientFunds,
    isAboveMaximum,
    isAuthenticated,
    isBelowMinimum,
    isMiniPay,
    isMiniPayReady: miniPay.isReady,
    loadingSource: state.loadingSource,
    loadingTarget: state.loadingTarget,
    loadingWallet: isMiniPay && miniPay.isResolving,
    maximumAmountDisplay,
    minimumAmountDisplay,
    miniPayNotice,
    networkLabel: selectedCorridor ? buildChainLabel(selectedCorridor, false) : '',
    onOpenSourceModal: () => { /* handled in WebSwap */ },
    onOpenTargetModal: () => { /* handled in WebSwap */ },
    onPrimaryAction,
    onRecipientChange: state.destination.currency === TargetCurrency.BRL
      ? (value) => {
          recordRecipientChange(value)
          dispatch({ pixKey: value, type: 'SET_BANK_DETAILS' })
          if (state.quoteIssue?.code === 'invalid-recipient') {
            dispatch({ issue: null, type: 'SET_QUOTE_ISSUE' })
          }
        }
      : (value) => {
          recordRecipientChange(value)
          dispatch({ accountNumber: value.trim(), type: 'SET_BANK_DETAILS' })
          if (state.quoteIssue?.code === 'invalid-recipient') {
            dispatch({ issue: null, type: 'SET_QUOTE_ISSUE' })
          }
        },
    onRecipientEntryAbandoned: recordManualRecipientAbandonment,
    onRecipientHelp: recordManualRecipientHelp,
    onRetryQuote: retryQuote,
    onSourceChange,
    onTargetChange,
    quoteExpired,
    quoteIssue: state.quoteIssue,
    quoteRemainingSeconds,
    recipientName: state.recipientName,
    recipientValue: state.destination.currency === TargetCurrency.BRL ? state.pixKey : state.accountNumber,
    selectCurrency,
    selectedAssetLabel,
    sourceAmount: state.sourceAmount,
    targetAmount: state.targetAmount,
    targetCurrency: state.destination.currency,
    timingDisplay: null,
    walletStatusLabel: isMiniPay
      ? miniPay.isReady
        ? t('swap.minipay.ready', 'MiniPay ready')
        : t('swap.minipay.opening', 'Opening MiniPay')
      : undefined,
    walletStatusTone: isMiniPay ? 'info' : undefined,
  }

  const confirmQrProps: ConfirmQrProps = {
    accountNumber: state.accountNumber,
    currency: state.destination.currency,
    exchangeRateDisplay,
    feeDisplay,
    loadingSubmit: state.loadingSubmit,
    networkLabel: selectedCorridor ? buildChainLabel(selectedCorridor, false) : '',
    onBack: handleBackToSwap,
    onConfirm: handleConfirmQr,
    onEdit: () => dispatch({ type: 'SET_VIEW', view: 'swap' }),
    onRefreshQuote: () => {
      dispatch({ type: 'SET_VIEW', view: 'swap' })
      retryQuote()
    },
    pixKey: state.pixKey,
    quoteExpired,
    quoteRemainingSeconds,
    recipientName: state.recipientName,
    selectedAssetLabel,
    sourceAmount: state.sourceAmount,
    targetAmount: state.targetAmount,
    timingDisplay: null,
  }

  const handleKycSubmit = useCallback(async (values: KycFormValues): Promise<KycSubmitOutcome> => {
    if (!walletUserId) {
      return {
        error: t('kyc_form.error_no_user', 'We could not identify your session. Please reconnect your wallet.'),
        errorCode: 'validation',
        ok: false,
      }
    }
    const result = await submitKyc({ ...values, userId: walletUserId })
    if (!result.ok) {
      const unavailable = result.error.type === 'network'
        || result.status === 429
        || (result.status !== null && result.status >= 500)
      return {
        error: unavailable
          ? t('kyc_form.service_unavailable', 'Identity verification is temporarily unavailable. Your details are still here. Try again shortly.')
          : t('kyc_form.submit_error', 'We could not submit your verification. Your details are still here. Try again.'),
        errorCode: unavailable ? 'service-unavailable' : 'validation',
        ok: false,
      }
    }
    if (result.data.status !== 'APPROVED') {
      return { ok: true, status: result.data.status }
    }
    if (!kycCanResumePayment) {
      dispatch({ type: 'SET_VIEW', view: 'swap' })
      return { ok: true, status: 'APPROVED' }
    }
    if (kycResumeInFlightRef.current) {
      return {
        error: t('kyc_form.resume_in_progress', 'Verification is approved and this payment is already continuing.'),
        errorCode: 'validation',
        ok: false,
      }
    }

    kycResumeInFlightRef.current = true
    try {
      // KYC is checked before transaction creation. Resume this complete
      // in-memory request exactly once; handleTransactionFlow performs fresh
      // quote and wallet checks before creating a transaction.
      await handleTransactionFlow()
      return { ok: true, status: 'APPROVED' }
    }
    finally {
      kycResumeInFlightRef.current = false
    }
  }, [
    handleTransactionFlow,
    kycCanResumePayment,
    t,
    walletUserId,
  ])

  const handleKycClose = useCallback((): void => {
    dispatch({
      type: 'SET_VIEW',
      view: kycCanResumePayment ? 'confirm-qr' : 'swap',
    })
  }, [kycCanResumePayment])

  return {
    assetOptions,
    authorizationState: state.acceptedPayment?.authorization ?? null,
    balancesByAsset: {
      USDC: stablecoinBalances.usdc,
      USDT: stablecoinBalances.usdt,
    },
    buyCrypto: {
      cancel: cancelBuyCrypto,
      destinationAddress: wallet?.address ?? null,
      limits: {
        maxAmount: selectedCorridor?.maxAmount ?? null,
        minAmount: selectedCorridor?.minAmount ?? null,
      },
      start: startBuyCrypto,
      state: onramp.state,
      submit: submitBuyCrypto,
    },
    cancelDestinationChange,
    chainOptions,
    clearWalletConnectionIssue,
    closeQr,
    confirmDestinationChange,
    confirmQrProps,
    currentBgUrl,
    goToManual,
    handleBackToSwap,
    handleKycClose,
    handleKycSubmit,
    handleQrResult,
    isDecodingQr: state.isDecodingQr,
    isLoadingBalance: stablecoinBalances.isLoading,
    isMiniPay,
    isQrOpen: state.isQrOpen,
    kycCanResumePayment,
    onboardingRates: state.onboardingRates,
    onDisconnectWallet,
    openQr,
    pendingDestinationCurrency: state.pendingDestination?.currency ?? null,
    qrEntryMode: state.qrEntryMode,
    requestConnectAfterSourceSelect,
    resetForNewTransaction,
    resumeAcceptedAuthorization,
    retryWalletConnection,
    selectAssetOption,
    selectChain,
    selectCurrency,
    selectedChainKey: activeChainKey,
    sourceAmountForBalanceCheck,
    sourceAssetBalance: selectedSourceBalance,
    swapViewProps: swapProps,
    targetCurrency: state.destination.currency,
    transactionId: state.transactionId,
    view: state.view,
    walletAddress: wallet?.address ?? null,
    walletConnectionInProgress,
    walletConnectionIssue,
    walletSourceOptions,
  }
}

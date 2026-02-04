import {
  Asset,
  BASE_FEE,
  Horizon,
  Memo,
  Networks,
  Operation,
  Transaction,
  TransactionBuilder,
} from '@stellar/stellar-sdk'
import { useTranslate } from '@tolgee/react'
import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
} from 'react'

import type { ApiClientResponse } from '../../api/customClient'
import type { BankDetailsRouteProps } from '../../features/swap/components/BankDetailsRoute'
import type { ConfirmQrProps } from '../../features/swap/components/ConfirmQr'
import type { SwapProps } from '../../features/swap/components/Swap'
import type { WebSwapControllerProps } from './WebSwap'

import {
  acceptTransaction,
  type AcceptTransaction400,
  type acceptTransactionResponse,
  _36EnumsBlockchainNetwork as BlockchainNetwork,
  _36EnumsCryptoCurrency as CryptoCurrency,
  decodeQrCodeBR,
  type DecodeQrCodeBR400,
  type decodeQrCodeBRResponse,
  getQuote,
  type GetQuote400,
  type getQuoteResponse,
  getReverseQuote,
  type GetReverseQuote400,
  type getReverseQuoteResponse,
  SupportedPaymentMethod as PaymentMethod,
  _36EnumsTargetCurrency as TargetCurrency,
} from '../../api'
import { useNotices } from '../../contexts/NoticeContext'
import { BRL_BACKGROUND_IMAGE } from '../../features/swap/constants'
import { SwapView } from '../../features/swap/types'
import { ASSET_URLS, PENDING_TX_KEY } from '../../shared/constants'
import { useWalletAuth } from '../../shared/hooks/useWalletAuth'
import { hasMessage } from '../../shared/utils'
import { formatWithThousandsSeparator } from '../../shared/utils/numberFormatter'

type AcceptTransactionApiResponse = ApiClientResponse<acceptTransactionResponse, AcceptTransaction400>

type DecodeQrApiResponse = ApiClientResponse<decodeQrCodeBRResponse, DecodeQrCodeBR400>

type QuoteApiResponse = ApiClientResponse<getQuoteResponse, GetQuote400>
type ReverseQuoteApiResponse = ApiClientResponse<getReverseQuoteResponse, GetReverseQuote400>
type SwapAction
  = | { accountNumber?: string, pixKey?: string, recipientName?: string, taxId?: string, type: 'SET_BANK_DETAILS' }
  | { isDecodingQr: boolean, type: 'SET_DECODING' }
  | { isDesktop: boolean, type: 'SET_DESKTOP' }
  | { isQrOpen: boolean, type: 'SET_QR_OPEN' }
  | { isWalletDetailsOpen: boolean, type: 'SET_WALLET_DETAILS_OPEN' }
  | { loadingBalance: boolean, type: 'SET_LOADING_BALANCE' }
  | { loadingSource?: boolean, loadingTarget?: boolean, type: 'SET_LOADING' }
  | { loadingSubmit: boolean, type: 'SET_SUBMITTING' }
  | { payload: Partial<SwapControllerState>, type: 'HYDRATE' }
  | { qrCode: null | string, type: 'SET_QR_CODE' }
  | { quoteId?: string, sourceAmount?: string, targetAmount?: string, type: 'SET_AMOUNTS' }
  | { targetCurrency: TargetCurrency, type: 'SET_TARGET_CURRENCY' }
  | { transactionId: null | string, type: 'SET_TRANSACTION_ID' }
  | { type: 'RESET' }
  | { type: 'SET_VIEW', view: SwapView }
  | { type: 'SET_USDC_BALANCE', usdcBalance: string }
  | { type: 'SET_UNIT_RATE', unitRate: string }
type SwapControllerState = {
  accountNumber: string
  isDecodingQr: boolean
  isDesktop: boolean
  isQrOpen: boolean
  isWalletDetailsOpen: boolean
  loadingBalance: boolean
  loadingSource: boolean
  loadingSubmit: boolean
  loadingTarget: boolean
  pixKey: string
  qrCode: null | string
  quoteId: string
  recipientName: string
  sourceAmount: string
  targetAmount: string
  targetCurrency: TargetCurrency
  taxId: string
  transactionId: null | string
  unitRate: string
  usdcBalance: string
  view: SwapView
}

const COP_TRANSFER_FEE = 0.0
const BRL_TRANSFER_FEE = 0.0
const NETWORK_PASSPHRASE = Networks.PUBLIC
const HORIZON_SERVER = new Horizon.Server('https://horizon.stellar.org')

const createInitialState = (isDesktop: boolean): SwapControllerState => ({
  accountNumber: '',
  isDecodingQr: false,
  isDesktop,
  isQrOpen: false,
  isWalletDetailsOpen: false,
  loadingBalance: false,
  loadingSource: false,
  loadingSubmit: false,
  loadingTarget: false,
  pixKey: '',
  qrCode: null,
  quoteId: '',
  recipientName: '',
  sourceAmount: '',
  targetAmount: '',
  targetCurrency: TargetCurrency.BRL,
  taxId: '',
  transactionId: null,
  unitRate: '',
  usdcBalance: '',
  view: 'swap',
})

const reducer = (state: SwapControllerState, action: SwapAction): SwapControllerState => {
  switch (action.type) {
    case 'HYDRATE':
      return { ...state, ...action.payload }
    case 'RESET':
      return {
        ...createInitialState(state.isDesktop),
        targetCurrency: state.targetCurrency,
        usdcBalance: state.usdcBalance,
      }
    case 'SET_AMOUNTS':
      return {
        ...state,
        quoteId: action.quoteId ?? state.quoteId,
        sourceAmount: action.sourceAmount ?? state.sourceAmount,
        targetAmount: action.targetAmount ?? state.targetAmount,
      }
    case 'SET_BANK_DETAILS':
      return {
        ...state,
        accountNumber: action.accountNumber ?? state.accountNumber,
        pixKey: action.pixKey ?? state.pixKey,
        recipientName: action.recipientName ?? state.recipientName,
        taxId: action.taxId ?? state.taxId,
      }
    case 'SET_DECODING':
      return { ...state, isDecodingQr: action.isDecodingQr }
    case 'SET_DESKTOP':
      return { ...state, isDesktop: action.isDesktop }
    case 'SET_LOADING':
      return {
        ...state,
        loadingSource: action.loadingSource ?? state.loadingSource,
        loadingTarget: action.loadingTarget ?? state.loadingTarget,
      }
    case 'SET_QR_CODE':
      return { ...state, qrCode: action.qrCode }
    case 'SET_QR_OPEN':
      return { ...state, isQrOpen: action.isQrOpen }
    case 'SET_SUBMITTING':
      return { ...state, loadingSubmit: action.loadingSubmit }
    case 'SET_TARGET_CURRENCY':
      return { ...state, targetCurrency: action.targetCurrency }
    case 'SET_TRANSACTION_ID':
      return { ...state, transactionId: action.transactionId }
    case 'SET_VIEW':
      return { ...state, view: action.view }
    case 'SET_WALLET_DETAILS_OPEN':
      return { ...state, isWalletDetailsOpen: action.isWalletDetailsOpen }
    case 'SET_LOADING_BALANCE':
      return { ...state, loadingBalance: action.loadingBalance }
    case 'SET_USDC_BALANCE':
      return { ...state, usdcBalance: action.usdcBalance }
    case 'SET_UNIT_RATE':
      return { ...state, unitRate: action.unitRate }
    default:
      return state
  }
}

type PersistedSwap = {
  accountNumber?: string
  pixKey?: string
  quoteId?: string
  recipientName?: string
  sourceAmount?: string
  targetAmount?: string
  targetCurrency?: TargetCurrency
  taxId?: string
  view?: SwapView
}

const readPersisted = (): null | PersistedSwap => {
  try {
    const raw = localStorage.getItem(PENDING_TX_KEY)
    if (!raw) return null
    return JSON.parse(raw) as PersistedSwap
  }
  catch {
    return null
  }
}

const persistState = (state: SwapControllerState) => {
  const payload: PersistedSwap = {
    accountNumber: state.accountNumber,
    pixKey: state.pixKey,
    quoteId: state.quoteId,
    recipientName: state.recipientName,
    sourceAmount: state.sourceAmount,
    targetAmount: state.targetAmount,
    targetCurrency: state.targetCurrency,
    taxId: state.taxId,
    view: state.view,
  }
  const hasData = Boolean(
    state.quoteId
    || state.pixKey
    || state.accountNumber
    || state.targetAmount
    || state.sourceAmount,
  )
  if (hasData) {
    localStorage.setItem(PENDING_TX_KEY, JSON.stringify(payload))
  }
  else {
    localStorage.removeItem(PENDING_TX_KEY)
  }
}

const formatError = (message: string, description?: string) => ({
  description,
  kind: 'error' as const,
  message,
})

const getNestedError = (b: Record<string, unknown>): string | null => {
  if (typeof b.reason === 'string') return b.reason
  if (typeof b.message === 'string') return b.message
  if (typeof b.error === 'string') return b.error

  if (b.error && typeof b.error === 'object') {
    const e = b.error as Record<string, unknown>
    if (typeof e.message === 'string') return e.message
  }

  if (typeof b.code === 'string') return b.code
  return null
}

const extractReason = (body: unknown): null | string => {
  if (Array.isArray(body)) {
    for (const item of body) {
      const found = extractReason(item)
      if (found) return found
    }
    return null
  }

  if (body && typeof body === 'object') {
    return getNestedError(body as Record<string, unknown>)
  }

  return null
}

const isAbortError = (result: { error?: { type?: string } }) => result.error?.type === 'aborted'

export const useWebSwapController = (): WebSwapControllerProps => {
  const initialDesktop = typeof window !== 'undefined' ? window.innerWidth >= 768 : true
  const [state, dispatch] = useReducer(reducer, createInitialState(initialDesktop))
  const { t } = useTranslate()
  const { addNotice, clearNotices } = useNotices()
  const { kit, setKycUrl, walletAuthentication } = useWalletAuth()

  const lastEditedRef = useRef<'source' | 'target' | null>(null)
  const directAbortRef = useRef<AbortController | null>(null)
  const reverseAbortRef = useRef<AbortController | null>(null)
  const directReqIdRef = useRef(0)
  const reverseReqIdRef = useRef(0)
  const decodeAbortRef = useRef<AbortController | null>(null)

  const targetLocale = useMemo(
    () => (state.targetCurrency === TargetCurrency.BRL ? 'pt-BR' : 'es-CO'),
    [state.targetCurrency],
  )
  const targetSymbol = state.targetCurrency === TargetCurrency.BRL ? 'R$' : '$'
  const targetPaymentMethod = state.targetCurrency === TargetCurrency.BRL ? PaymentMethod.PIX : PaymentMethod.BREB
  const transferFee = state.targetCurrency === TargetCurrency.BRL ? BRL_TRANSFER_FEE : COP_TRANSFER_FEE

  const formatTargetNumber = useCallback((value: number, decimals = 2) => new Intl.NumberFormat(targetLocale, {
    maximumFractionDigits: decimals,
    minimumFractionDigits: decimals,
  }).format(value), [targetLocale])

  const notifyError = useCallback((message: string, description?: string) => {
    clearNotices()
    addNotice(formatError(message, description))
  }, [addNotice, clearNotices])

  const exchangeRateDisplay = useMemo(() => {
    if (state.unitRate) {
      return state.unitRate
    }
    if (state.loadingSource || state.loadingTarget) return '-'
    const numericSource = Number.parseFloat(state.sourceAmount)
    const cleanedTarget = state.targetAmount.replaceAll('.', '').replaceAll(',', '.')
    const numericTarget = Number.parseFloat(cleanedTarget)
    if (numericSource > 0 && !Number.isNaN(numericTarget) && numericTarget >= 0) {
      return formatTargetNumber((numericTarget + transferFee) / numericSource, 2)
    }
    return '-'
  }, [
    formatTargetNumber,
    state.loadingSource,
    state.loadingTarget,
    state.sourceAmount,
    state.targetAmount,
    state.unitRate,
    transferFee,
  ])

  const transferFeeDisplay = useMemo(() => `${targetSymbol}${formatTargetNumber(transferFee, 2)}`, [
    formatTargetNumber,
    targetSymbol,
    transferFee,
  ])

  const isAuthenticated = Boolean(walletAuthentication?.jwtToken)
  const isWalletConnected = Boolean(kit?.address)

  const isPrimaryDisabled = useCallback(() => {
    const numericSource = Number.parseFloat(String(state.sourceAmount))
    const cleanedTarget = String(state.targetAmount).replaceAll('.', '').replaceAll(',', '.')
    const numericTarget = Number.parseFloat(cleanedTarget)
    return !(numericSource > 0 && numericTarget > 0)
  }, [state.sourceAmount, state.targetAmount])

  const isBelowMinimum = useMemo(() => {
    const cleanedTarget = String(state.targetAmount).replaceAll('.', '').replaceAll(',', '.')
    const numericTarget = Number.parseFloat(cleanedTarget)
    if (numericTarget <= 0) return false

    if (state.targetCurrency === TargetCurrency.COP) return numericTarget < 5000
    if (state.targetCurrency === TargetCurrency.BRL) return numericTarget < 1
    return false
  }, [state.targetAmount, state.targetCurrency])

  const hasInsufficientFunds = useMemo(() => {
    const numericSource = Number.parseFloat(state.sourceAmount || '0')
    const numericBalance = Number.parseFloat(state.usdcBalance || '0')
    return isAuthenticated && state.usdcBalance !== '' && numericSource > numericBalance
  }, [isAuthenticated, state.sourceAmount, state.usdcBalance])

  const continueDisabled = useMemo(() => {
    if (!isAuthenticated || !isWalletConnected) return false
    return isPrimaryDisabled() || !state.quoteId || isBelowMinimum || hasInsufficientFunds
  }, [
    isAuthenticated,
    isWalletConnected,
    isPrimaryDisabled,
    state.quoteId,
    isBelowMinimum,
    hasInsufficientFunds,
  ])

  const persistableView = state.view !== 'swap'

  useEffect(() => {
    if (!persistableView) {
      localStorage.removeItem(PENDING_TX_KEY)
      return
    }
    persistState(state)
  }, [persistableView, state])

  useEffect(() => {
    const stored = readPersisted()
    if (stored && walletAuthentication?.jwtToken) {
      dispatch({
        payload: {
          accountNumber: stored.accountNumber ?? '',
          pixKey: stored.pixKey ?? '',
          quoteId: stored.quoteId ?? '',
          recipientName: stored.recipientName ?? '',
          sourceAmount: stored.sourceAmount ?? '',
          targetAmount: stored.targetAmount ?? '',
          targetCurrency: stored.targetCurrency ?? TargetCurrency.BRL,
          taxId: stored.taxId ?? '',
          view: stored.view ?? 'bankDetails',
        },
        type: 'HYDRATE',
      })
    }
  }, [walletAuthentication?.jwtToken])

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

  // Fetch USDC balance when wallet is connected
  useEffect(() => {
    const fetchBalance = async () => {
      if (!isWalletConnected || !kit?.address) {
        dispatch({ type: 'SET_USDC_BALANCE', usdcBalance: '' })
        return
      }
      dispatch({ loadingBalance: true, type: 'SET_LOADING_BALANCE' })
      try {
        const account = await HORIZON_SERVER.loadAccount(kit.address)
        const usdcAsset = account.balances.find(
          (b): b is Horizon.HorizonApi.BalanceLineAsset =>
            'asset_code' in b &&
            b.asset_code === 'USDC' &&
            b.asset_issuer === 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
        )
        const balance = usdcAsset?.balance ?? '0'
        dispatch({ type: 'SET_USDC_BALANCE', usdcBalance: balance })
      } catch {
        dispatch({ type: 'SET_USDC_BALANCE', usdcBalance: '' })
      } finally {
        dispatch({ loadingBalance: false, type: 'SET_LOADING_BALANCE' })
      }
    }
    fetchBalance()
  }, [isWalletConnected, kit?.address])

  // Fetch unit rate (1 USDC) when targetCurrency changes
  useEffect(() => {
    const fetchUnitRate = async () => {
      dispatch({ type: 'SET_UNIT_RATE', unitRate: '' })

      const tryFetch = async (amount: number) => {
        return await getReverseQuote({
          crypto_currency: CryptoCurrency.USDC,
          network: BlockchainNetwork.STELLAR,
          payment_method: targetPaymentMethod,
          source_amount: amount,
          target_currency: state.targetCurrency,
        }) as ReverseQuoteApiResponse
      }

      let response = await tryFetch(1)

      // Fallback: If 1 USDC fails (e.g. COP min is ~$5000 COP), try with 10 USDC
      if (response.status !== 200) {
        const fallbackResponse = await tryFetch(10)
        if (fallbackResponse.status === 200) {
          const quote = fallbackResponse.data
          const unitValue = quote.value / 10
          dispatch({ type: 'SET_UNIT_RATE', unitRate: formatTargetNumber(unitValue) })
          return
        }
      }

      if (response.status === 200) {
        const quote = response.data
        const formatted = formatTargetNumber(quote.value)
        dispatch({ type: 'SET_UNIT_RATE', unitRate: formatted })
      }
    }
    fetchUnitRate()
  }, [state.targetCurrency, formatTargetNumber, targetPaymentMethod])

  const handleQuoteError = useCallback((
    response: ApiClientResponse<any, any>,
    inputValue: string,
    mode: 'source' | 'target',
    manualCalculation?: (val: number, rate: number) => number,
  ) => {
    if (isAbortError(response)) return

    const reason = extractReason(response.data) || response.error?.message || t('swap.quote_error', 'Esta cotización superó el monto máximo permitido.')

    // Suppress validation error if it is the minimum amount error or too small (UX Feature)
    const isMinAmountError =
      reason?.toLowerCase().includes('minimum allowed amount') ||
      reason?.toLowerCase().includes('too small') ||
      reason?.toLowerCase().includes('too_small') ||
      (response.status === 400 && (reason?.toLowerCase().includes('amount') || reason?.toLowerCase().includes('too_small')))

    if (!isMinAmountError) {
      notifyError(reason, response.error?.message)
      // Clear the OTHER field
      if (mode === 'source') dispatch({ quoteId: '', targetAmount: '', type: 'SET_AMOUNTS' })
      else dispatch({ quoteId: '', sourceAmount: '', type: 'SET_AMOUNTS' })
      return
    }

    if (state.unitRate && manualCalculation) {
      // Manual calculation fallback to show estimated conversion even if below minimum
      const unitRateValue = Number.parseFloat(state.unitRate.replaceAll('.', '').replaceAll(',', '.'))
      const inputNum = Number.parseFloat(inputValue.replaceAll('.', '').replaceAll(',', '.'))

      if (unitRateValue > 0 && inputNum > 0) {
        const calculated = manualCalculation(inputNum, unitRateValue)
        if (mode === 'source') {
          dispatch({
            quoteId: '',
            sourceAmount: inputValue,
            targetAmount: formatTargetNumber(calculated, 2),
            type: 'SET_AMOUNTS',
          })
        } else {
          dispatch({
            quoteId: '',
            sourceAmount: calculated.toFixed(2),
            targetAmount: inputValue,
            type: 'SET_AMOUNTS',
          })
        }
      }
      return
    }

    // No unit rate yet, clear other field
    if (mode === 'source') dispatch({ quoteId: '', targetAmount: '', type: 'SET_AMOUNTS' })
    else dispatch({ quoteId: '', sourceAmount: '', type: 'SET_AMOUNTS' })
  }, [dispatch, notifyError, state.unitRate, formatTargetNumber, t])

  const quoteFromSource = useCallback(async (value: string) => {
    lastEditedRef.current = 'source'
    directAbortRef.current?.abort()
    reverseAbortRef.current?.abort()
    const controller = new AbortController()
    directAbortRef.current = controller
    const reqId = ++directReqIdRef.current

    const num = Number.parseFloat(value)
    if (Number.isNaN(num)) {
      dispatch({
        quoteId: '', sourceAmount: value, targetAmount: '', type: 'SET_AMOUNTS',
      })
      dispatch({ loadingTarget: false, type: 'SET_LOADING' })
      return
    }

    dispatch({ loadingTarget: true, type: 'SET_LOADING' })
    dispatch({ quoteId: '', type: 'SET_AMOUNTS' })
    const response = await getReverseQuote(
      {
        crypto_currency: CryptoCurrency.USDC,
        network: BlockchainNetwork.STELLAR,
        payment_method: targetPaymentMethod,
        source_amount: num,
        target_currency: state.targetCurrency,
      },
      { signal: controller.signal },
    ) as ReverseQuoteApiResponse

    if (controller.signal.aborted || reqId !== directReqIdRef.current || lastEditedRef.current !== 'source') return

    if (response.status !== 200) {
      handleQuoteError(response, value, 'source', (input, rate) => input * rate)
      dispatch({ loadingTarget: false, type: 'SET_LOADING' })
      return
    }

    const quote = response.data
    dispatch({
      quoteId: quote.quote_id,
      sourceAmount: value,
      targetAmount: formatTargetNumber(quote.value, 2),
      type: 'SET_AMOUNTS',
    })
    dispatch({ loadingTarget: false, type: 'SET_LOADING' })
  }, [
    handleQuoteError,
    formatTargetNumber,
    state.targetCurrency,
    targetPaymentMethod,
  ])

  const quoteFromTarget = useCallback(async (value: string) => {
    lastEditedRef.current = 'target'
    reverseAbortRef.current?.abort()
    directAbortRef.current?.abort()

    const controller = new AbortController()
    reverseAbortRef.current = controller
    const reqId = ++reverseReqIdRef.current
    const normalized = value.replaceAll('.', '').replaceAll(',', '.')
    const num = Number.parseFloat(normalized)
    if (Number.isNaN(num)) {
      dispatch({
        quoteId: '', sourceAmount: '', targetAmount: value, type: 'SET_AMOUNTS',
      })
      dispatch({ loadingSource: false, type: 'SET_LOADING' })
      return
    }

    dispatch({ loadingSource: true, type: 'SET_LOADING' })
    dispatch({ quoteId: '', type: 'SET_AMOUNTS' })
    const response = await getQuote(
      {
        amount: num,
        crypto_currency: CryptoCurrency.USDC,
        network: BlockchainNetwork.STELLAR,
        payment_method: targetPaymentMethod,
        target_currency: state.targetCurrency,
      },
      { signal: controller.signal },
    ) as QuoteApiResponse

    if (controller.signal.aborted || reqId !== reverseReqIdRef.current || lastEditedRef.current !== 'target') return

    if (response.status !== 200) {
      handleQuoteError(response, value, 'target', (input, rate) => input / rate)
      dispatch({ loadingSource: false, type: 'SET_LOADING' })
      return
    }

    const quote = response.data
    dispatch({
      quoteId: quote.quote_id,
      sourceAmount: quote.value.toFixed(2),
      targetAmount: value,
      type: 'SET_AMOUNTS',
    })
    dispatch({ loadingSource: false, type: 'SET_LOADING' })
  }, [
    handleQuoteError,
    state.targetCurrency,
    targetPaymentMethod,
  ])

  const onSourceChange = useCallback((val: string) => {
    const sanitized = val.replaceAll(/[^0-9.]/g, '')
    dispatch({ sourceAmount: sanitized, type: 'SET_AMOUNTS' })
    quoteFromSource(sanitized)
  }, [quoteFromSource])

  const onTargetChange = useCallback((val: string) => {
    // Standard decoration logic: integer dots, preserve comma if typing
    const digits = val.replaceAll(/[^0-9,]/g, '')
    const parts = digits.split(',')
    if (parts[0]) {
      // Format with thousands separator using helper function
      parts[0] = formatWithThousandsSeparator(parts[0])
    }
    const formatted = parts.join(',')

    dispatch({ targetAmount: formatted, type: 'SET_AMOUNTS' })
    quoteFromTarget(formatted)
  }, [quoteFromTarget])

  const openQr = useCallback(() => {
    if (!isAuthenticated) {
      kit?.connect()
      return
    }
    dispatch({ isQrOpen: true, type: 'SET_QR_OPEN' })
    dispatch({ targetCurrency: TargetCurrency.BRL, type: 'SET_TARGET_CURRENCY' })
  }, [isAuthenticated, kit])

  const currencyMenuRef = useRef<HTMLDivElement | null>(null)
  const skipNextDocumentClickRef = useRef(false)
  const [currencyMenuOpen, setCurrencyMenuOpen] = useReducer((s: boolean) => !s, false)

  const toggleCurrencyMenu = useCallback(() => {
    setCurrencyMenuOpen()
    if (!currencyMenuOpen) {
      skipNextDocumentClickRef.current = true
    }
  }, [currencyMenuOpen])

  const selectCurrency = useCallback((currency: TargetCurrency) => {
    setCurrencyMenuOpen()
    dispatch({ type: 'RESET' })
    dispatch({ targetCurrency: currency, type: 'SET_TARGET_CURRENCY' })
    lastEditedRef.current = null
    directAbortRef.current?.abort()
    reverseAbortRef.current?.abort()
  }, [])

  useEffect(() => {
    if (!currencyMenuOpen) return
    const onDocumentClick = (event: MouseEvent) => {
      if (skipNextDocumentClickRef.current) {
        skipNextDocumentClickRef.current = false
        return
      }
      const container = currencyMenuRef.current
      if (!container) return
      const path = (event as unknown as { composedPath?: () => EventTarget[] }).composedPath?.()
      const clickedInside = path ? path.includes(container) : container.contains(event.target as Node)
      if (!clickedInside) setCurrencyMenuOpen()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setCurrencyMenuOpen()
    }
    document.addEventListener('click', onDocumentClick)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('click', onDocumentClick)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [currencyMenuOpen])

  const handleBackToSwap = useCallback(() => {
    localStorage.removeItem(PENDING_TX_KEY)
    dispatch({ type: 'RESET' })
    dispatch({ isQrOpen: false, type: 'SET_QR_OPEN' })
    dispatch({ type: 'SET_VIEW', view: 'swap' })
  }, [])

  const resetForNewTransaction = useCallback(() => {
    localStorage.removeItem(PENDING_TX_KEY)
    dispatch({ type: 'RESET' })
    dispatch({ isQrOpen: false, type: 'SET_QR_OPEN' })
    dispatch({ transactionId: null, type: 'SET_TRANSACTION_ID' })
    dispatch({ type: 'SET_VIEW', view: 'swap' })
  }, [])

  const onPrimaryAction = useCallback(async () => {
    // Always connect wallet first if either wallet or auth is missing
    if (!isAuthenticated || !isWalletConnected) {
      await kit?.connect()
      return
    }
    if (!state.quoteId) {
      notifyError(t('swap.wait_for_quote', 'Espera la cotización antes de continuar'))
      return
    }
    dispatch({ type: 'SET_VIEW', view: 'bankDetails' })
  }, [
    isAuthenticated,
    isWalletConnected,
    kit,
    notifyError,
    state.quoteId,
    t,
  ])

  const currentBgUrl = state.targetCurrency === TargetCurrency.BRL ? BRL_BACKGROUND_IMAGE : ASSET_URLS.BACKGROUND_IMAGE

  const handleWalletDetailsOpen = useCallback(() => dispatch({ isWalletDetailsOpen: true, type: 'SET_WALLET_DETAILS_OPEN' }), [])
  const handleWalletDetailsClose = useCallback(() => dispatch({ isWalletDetailsOpen: false, type: 'SET_WALLET_DETAILS_OPEN' }), [])

  const handleQrResult = useCallback(async (text: string) => {
    dispatch({ isQrOpen: false, type: 'SET_QR_OPEN' })
    dispatch({ isDecodingQr: true, type: 'SET_DECODING' })
    dispatch({ qrCode: text, type: 'SET_QR_CODE' })
    decodeAbortRef.current?.abort()
    const controller = new AbortController()
    decodeAbortRef.current = controller
    try {
      const response = await decodeQrCodeBR({ qrCode: text }, { signal: controller.signal }) as DecodeQrApiResponse
      if (controller.signal.aborted) return
      if (response.status !== 200) {
        if (!isAbortError(response)) {
          const reason = extractReason(response.data) || response.error?.message || t('swap.qr_decode_error', 'No pudimos decodificar este QR.')
          notifyError(reason, response.error?.message)
        }
        return
      }
      const amount = response.data?.decoded?.amount
      const pixKey = response.data.decoded?.account
      const taxIdDecoded = response.data.decoded?.taxId
      const name = response.data.decoded?.name

      if (name) dispatch({ recipientName: name, type: 'SET_BANK_DETAILS' })
      if (pixKey) dispatch({ pixKey, type: 'SET_BANK_DETAILS' })
      if (taxIdDecoded && !taxIdDecoded.includes('*')) dispatch({ taxId: taxIdDecoded, type: 'SET_BANK_DETAILS' })

      if (typeof amount === 'string' && Number.parseFloat(amount) > 0) {
        dispatch({ targetAmount: amount, type: 'SET_AMOUNTS' })
        await quoteFromTarget(amount)
        dispatch({ type: 'SET_VIEW', view: 'confirm-qr' })
      }
    }
    catch (e) {
      if (!controller.signal.aborted) {
        notifyError(t('swap.qr_decode_error', 'No pudimos decodificar este QR.'), e instanceof Error ? e.message : undefined)
      }
    }
    finally {
      dispatch({ isDecodingQr: false, type: 'SET_DECODING' })
    }
  }, [
    notifyError,
    quoteFromTarget,
    t,
  ])

  const buildPaymentXdr = useCallback(async ({
    amount,
    asset,
    destination,
    memoValue,
    source,
  }: {
    amount: string
    asset: Asset
    destination: string
    memoValue: string
    source: string
  }): Promise<string> => {
    const account = await HORIZON_SERVER.loadAccount(source)
    const fee = await HORIZON_SERVER.fetchBaseFee()
    const tx = new TransactionBuilder(account, {
      fee: String(fee || BASE_FEE),
      networkPassphrase: NETWORK_PASSPHRASE,
    })
      .addOperation(
        Operation.payment({
          amount,
          asset,
          destination,
        }),
      )
      .addMemo(Memo.text(memoValue))
      .setTimeout(180)
      .build()
    return tx.toXDR()
  }, [])

  const handleTransactionFlow = useCallback(async () => {
    dispatch({ loadingSubmit: true, type: 'SET_SUBMITTING' })
    try {
      if (!state.quoteId || !kit?.address) throw new Error(t('swap.errors.missing_quote', 'Falta la cotización o la dirección de la billetera.'))

      const redirectUrl = encodeURIComponent(
        window.location.href.replace(/^https?:\/\//, ''),
      )
      const isBrazil = state.targetCurrency === TargetCurrency.BRL

      const response = await acceptTransaction({
        account_number:
          isBrazil ? state.pixKey : state.accountNumber.trim(),
        qr_code: state.qrCode,
        quote_id: state.quoteId,
        redirectUrl,
        tax_id: isBrazil ? state.taxId : undefined,
        user_id: kit.address,
      }) as AcceptTransactionApiResponse

      if (response.status !== 200) {
        if (!isAbortError(response)) {
          const reason = extractReason(response.data) || response.error?.message || t('swap.accept_error', 'No pudimos iniciar la transacción.')
          notifyError(reason, response.error?.message)
        }
        return
      }

      const { id: acceptedTxId, kycLink, transaction_reference } = response.data

      const stellarAccount = import.meta.env.VITE_ABROAD_STELLAR_ADDRESS
      const assetCode = 'USDC'
      const assetIssuer = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN'

      if (kycLink) {
        setKycUrl(kycLink)
        dispatch({ type: 'SET_VIEW', view: 'kyc-needed' })
        return
      }

      if (!acceptedTxId) {
        notifyError(t('swap.accept_error', 'No pudimos iniciar la transacción.'))
        resetForNewTransaction()
        return
      }

      localStorage.removeItem(PENDING_TX_KEY)

      if (kit.walletId === 'sep24') {
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

        // UX Improvement: Notify parent (Vesseo) via postMessage
        // This allows the container app to handle the success screen immediately
        const targetOrigin = import.meta.env.VITE_VESSEO_ORIGIN || 'https://app.vesseo.com'
        window.parent.postMessage({
          type: 'transaction_completed',
          status: 'success',
          transaction_id: acceptedTxId,
          sep_transaction_id: sepTransactionId,
          amount_in: state.sourceAmount,
          amount_out: state.targetAmount,
          currency_out: state.targetCurrency,
        }, targetOrigin)

        // Slight delay to ensure message is processed if the app relies on it
        // before the redirect potentially unloads the page
        setTimeout(() => {
          window.location.href = url
        }, 1000)

        return
      }

      const paymentAsset = new Asset(assetCode, assetIssuer)
      if (!kit.address) {
        throw new Error('Wallet address is not available.')
      }
      const unsignedXdr = await buildPaymentXdr({
        amount: state.sourceAmount,
        asset: paymentAsset,
        destination: stellarAccount,
        memoValue: transaction_reference ?? '',
        source: kit.address,
      })

      dispatch({ type: 'SET_VIEW', view: 'wait-sign' })
      const { signedTxXdr } = await kit.signTransaction({ message: unsignedXdr })
      dispatch({ transactionId: acceptedTxId || null, type: 'SET_TRANSACTION_ID' })
      dispatch({ type: 'SET_VIEW', view: 'txStatus' })

      const tx = new Transaction(signedTxXdr, NETWORK_PASSPHRASE)
      await HORIZON_SERVER.submitTransaction(tx)
    }
    catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return
      const userMessage = err instanceof Error
        ? err.message
        : hasMessage(err)
          ? err.message
          : t('swap.transaction_error', 'Error en la transacción')
      notifyError(userMessage)
      resetForNewTransaction()
    }
    finally {
      dispatch({ loadingSubmit: false, type: 'SET_SUBMITTING' })
    }
  }, [
    buildPaymentXdr,
    kit,
    notifyError,
    resetForNewTransaction,
    setKycUrl,
    state.accountNumber,
    state.pixKey,
    state.qrCode,
    state.quoteId,
    state.sourceAmount,
    state.targetCurrency,
    state.taxId,
    t,
  ])

  const handleConfirmQr = useCallback(() => {
    if (!state.targetAmount || !state.sourceAmount) {
      notifyError(t('confirm_qr.missing_amount', 'Faltan los montos para continuar.'))
      dispatch({ type: 'SET_VIEW', view: 'swap' })
      return
    }
    if (state.targetCurrency === TargetCurrency.BRL && (!state.taxId || !state.pixKey)) {
      notifyError(t('confirm_qr.missing_data', 'Faltan datos para completar la transacción.'))
      dispatch({ type: 'SET_VIEW', view: 'bankDetails' })
      return
    }
    handleTransactionFlow()
  }, [
    handleTransactionFlow,
    notifyError,
    state.pixKey,
    state.sourceAmount,
    state.targetAmount,
    state.targetCurrency,
    state.taxId,
    t,
  ])

  const bankDetailsContinueDisabled = useMemo(() => {
    if (state.targetCurrency === TargetCurrency.BRL) {
      return !(state.pixKey && state.taxId)
    }
    return state.accountNumber.trim().length < 6
  }, [
    state.accountNumber,
    state.pixKey,
    state.targetCurrency,
    state.taxId,
  ])

  const bankDetailsProps: BankDetailsRouteProps = {
    accountNumber: state.accountNumber,
    continueDisabled: bankDetailsContinueDisabled,
    onAccountNumberChange: (value: string) => {
      const input = value.trim().slice(0, 64)
      dispatch({ accountNumber: input, type: 'SET_BANK_DETAILS' })
    },
    onBackClick: handleBackToSwap,
    onContinue: () => dispatch({ type: 'SET_VIEW', view: 'confirm-qr' }),
    onPixKeyChange: (value: string) => dispatch({ pixKey: value, type: 'SET_BANK_DETAILS' }),
    onTaxIdChange: (value: string) => {
      const input = value.replace(/[^\d]/g, '')
      dispatch({ taxId: input, type: 'SET_BANK_DETAILS' })
    },
    pixKey: state.pixKey,
    targetAmount: state.targetAmount,
    targetCurrency: state.targetCurrency,
    taxId: state.taxId,
    textColor: state.isDesktop ? 'white' : '#356E6A',
  }

  const swapProps: SwapProps = {
    continueDisabled,
    currencyMenuOpen,
    currencyMenuRef,
    exchangeRateDisplay,
    isAuthenticated,
    isBelowMinimum,
    hasInsufficientFunds,
    isWalletConnected,
    loadingBalance: state.loadingBalance,
    loadingSource: state.loadingSource,
    loadingTarget: state.loadingTarget,
    onPrimaryAction,
    onSourceChange,
    onTargetChange,
    openQr,
    selectCurrency,
    sourceAmount: state.sourceAmount,
    targetAmount: state.targetAmount,
    targetCurrency: state.targetCurrency,
    targetSymbol,
    textColor: state.isDesktop ? 'white' : '#356E6A',
    toggleCurrencyMenu,
    transferFeeDisplay,
    usdcBalance: state.usdcBalance,
  }

  const confirmQrProps: ConfirmQrProps = {
    currency: state.targetCurrency,
    loadingSubmit: state.loadingSubmit,
    onBack: handleBackToSwap,
    onConfirm: handleConfirmQr,
    onEdit: () => dispatch({ type: 'SET_VIEW', view: 'swap' }),
    pixKey: state.pixKey,
    recipentName: state.recipientName,
    sourceAmount: state.sourceAmount,
    targetAmount: state.targetAmount,
    taxId: state.taxId,
  }

  const handleKycApproved = useCallback(() => {
    dispatch({ type: 'SET_VIEW', view: 'confirm-qr' })
  }, [])

  return {
    bankDetailsProps,
    closeQr: () => dispatch({ isQrOpen: false, type: 'SET_QR_OPEN' }),
    confirmQrProps,
    currentBgUrl,
    handleBackToSwap,
    handleKycApproved,
    handleQrResult,
    handleWalletDetailsClose,
    handleWalletDetailsOpen,
    isDecodingQr: state.isDecodingQr,
    isQrOpen: state.isQrOpen,
    isWalletDetailsOpen: state.isWalletDetailsOpen,
    resetForNewTransaction,
    swapViewProps: swapProps,
    targetAmount: state.targetAmount,
    targetCurrency: state.targetCurrency,
    transactionId: state.transactionId,
    view: state.view,
  }
}



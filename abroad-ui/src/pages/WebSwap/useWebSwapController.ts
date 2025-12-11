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

import type { BankDetailsRouteProps } from '../../features/swap/components/BankDetailsRoute'
import type { ConfirmQrProps } from '../../features/swap/components/ConfirmQr'
import type { SwapProps } from '../../features/swap/components/Swap'
import type { Option } from '../../shared/components/DropSelector'
import type { WebSwapControllerProps } from './WebSwap'

import {
  acceptTransaction,
  Bank,
  _36EnumsBlockchainNetwork as BlockchainNetwork,
  _36EnumsCryptoCurrency as CryptoCurrency,
  decodeQrCodeBR,
  getBanks,
  getQuote,
  getReverseQuote,
  _36EnumsPaymentMethod as PaymentMethod,
  _36EnumsTargetCurrency as TargetCurrency,
} from '../../api'
import { useNotices } from '../../contexts/NoticeContext'
import { BANK_CONFIG, BRL_BACKGROUND_IMAGE } from '../../features/swap/constants'
import { SwapView } from '../../features/swap/types'
import { ASSET_URLS, PENDING_TX_KEY } from '../../shared/constants'
import { useWalletAuth } from '../../shared/hooks/useWalletAuth'
import { hasMessage } from '../../shared/utils'

type SwapAction
  = | { accountNumber?: string, bankCode?: string, pixKey?: string, recipientName?: string, taxId?: string, type: 'SET_BANK_DETAILS' }
    | { bankOpen?: boolean, selectedBank?: null | Option, type: 'SET_BANK_UI' }
    | { bankOptions?: Option[], errorBanks?: null | string, loadingBanks?: boolean, type: 'SET_BANK_META' }
    | { isDecodingQr: boolean, type: 'SET_DECODING' }
    | { isDesktop: boolean, type: 'SET_DESKTOP' }
    | { isQrOpen: boolean, type: 'SET_QR_OPEN' }
    | { isWalletDetailsOpen: boolean, type: 'SET_WALLET_DETAILS_OPEN' }
    | { loadingSource?: boolean, loadingTarget?: boolean, type: 'SET_LOADING' }
    | { loadingSubmit: boolean, type: 'SET_SUBMITTING' }
    | { payload: Partial<SwapControllerState>, type: 'HYDRATE' }
    | { qrCode: null | string, type: 'SET_QR_CODE' }
    | { quoteId?: string, sourceAmount?: string, targetAmount?: string, type: 'SET_AMOUNTS' }
    | { targetCurrency: TargetCurrency, type: 'SET_TARGET_CURRENCY' }
    | { transactionId: null | string, type: 'SET_TRANSACTION_ID' }
    | { type: 'RESET' }
    | { type: 'SET_VIEW', view: SwapView }

type SwapControllerState = {
  accountNumber: string
  bankCode: string
  bankOpen: boolean
  bankOptions: Option[]
  errorBanks: null | string
  isDecodingQr: boolean
  isDesktop: boolean
  isQrOpen: boolean
  isWalletDetailsOpen: boolean
  loadingBanks: boolean
  loadingSource: boolean
  loadingSubmit: boolean
  loadingTarget: boolean
  pixKey: string
  qrCode: null | string
  quoteId: string
  recipientName: string
  selectedBank: null | Option
  sourceAmount: string
  targetAmount: string
  targetCurrency: TargetCurrency
  taxId: string
  transactionId: null | string
  view: SwapView
}

const COP_TRANSFER_FEE = 0.0
const BRL_TRANSFER_FEE = 0.0
const NETWORK_PASSPHRASE = Networks.PUBLIC
const HORIZON_SERVER = new Horizon.Server('https://horizon.stellar.org')
const EXCLUDED_BANKS = [
  'CFA COOPERATIVA FINANCIERA',
  'CONFIAR COOPERATIVA FINANCIERA',
  'BANCOCOOPCENTRAL',
  'BANCO SERFINANZA',
  'BANCO FINANDINA',
  'BANCO CREZCAMOS',
  'BANCO POWWI',
  'SUPERDIGITAL',
  'BANCAMIA',
]

const createInitialState = (isDesktop: boolean): SwapControllerState => ({
  accountNumber: '',
  bankCode: '',
  bankOpen: false,
  bankOptions: [],
  errorBanks: null,
  isDecodingQr: false,
  isDesktop,
  isQrOpen: false,
  isWalletDetailsOpen: false,
  loadingBanks: false,
  loadingSource: false,
  loadingSubmit: false,
  loadingTarget: false,
  pixKey: '',
  qrCode: null,
  quoteId: '',
  recipientName: '',
  selectedBank: null,
  sourceAmount: '',
  targetAmount: '',
  targetCurrency: TargetCurrency.BRL,
  taxId: '',
  transactionId: null,
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
        bankCode: action.bankCode ?? state.bankCode,
        pixKey: action.pixKey ?? state.pixKey,
        recipientName: action.recipientName ?? state.recipientName,
        taxId: action.taxId ?? state.taxId,
      }
    case 'SET_BANK_META':
      return {
        ...state,
        bankOptions: action.bankOptions ?? state.bankOptions,
        errorBanks: action.errorBanks ?? state.errorBanks,
        loadingBanks: action.loadingBanks ?? state.loadingBanks,
      }
    case 'SET_BANK_UI':
      return {
        ...state,
        bankOpen: action.bankOpen ?? state.bankOpen,
        selectedBank: action.selectedBank ?? state.selectedBank,
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
    default:
      return state
  }
}

type PersistedSwap = {
  accountNumber?: string
  bankCode?: string
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
    bankCode: state.bankCode,
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

const buildBankOptions = (banks: Bank[]): Option[] => {
  const priorityBanks = [
    'BANCOLOMBIA',
    'DAVIPLATA',
    'DAVIVIENDA',
    'NEQUI',
  ]
  return banks
    .filter(bank => !EXCLUDED_BANKS.includes(bank.bankName.toUpperCase()))
    .map((bank) => {
      const bankNameUpper = bank.bankName.toUpperCase()
      const config = BANK_CONFIG[bankNameUpper]
      return {
        iconUrl: config?.iconUrl,
        label: config?.displayLabel || bank.bankName,
        value: String(bank.bankCode),
      }
    })
    .sort((a, b) => {
      const aIsPriority = priorityBanks.some(priority => a.label.toUpperCase().includes(priority))
      const bIsPriority = priorityBanks.some(priority => b.label.toUpperCase().includes(priority))
      if (aIsPriority && bIsPriority) {
        const aIndex = priorityBanks.findIndex(priority => a.label.toUpperCase().includes(priority))
        const bIndex = priorityBanks.findIndex(priority => b.label.toUpperCase().includes(priority))
        return aIndex - bIndex
      }
      if (aIsPriority && !bIsPriority) return -1
      if (!aIsPriority && bIsPriority) return 1
      return a.label.localeCompare(b.label)
    })
}

const extractReason = (body: unknown): null | string => {
  if (body && typeof body === 'object' && 'reason' in body) {
    const reason = (body as { reason?: unknown }).reason
    if (typeof reason === 'string') return reason
  }
  return null
}

const isAbortError = (result: { error: { type: string }, ok: boolean }) => !result.ok && result.error.type === 'aborted'

export const useWebSwapController = (): WebSwapControllerProps => {
  const initialDesktop = typeof window !== 'undefined' ? window.innerWidth >= 768 : true
  const [state, dispatch] = useReducer(reducer, createInitialState(initialDesktop))
  const { t } = useTranslate()
  const { addNotice } = useNotices()
  const { kit, setKycUrl, walletAuthentication } = useWalletAuth()

  const lastEditedRef = useRef<'source' | 'target' | null>(null)
  const directAbortRef = useRef<AbortController | null>(null)
  const reverseAbortRef = useRef<AbortController | null>(null)
  const directReqIdRef = useRef(0)
  const reverseReqIdRef = useRef(0)
  const decodeAbortRef = useRef<AbortController | null>(null)
  const banksAbortRef = useRef<AbortController | null>(null)

  const targetLocale = useMemo(
    () => (state.targetCurrency === TargetCurrency.BRL ? 'pt-BR' : 'es-CO'),
    [state.targetCurrency],
  )
  const targetSymbol = state.targetCurrency === TargetCurrency.BRL ? 'R$' : '$'
  const targetPaymentMethod = state.targetCurrency === TargetCurrency.BRL ? PaymentMethod.PIX : PaymentMethod.MOVII
  const transferFee = state.targetCurrency === TargetCurrency.BRL ? BRL_TRANSFER_FEE : COP_TRANSFER_FEE

  const formatTargetNumber = useCallback((value: number) => new Intl.NumberFormat(targetLocale, {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  }).format(value), [targetLocale])

  const notifyError = useCallback((message: string, description?: string) => {
    addNotice(formatError(message, description))
  }, [addNotice])

  const exchangeRateDisplay = useMemo(() => {
    if (state.loadingSource || state.loadingTarget) return '-'
    const numericSource = parseFloat(state.sourceAmount)
    const cleanedTarget = state.targetAmount.replace(/\./g, '').replace(/,/g, '.')
    const numericTarget = parseFloat(cleanedTarget)
    if (numericSource > 0 && !Number.isNaN(numericTarget) && numericTarget >= 0) {
      return `${targetSymbol}${formatTargetNumber((numericTarget + transferFee) / numericSource)}`
    }
    return '-'
  }, [
    formatTargetNumber,
    state.loadingSource,
    state.loadingTarget,
    state.sourceAmount,
    state.targetAmount,
    targetSymbol,
    transferFee,
  ])

  const transferFeeDisplay = useMemo(() => `${targetSymbol}${formatTargetNumber(transferFee)}`, [
    formatTargetNumber,
    targetSymbol,
    transferFee,
  ])

  const isAuthenticated = Boolean(walletAuthentication?.jwtToken)

  const isPrimaryDisabled = useCallback(() => {
    const numericSource = parseFloat(String(state.sourceAmount))
    const cleanedTarget = String(state.targetAmount).replace(/\./g, '').replace(/,/g, '.')
    const numericTarget = parseFloat(cleanedTarget)
    return !(numericSource > 0 && numericTarget > 0)
  }, [state.sourceAmount, state.targetAmount])

  const continueDisabled = useMemo(() => {
    if (!isAuthenticated) return false
    return isPrimaryDisabled() || !state.quoteId
  }, [
    isAuthenticated,
    isPrimaryDisabled,
    state.quoteId,
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
          bankCode: stored.bankCode ?? '',
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
      banksAbortRef.current?.abort()
    }
  }, [])

  const fetchBanks = useCallback(async () => {
    banksAbortRef.current?.abort()
    const controller = new AbortController()
    banksAbortRef.current = controller
    dispatch({ errorBanks: null, loadingBanks: true, type: 'SET_BANK_META' })
    try {
      const response = await getBanks(undefined, { signal: controller.signal })
      if (controller.signal.aborted) return
      if (response.ok) {
        dispatch({
          bankOptions: buildBankOptions(response.data.banks ?? []),
          loadingBanks: false,
          type: 'SET_BANK_META',
        })
      }
      else if (!isAbortError(response)) {
        const reason = extractReason(response.error.body)
        dispatch({
          errorBanks: reason || t('bank_details.error_banks', 'No se pudieron cargar los bancos'),
          loadingBanks: false,
          type: 'SET_BANK_META',
        })
      }
    }
    catch (err) {
      if (controller.signal.aborted) return
      dispatch({
        errorBanks: err instanceof Error ? err.message : t('bank_details.error_banks', 'No se pudieron cargar los bancos'),
        loadingBanks: false,
        type: 'SET_BANK_META',
      })
    }
    finally {
      if (!controller.signal.aborted) {
        banksAbortRef.current = null
      }
    }
  }, [t])

  useEffect(() => {
    if (state.targetCurrency !== TargetCurrency.COP) return
    void fetchBanks()
  }, [fetchBanks, state.targetCurrency])

  const quoteFromSource = useCallback(async (value: string) => {
    lastEditedRef.current = 'source'
    directAbortRef.current?.abort()
    reverseAbortRef.current?.abort()
    const controller = new AbortController()
    directAbortRef.current = controller
    const reqId = ++directReqIdRef.current

    const num = parseFloat(value)
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
    )

    if (controller.signal.aborted || reqId !== directReqIdRef.current || lastEditedRef.current !== 'source') return

    if (!response.ok) {
      if (!isAbortError(response)) {
        const reason = extractReason(response.error.body) || t('swap.quote_error', 'Esta cotización superó el monto máximo permitido.')
        notifyError(reason, response.error.message)
      }
      dispatch({ loadingTarget: false, type: 'SET_LOADING' })
      return
    }

    const formatted = formatTargetNumber(response.data.value)
    dispatch({
      quoteId: response.data.quote_id,
      sourceAmount: value,
      targetAmount: formatted,
      type: 'SET_AMOUNTS',
    })
    dispatch({ loadingTarget: false, type: 'SET_LOADING' })
  }, [
    formatTargetNumber,
    notifyError,
    state.targetCurrency,
    targetPaymentMethod,
    t,
  ])

  const quoteFromTarget = useCallback(async (value: string) => {
    lastEditedRef.current = 'target'
    reverseAbortRef.current?.abort()
    directAbortRef.current?.abort()

    const controller = new AbortController()
    reverseAbortRef.current = controller
    const reqId = ++reverseReqIdRef.current

    const raw = value.replace(/[^0-9.,]/g, '')
    const normalized = raw.replace(/\./g, '').replace(/,/g, '.')
    const num = parseFloat(normalized)
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
    )

    if (controller.signal.aborted || reqId !== reverseReqIdRef.current || lastEditedRef.current !== 'target') return

    if (!response.ok) {
      if (!isAbortError(response)) {
        const reason = extractReason(response.error.body) || t('swap.quote_error', 'Esta cotización superó el monto máximo permitido.')
        notifyError(reason, response.error.message)
      }
      dispatch({ loadingSource: false, type: 'SET_LOADING' })
      return
    }

    dispatch({
      quoteId: response.data.quote_id,
      sourceAmount: response.data.value.toFixed(2),
      targetAmount: value,
      type: 'SET_AMOUNTS',
    })
    dispatch({ loadingSource: false, type: 'SET_LOADING' })
  }, [
    notifyError,
    state.targetCurrency,
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
    dispatch({ targetAmount: sanitized, type: 'SET_AMOUNTS' })
    void quoteFromTarget(sanitized)
  }, [quoteFromTarget])

  const openQr = useCallback(() => {
    if (!isAuthenticated) {
      void kit?.connect()
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
    if (!isAuthenticated) {
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
      const response = await decodeQrCodeBR({ qrCode: text }, { signal: controller.signal })
      if (!response.ok) {
        if (!isAbortError(response)) {
          const reason = extractReason(response.error.body) || t('swap.qr_decode_error', 'No pudimos decodificar este QR.')
          notifyError(reason, response.error.message)
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

      if (typeof amount === 'string' && parseFloat(amount) > 0) {
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

      const response = await acceptTransaction({
        account_number:
          state.targetCurrency === TargetCurrency.BRL ? state.pixKey : state.accountNumber,
        bank_code: state.targetCurrency === TargetCurrency.BRL ? 'PIX' : state.bankCode,
        qr_code: state.qrCode,
        quote_id: state.quoteId,
        redirectUrl,
        tax_id: state.targetCurrency === TargetCurrency.BRL ? state.taxId : undefined,
        user_id: kit.address,
      })

      if (!response.ok) {
        if (!isAbortError(response)) {
          const reason = extractReason(response.error.body) || t('swap.accept_error', 'No pudimos iniciar la transacción.')
          notifyError(reason, response.error.message)
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

      localStorage.removeItem(PENDING_TX_KEY)

      if (kit.walletId === 'sep24') {
        const queryParams = new URLSearchParams(window.location.search)
        const callbackUrl = queryParams.get('callback')
        const sepTransactionId = queryParams.get('transaction_id')
        const sepBaseUrl = import.meta.env.VITE_SEP_BASE_URL || 'http://localhost:8000'
        let url = encodeURI(
          `${sepBaseUrl}/sep24/transactions/withdraw/interactive/complete?amount_expected=${state.sourceAmount}&transaction_id=${sepTransactionId}`,
        )
        if (callbackUrl && callbackUrl.toLowerCase() !== 'none') {
          url += `&callback=${encodeURIComponent(callbackUrl)}`
        }
        if (transaction_reference) {
          url += `&memo=${encodeURIComponent(transaction_reference)}`
        }
        window.location.href = url
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
    state.bankCode,
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
    void handleTransactionFlow()
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
    return (
      state.loadingBanks
      || !!state.errorBanks
      || !state.selectedBank
      || state.accountNumber.length !== 10
    )
  }, [
    state.accountNumber.length,
    state.errorBanks,
    state.loadingBanks,
    state.pixKey,
    state.selectedBank,
    state.targetCurrency,
    state.taxId,
  ])

  const bankDetailsProps: BankDetailsRouteProps = {
    accountNumber: state.accountNumber,
    bankOpen: state.bankOpen,
    bankOptions: state.bankOptions,
    continueDisabled: bankDetailsContinueDisabled,
    errorBanks: state.errorBanks,
    loadingBanks: state.loadingBanks,
    onAccountNumberChange: (value: string) => {
      const input = value.replace(/[^\d]/g, '').slice(0, 10)
      dispatch({ accountNumber: input, type: 'SET_BANK_DETAILS' })
    },
    onBackClick: handleBackToSwap,
    onContinue: () => dispatch({ type: 'SET_VIEW', view: 'confirm-qr' }),
    onPixKeyChange: (value: string) => dispatch({ pixKey: value, type: 'SET_BANK_DETAILS' }),
    onSelectBank: (option: Option) => {
      dispatch({ bankCode: option.value, type: 'SET_BANK_DETAILS' })
      dispatch({ selectedBank: option, type: 'SET_BANK_UI' })
    },
    onTaxIdChange: (value: string) => {
      const input = value.replace(/[^\d]/g, '')
      dispatch({ taxId: input, type: 'SET_BANK_DETAILS' })
    },
    pixKey: state.pixKey,
    selectedBank: state.selectedBank,
    setBankOpen: (open: boolean) => dispatch({ bankOpen: open, type: 'SET_BANK_UI' }),
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
    isDesktop: state.isDesktop,
    isQrOpen: state.isQrOpen,
    isWalletDetailsOpen: state.isWalletDetailsOpen,
    loadingSubmit: state.loadingSubmit,
    resetForNewTransaction,
    swapViewProps: swapProps,
    targetAmount: state.targetAmount,
    targetCurrency: state.targetCurrency,
    transactionId: state.transactionId,
    view: state.view,
  }
}

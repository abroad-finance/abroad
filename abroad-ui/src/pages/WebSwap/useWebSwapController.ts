import {
  createAssociatedTokenAccountInstruction,
  createTransferInstruction,
  getAssociatedTokenAddress,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token'
import {
  Connection, PublicKey, TransactionMessage, VersionedTransaction,
} from '@solana/web3.js'
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
import { getAddress, Interface, parseUnits } from 'ethers'
import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react'

import type { ApiClientResponse } from '../../api/customClient'
import type { BankDetailsRouteProps } from '../../features/swap/components/BankDetailsRoute'
import type { ConfirmQrProps } from '../../features/swap/components/ConfirmQr'
import type { SwapProps } from '../../features/swap/components/Swap'
import type { PublicCorridor } from '../../services/public/types'
import type { WebSwapControllerProps } from './WebSwap'

import {
  decodeQrCodeBR,
  type DecodeQrCodeBR400,
  type decodeQrCodeBRResponse,
  _36EnumsTargetCurrency as TargetCurrency,
} from '../../api'
import { useNotices } from '../../contexts/NoticeContext'
import { BRL_BACKGROUND_IMAGE } from '../../features/swap/constants'
import { SwapView } from '../../features/swap/types'
import {
  acceptTransactionRequest, fetchPublicCorridors, notifyPayment, requestQuote, requestReverseQuote,
} from '../../services/public/publicApi'
import { ASSET_URLS, PENDING_TX_KEY } from '../../shared/constants'
import { useWalletAuth } from '../../shared/hooks/useWalletAuth'
import { hasMessage } from '../../shared/utils'

type DecodeQrApiResponse = ApiClientResponse<decodeQrCodeBRResponse, DecodeQrCodeBR400>
type SwapAction
  = | { accountNumber?: string, pixKey?: string, recipientName?: string, taxId?: string, type: 'SET_BANK_DETAILS' }
    | { corridorKey: string, type: 'SET_CORRIDOR' }
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
  corridorKey: string
  isDecodingQr: boolean
  isDesktop: boolean
  isQrOpen: boolean
  isWalletDetailsOpen: boolean
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
  view: SwapView
}

const COP_TRANSFER_FEE = 0.0
const BRL_TRANSFER_FEE = 0.0
const corridorKeyOf = (corridor: PublicCorridor): string => (
  `${corridor.cryptoCurrency}:${corridor.blockchain}:${corridor.targetCurrency}`
)
const chainKeyOf = (corridor: PublicCorridor): string => (
  `${corridor.blockchain}:${corridor.chainId}`
)

const formatChainLabel = (value: string): string => {
  const normalized = value.toLowerCase().replace(/_/g, ' ')
  return normalized.replace(/\b\w/g, char => char.toUpperCase())
}

const formatChainIdLabel = (value: string): string => {
  if (!value) return ''
  const [, ...rest] = value.split(':')
  return rest.length > 0 ? rest.join(':') : value
}

const buildChainLabel = (corridor: PublicCorridor, includeChainId: boolean): string => {
  const base = formatChainLabel(corridor.blockchain)
  if (!includeChainId) return base
  const chainIdLabel = formatChainIdLabel(corridor.chainId)
  return chainIdLabel ? `${base} (${chainIdLabel})` : base
}

const resolveStellarNetworkPassphrase = (chainId: null | string): string => {
  if (chainId && chainId.toLowerCase().includes('test')) return Networks.TESTNET
  return Networks.PUBLIC
}

const toBase64 = (bytes: Uint8Array): string => {
  let binary = ''
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte)
  })
  return btoa(binary)
}

const fromBase64 = (value: string): Uint8Array => {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

const parseAmountUnits = (amount: string, decimals: number): bigint => {
  const normalized = amount.trim()
  const cleaned = normalized.endsWith('.') ? normalized.slice(0, -1) : normalized
  if (!cleaned) throw new Error('Amount is required')
  return parseUnits(cleaned, decimals)
}

const createInitialState = (isDesktop: boolean): SwapControllerState => ({
  accountNumber: '',
  corridorKey: '',
  isDecodingQr: false,
  isDesktop,
  isQrOpen: false,
  isWalletDetailsOpen: false,
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
        pixKey: action.pixKey ?? state.pixKey,
        recipientName: action.recipientName ?? state.recipientName,
        taxId: action.taxId ?? state.taxId,
      }
    case 'SET_CORRIDOR':
      return { ...state, corridorKey: action.corridorKey }
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
  corridorKey?: string
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
    corridorKey: state.corridorKey,
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

const extractReason = (body: unknown): null | string => {
  if (body && typeof body === 'object' && 'reason' in body) {
    const reason = (body as { reason?: unknown }).reason
    if (typeof reason === 'string') return reason
  }
  return null
}

const isAbortError = (result: { error?: { type?: string } }) => result.error?.type === 'aborted'

export const useWebSwapController = (): WebSwapControllerProps => {
  const initialDesktop = typeof window !== 'undefined' ? window.innerWidth >= 768 : true
  const [state, dispatch] = useReducer(reducer, createInitialState(initialDesktop))
  const { t } = useTranslate()
  const { addNotice } = useNotices()
  const {
    defaultWallet,
    getWalletHandler,
    setActiveWallet,
    setKycUrl,
    wallet,
    walletAuthentication,
  } = useWalletAuth()
  const [corridors, setCorridors] = useState<PublicCorridor[]>([])
  const [corridorError, setCorridorError] = useState<null | string>(null)
  const [chainKey, setChainKey] = useState('')

  const sep24TokenPresent = useMemo(() => {
    if (typeof window === 'undefined') return false
    return new URLSearchParams(window.location.search).has('token')
  }, [])

  const lastEditedRef = useRef<'source' | 'target' | null>(null)
  const sep24AutoSelectedRef = useRef(false)
  const directAbortRef = useRef<AbortController | null>(null)
  const reverseAbortRef = useRef<AbortController | null>(null)
  const directReqIdRef = useRef(0)
  const reverseReqIdRef = useRef(0)
  const decodeAbortRef = useRef<AbortController | null>(null)
  const [quoteBelowMinimum, setQuoteBelowMinimum] = useState(false)

  useEffect(() => {
    let active = true
    fetchPublicCorridors()
      .then((data) => {
        if (!active) return
        setCorridors(data.corridors)
        setCorridorError(null)
      })
      .catch((err) => {
        if (!active) return
        const message = err instanceof Error ? err.message : 'Failed to load corridors'
        setCorridorError(message)
      })
    return () => {
      active = false
    }
  }, [])

  const targetLocale = useMemo(
    () => (state.targetCurrency === TargetCurrency.BRL ? 'pt-BR' : 'es-CO'),
    [state.targetCurrency],
  )
  const targetSymbol = state.targetCurrency === TargetCurrency.BRL ? 'R$' : '$'
  const availableCorridors = useMemo(
    () => corridors.filter(corridor => corridor.targetCurrency === state.targetCurrency),
    [corridors, state.targetCurrency],
  )
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
    corridors.forEach((corridor) => {
      const current = map.get(corridor.blockchain) ?? new Set<string>()
      current.add(corridor.chainId)
      map.set(corridor.blockchain, current)
    })
    return map
  }, [corridors])
  const chainOptions = useMemo(() => {
    const seen = new Map<string, PublicCorridor>()
    corridors.forEach((corridor) => {
      const key = chainKeyOf(corridor)
      if (!seen.has(key)) seen.set(key, corridor)
    })
    return Array.from(seen.entries()).map(([key, corridor]) => {
      const includeChainId = (chainVariants.get(corridor.blockchain)?.size ?? 0) > 1
      return {
        key,
        label: buildChainLabel(corridor, includeChainId),
      }
    })
  }, [chainVariants, corridors])
  const assetOptions = useMemo(() => chainFilteredCorridors.map(corridor => ({
    key: corridorKeyOf(corridor),
    label: corridor.cryptoCurrency,
  })), [chainFilteredCorridors])
  const selectedAssetLabel = useMemo(() => {
    if (!selectedCorridor) return t('swap.asset_placeholder', 'Selecciona activo')
    return selectedCorridor.cryptoCurrency
  }, [selectedCorridor, t])
  const selectedChainLabel = useMemo(() => {
    if (!selectedCorridor) return t('swap.chain_placeholder', 'Selecciona red')
    const includeChainId = (chainVariants.get(selectedCorridor.blockchain)?.size ?? 0) > 1
    return buildChainLabel(selectedCorridor, includeChainId)
  }, [
    chainVariants,
    selectedCorridor,
    t,
  ])
  const sourceSymbol = selectedCorridor?.cryptoCurrency ?? ''

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

  useEffect(() => {
    if (sep24AutoSelectedRef.current) return
    if (!sep24TokenPresent) return
    const stellarCorridor = corridors.find(corridor => corridor.chainFamily === 'stellar')
    if (!stellarCorridor) return

    sep24AutoSelectedRef.current = true

    const nextChainKey = chainKeyOf(stellarCorridor)
    const nextCorridorKey = corridorKeyOf(stellarCorridor)

    if (state.targetCurrency !== stellarCorridor.targetCurrency) {
      dispatch({ targetCurrency: stellarCorridor.targetCurrency, type: 'SET_TARGET_CURRENCY' })
    }
    if (chainKey !== nextChainKey) {
      setChainKey(nextChainKey)
    }
    if (state.corridorKey !== nextCorridorKey) {
      dispatch({ corridorKey: nextCorridorKey, type: 'SET_CORRIDOR' })
      dispatch({ quoteId: '', sourceAmount: '', targetAmount: '', type: 'SET_AMOUNTS' })
    }
  }, [
    chainKey,
    corridors,
    sep24TokenPresent,
    state.corridorKey,
    state.targetCurrency,
  ])

  useEffect(() => {
    if (!selectedCorridor || !getWalletHandler || !setActiveWallet) return
    const nextWallet = selectedCorridor.chainFamily === 'stellar'
      ? defaultWallet
      : getWalletHandler('wallet-connect')
    if (nextWallet && nextWallet !== wallet) {
      setActiveWallet(nextWallet)
    }
  }, [
    defaultWallet,
    getWalletHandler,
    selectedCorridor,
    setActiveWallet,
    wallet,
  ])

  const targetPaymentMethod = selectedCorridor?.paymentMethod ?? 'BREB'
  const transferFee = state.targetCurrency === TargetCurrency.BRL ? BRL_TRANSFER_FEE : COP_TRANSFER_FEE

  const formatTargetNumber = useCallback((value: number) => {
    const isBRL = state.targetCurrency === TargetCurrency.BRL
    return new Intl.NumberFormat(targetLocale, {
      maximumFractionDigits: isBRL ? 2 : 0,
      minimumFractionDigits: isBRL ? 2 : 0,
    }).format(value)
  }, [targetLocale, state.targetCurrency])

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
    notifyError(t('swap.corridor_load_error', 'No pudimos cargar los activos disponibles.'), corridorError)
  }, [
    corridorError,
    notifyError,
    t,
  ])

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

  const isAuthenticated = Boolean(walletAuthentication?.jwtToken && wallet?.address && wallet?.chainId)
  const resolvedChainId = wallet?.chainId ?? selectedCorridor?.chainId ?? null
  const walletUserId = wallet?.address && resolvedChainId ? `${resolvedChainId}:${wallet.address}` : null

  const connectWallet = useCallback(async () => {
    if (!wallet || !selectedCorridor) return
    const options = wallet.walletId === 'wallet-connect'
      ? {
          chainId: selectedCorridor.chainId,
          walletConnect: selectedCorridor.walletConnect,
        }
      : undefined
    await wallet.connect(options)
  }, [selectedCorridor, wallet])

  useEffect(() => {
    if (!wallet?.address || !wallet?.chainId || !selectedCorridor) return
    if (wallet.chainId === selectedCorridor.chainId) return
    // Silently try to restore a saved session for the new chain.
    // If no session exists, disconnect so the UI reflects the need to reconnect.
    if (wallet.walletId === 'wallet-connect' && selectedCorridor.walletConnect) {
      wallet.connect({
        chainId: selectedCorridor.chainId,
        walletConnect: selectedCorridor.walletConnect,
      }).catch(() => {
        void wallet.disconnect()
      })
    }
  }, [selectedCorridor, wallet])

  const isBelowMinimum = useMemo(() => {
    if (quoteBelowMinimum) return true
    if (!selectedCorridor) return false
    const min = selectedCorridor.minAmount
      || (selectedCorridor.targetCurrency === 'BRL' ? 1 : 0)
    if (!min) return false
    const cleanedTarget = String(state.targetAmount).replace(/\./g, '').replace(/,/g, '.')
    const numericTarget = parseFloat(cleanedTarget)
    if (Number.isNaN(numericTarget) || numericTarget <= 0) return false
    return numericTarget < min
  }, [quoteBelowMinimum, selectedCorridor, state.targetAmount])

  const isAboveMaximum = useMemo(() => {
    if (!selectedCorridor) return false
    const max = selectedCorridor.maxAmount || 0
    if (!max) return false
    const cleanedTarget = String(state.targetAmount).replace(/\./g, '').replace(/,/g, '.')
    const numericTarget = parseFloat(cleanedTarget)
    if (Number.isNaN(numericTarget) || numericTarget <= 0) return false
    return numericTarget > max
  }, [selectedCorridor, state.targetAmount])

  const isPrimaryDisabled = useCallback(() => {
    const numericSource = parseFloat(String(state.sourceAmount))
    const cleanedTarget = String(state.targetAmount).replace(/\./g, '').replace(/,/g, '.')
    const numericTarget = parseFloat(cleanedTarget)
    return !(numericSource > 0 && numericTarget > 0)
  }, [state.sourceAmount, state.targetAmount])

  const continueDisabled = useMemo(() => {
    if (!isAuthenticated) return false
    return isPrimaryDisabled() || !state.quoteId || isBelowMinimum || isAboveMaximum
  }, [
    isAboveMaximum,
    isAuthenticated,
    isBelowMinimum,
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
          corridorKey: stored.corridorKey ?? '',
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
        quoteId: '', sourceAmount: value, targetAmount: '', type: 'SET_AMOUNTS',
      })
      dispatch({ loadingTarget: false, type: 'SET_LOADING' })
      return
    }

    dispatch({ loadingTarget: true, type: 'SET_LOADING' })
    dispatch({ quoteId: '', type: 'SET_AMOUNTS' })
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

    if (controller.signal.aborted || reqId !== directReqIdRef.current || lastEditedRef.current !== 'source') return

    if (!response.ok) {
      if (!isAbortError(response)) {
        // Suppress popup for 400 errors ÿÿÿ the inline isBelowMinimum
        // validation will handle the visual feedback instead.
        const status = response.error?.status
        if (status === 400) {
          const reason = extractReason(response.error?.body) || ''
          setQuoteBelowMinimum(reason.toLowerCase().includes('minimum'))
          dispatch({
            quoteId: '', sourceAmount: value, targetAmount: '', type: 'SET_AMOUNTS',
          })
        }
        else {
          setQuoteBelowMinimum(false)
          const reason = extractReason(response.error?.body) || response.error?.message || t('swap.quote_error', 'Esta cotizaci?n super? el monto m?ximo permitido.')
          notifyError(reason, response.error?.message)
        }
      }
      dispatch({ loadingTarget: false, type: 'SET_LOADING' })
      return
    }

    setQuoteBelowMinimum(false)
    const quote = response.data
    const formatted = formatTargetNumber(quote.value)
    dispatch({
      quoteId: quote.quote_id,
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

  const quoteFromTarget = useCallback(async (value: string) => {
    if (!selectedCorridor) {
      notifyError(t('swap.corridor_error', 'No corridor available for this currency.'))
      return
    }
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
      setQuoteBelowMinimum(false)
      dispatch({
        quoteId: '', sourceAmount: '', targetAmount: value, type: 'SET_AMOUNTS',
      })
      dispatch({ loadingSource: false, type: 'SET_LOADING' })
      return
    }

    // Skip API call if below minimum ÿÿÿ inline validation handles the UI
    const minAmount = selectedCorridor.minAmount
      || (selectedCorridor.targetCurrency === 'BRL' ? 1 : 0)
    if (minAmount && num < minAmount) {
      dispatch({
        quoteId: '', sourceAmount: '', targetAmount: value, type: 'SET_AMOUNTS',
      })
      dispatch({ loadingSource: false, type: 'SET_LOADING' })
      return
    }

    dispatch({ loadingSource: true, type: 'SET_LOADING' })
    dispatch({ quoteId: '', type: 'SET_AMOUNTS' })
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

    if (controller.signal.aborted || reqId !== reverseReqIdRef.current || lastEditedRef.current !== 'target') return

    if (!response.ok) {
      if (!isAbortError(response)) {
        const status = response.error?.status
        if (status === 400) {
          const reason = extractReason(response.error?.body) || ''
          setQuoteBelowMinimum(reason.toLowerCase().includes('minimum'))
          dispatch({
            quoteId: '', sourceAmount: '', targetAmount: value, type: 'SET_AMOUNTS',
          })
        }
        else {
          setQuoteBelowMinimum(false)
          const reason = extractReason(response.error?.body) || response.error?.message || t('swap.quote_error', 'Esta cotizaci?n super? el monto m?ximo permitido.')
          notifyError(reason, response.error?.message)
        }
      }
      dispatch({ loadingSource: false, type: 'SET_LOADING' })
      return
    }

    setQuoteBelowMinimum(false)
    const quote = response.data
    dispatch({
      quoteId: quote.quote_id,
      sourceAmount: formatCryptoAmount(quote.value),
      targetAmount: value,
      type: 'SET_AMOUNTS',
    })
    dispatch({ loadingSource: false, type: 'SET_LOADING' })
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
      : num.toLocaleString('es-CO', { useGrouping: true, maximumFractionDigits: 0 })
    // Reassemble: keep decimal part exactly as user typed
    const formatted = parts.length > 1
      ? `${formattedInt},${parts[1]}`
      : formattedInt
    dispatch({ targetAmount: formatted, type: 'SET_AMOUNTS' })
    void quoteFromTarget(formatted)
  }, [quoteFromTarget])

  const openQr = useCallback(() => {
    if (!isAuthenticated) {
      void connectWallet()
      return
    }
    dispatch({ isQrOpen: true, type: 'SET_QR_OPEN' })
    dispatch({ targetCurrency: TargetCurrency.BRL, type: 'SET_TARGET_CURRENCY' })
  }, [connectWallet, isAuthenticated])

  const currencyMenuRef = useRef<HTMLDivElement | null>(null)
  const skipNextDocumentClickRef = useRef(false)
  const [currencyMenuOpen, setCurrencyMenuOpen] = useReducer((s: boolean) => !s, false)

  const chainMenuRef = useRef<HTMLDivElement | null>(null)
  const skipNextChainClickRef = useRef(false)
  const [chainMenuOpen, setChainMenuOpen] = useReducer((s: boolean) => !s, false)

  const assetMenuRef = useRef<HTMLDivElement | null>(null)
  const skipNextAssetClickRef = useRef(false)
  const [assetMenuOpen, setAssetMenuOpen] = useReducer((s: boolean) => !s, false)

  const _toggleAssetMenu = useCallback(() => {
    if (assetOptions.length <= 1) return
    if (!assetMenuOpen) {
      if (currencyMenuOpen) setCurrencyMenuOpen()
      if (chainMenuOpen) setChainMenuOpen()
    }
    setAssetMenuOpen()
    if (!assetMenuOpen) {
      skipNextAssetClickRef.current = true
    }
  }, [
    assetMenuOpen,
    assetOptions.length,
    chainMenuOpen,
    currencyMenuOpen,
  ])

  const selectAssetOption = useCallback((key: string) => {
    setAssetMenuOpen()
    setQuoteBelowMinimum(false)
    dispatch({ corridorKey: key, type: 'SET_CORRIDOR' })
    const selected = availableCorridors.find(corridor => corridorKeyOf(corridor) === key)
    if (selected) setChainKey(chainKeyOf(selected))
    dispatch({ quoteId: '', type: 'SET_AMOUNTS' })
    lastEditedRef.current = null
    directAbortRef.current?.abort()
    reverseAbortRef.current?.abort()
  }, [availableCorridors])

  const _toggleCurrencyMenu = useCallback(() => {
    if (!currencyMenuOpen) {
      if (assetMenuOpen) setAssetMenuOpen()
      if (chainMenuOpen) setChainMenuOpen()
    }
    setCurrencyMenuOpen()
    if (!currencyMenuOpen) {
      skipNextDocumentClickRef.current = true
    }
  }, [
    assetMenuOpen,
    chainMenuOpen,
    currencyMenuOpen,
  ])

  const _toggleChainMenu = useCallback(() => {
    if (chainOptions.length <= 1) return
    if (!chainMenuOpen) {
      if (assetMenuOpen) setAssetMenuOpen()
      if (currencyMenuOpen) setCurrencyMenuOpen()
    }
    setChainMenuOpen()
    if (!chainMenuOpen) {
      skipNextChainClickRef.current = true
    }
  }, [
    assetMenuOpen,
    chainMenuOpen,
    chainOptions.length,
    currencyMenuOpen,
  ])

  useEffect(() => {
    if (!assetMenuOpen) return
    const onDocumentClick = (event: MouseEvent) => {
      if (skipNextAssetClickRef.current) {
        skipNextAssetClickRef.current = false
        return
      }
      const container = assetMenuRef.current
      if (!container) return
      const path = (event as unknown as { composedPath?: () => EventTarget[] }).composedPath?.()
      const clickedInside = path ? path.includes(container) : container.contains(event.target as Node)
      if (!clickedInside) setAssetMenuOpen()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setAssetMenuOpen()
    }
    document.addEventListener('click', onDocumentClick)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('click', onDocumentClick)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [assetMenuOpen])

  useEffect(() => {
    if (!chainMenuOpen) return
    const onDocumentClick = (event: MouseEvent) => {
      if (skipNextChainClickRef.current) {
        skipNextChainClickRef.current = false
        return
      }
      const container = chainMenuRef.current
      if (!container) return
      const path = (event as unknown as { composedPath?: () => EventTarget[] }).composedPath?.()
      const clickedInside = path ? path.includes(container) : container.contains(event.target as Node)
      if (!clickedInside) setChainMenuOpen()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setChainMenuOpen()
    }
    document.addEventListener('click', onDocumentClick)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('click', onDocumentClick)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [chainMenuOpen])

  const selectCurrency = useCallback((currency: TargetCurrency) => {
    setCurrencyMenuOpen()
    dispatch({ type: 'RESET' })
    dispatch({ targetCurrency: currency, type: 'SET_TARGET_CURRENCY' })
    setQuoteBelowMinimum(false)
    dispatch({ corridorKey: '', type: 'SET_CORRIDOR' })
    setChainKey('')
    lastEditedRef.current = null
    directAbortRef.current?.abort()
    reverseAbortRef.current?.abort()
  }, [])

  const selectChain = useCallback((key: string) => {
    setChainMenuOpen()
    setChainKey(key)
    const currentCrypto = selectedCorridor?.cryptoCurrency
    const next = availableCorridors.find(corridor => (
      chainKeyOf(corridor) === key && corridor.cryptoCurrency === currentCrypto
    )) ?? availableCorridors.find(corridor => chainKeyOf(corridor) === key)
    if (next) {
      dispatch({ corridorKey: corridorKeyOf(next), type: 'SET_CORRIDOR' })
    }
    else {
      const fallback = corridors.find(corridor => (
        chainKeyOf(corridor) === key && corridor.cryptoCurrency === currentCrypto
      )) ?? corridors.find(corridor => chainKeyOf(corridor) === key)
      if (fallback) {
        if (fallback.targetCurrency !== state.targetCurrency) {
          dispatch({ type: 'RESET' })
          dispatch({ targetCurrency: fallback.targetCurrency, type: 'SET_TARGET_CURRENCY' })
        }
        dispatch({ corridorKey: corridorKeyOf(fallback), type: 'SET_CORRIDOR' })
      }
      else {
        dispatch({ corridorKey: '', type: 'SET_CORRIDOR' })
      }
    }
    dispatch({ quoteId: '', type: 'SET_AMOUNTS' })
    lastEditedRef.current = null
    directAbortRef.current?.abort()
    reverseAbortRef.current?.abort()
  }, [
    availableCorridors,
    corridors,
    selectedCorridor,
    state.targetCurrency,
  ])

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
      await connectWallet()
      return
    }
    if (!state.quoteId) {
      notifyError(t('swap.wait_for_quote', 'Espera la cotizaci?n antes de continuar'))
      return
    }
    dispatch({ type: 'SET_VIEW', view: 'bankDetails' })
  }, [
    connectWallet,
    isAuthenticated,
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
      if (!response.ok) {
        if (!isAbortError(response)) {
          const reason = extractReason(response.data) || response.error?.message || t('swap.qr_decode_error', 'No pudimos decodificar este QR.')
          notifyError(reason, response.error?.message)
        }
        return
      }
      const decoded = response.data && 'decoded' in response.data ? response.data.decoded : null
      if (!decoded) {
        notifyError(t('swap.qr_decode_error', 'No pudimos decodificar este QR.'))
        return
      }

      const amountRaw = decoded.amount
      const amountText = typeof amountRaw === 'string' ? amountRaw : null
      const normalizedAmount = amountText?.replace(',', '.').trim() ?? ''
      const parsedAmount = normalizedAmount ? Number.parseFloat(normalizedAmount) : Number.NaN
      const pixKey = decoded?.account
      const taxIdDecoded = decoded?.taxId
      const name = decoded?.name

      if (name) dispatch({ recipientName: name, type: 'SET_BANK_DETAILS' })
      if (pixKey) dispatch({ pixKey, type: 'SET_BANK_DETAILS' })
      if (taxIdDecoded && !taxIdDecoded.includes('*')) dispatch({ taxId: taxIdDecoded, type: 'SET_BANK_DETAILS' })

      if (Number.isFinite(parsedAmount) && parsedAmount > 0) {
        dispatch({ targetAmount: normalizedAmount, type: 'SET_AMOUNTS' })
        await quoteFromTarget(normalizedAmount)
        dispatch({ type: 'SET_VIEW', view: 'confirm-qr' })
        return
      }

      notifyError(t('swap.qr_missing_amount', 'Este QR no incluye un monto. Ingresa el monto para continuar.'))
      dispatch({ type: 'SET_VIEW', view: 'swap' })
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
    horizonUrl,
    memoValue,
    networkPassphrase,
    source,
  }: {
    amount: string
    asset: Asset
    destination: string
    horizonUrl: string
    memoValue: string
    networkPassphrase: string
    source: string
  }): Promise<string> => {
    const server = new Horizon.Server(horizonUrl)
    const account = await server.loadAccount(source)
    const fee = await server.fetchBaseFee()
    let txBuilder = new TransactionBuilder(account, {
      fee: String(fee || BASE_FEE),
      networkPassphrase,
    })
      .addOperation(
        Operation.payment({
          amount,
          asset,
          destination,
        }),
      )
      .setTimeout(180)
    if (memoValue) {
      txBuilder = txBuilder.addMemo(Memo.text(memoValue))
    }
    return txBuilder.build().toXDR()
  }, [])

  const handleTransactionFlow = useCallback(async () => {
    dispatch({ loadingSubmit: true, type: 'SET_SUBMITTING' })
    try {
      if (!selectedCorridor) {
        throw new Error(t('swap.errors.missing_corridor', 'No hay un corredor disponible.'))
      }
      if (!state.quoteId) {
        throw new Error(t('swap.errors.missing_quote', 'Falta la cotizaci?n o la direcci?n de la billetera.'))
      }
      if (!wallet?.address || !walletUserId || !wallet.chainId) {
        throw new Error(t('swap.errors.missing_wallet', 'Conecta tu billetera antes de continuar.'))
      }

      const redirectUrl = encodeURIComponent(
        window.location.href.replace(/^https?:\/\//, ''),
      )
      const isBrazil = state.targetCurrency === TargetCurrency.BRL

      const response = await acceptTransactionRequest({
        account_number:
          isBrazil ? state.pixKey : state.accountNumber.trim(),
        qr_code: state.qrCode,
        quote_id: state.quoteId,
        redirectUrl,
        tax_id: isBrazil ? state.taxId : undefined,
        user_id: walletUserId,
      })

      if (!response.ok) {
        if (!isAbortError(response)) {
          const reason = extractReason(response.error?.body) || response.error?.message || t('swap.accept_error', 'No pudimos iniciar la transacci?n.')
          notifyError(reason, response.error?.message)
        }
        return
      }

      const {
        id: acceptedTxId,
        kycLink,
        payment_context: paymentContext,
        transaction_reference,
      } = response.data

      if (kycLink) {
        setKycUrl(kycLink)
        dispatch({ type: 'SET_VIEW', view: 'kyc-needed' })
        return
      }

      if (!acceptedTxId) {
        notifyError(t('swap.accept_error', 'No pudimos iniciar la transacci?n.'))
        resetForNewTransaction()
        return
      }

      localStorage.removeItem(PENDING_TX_KEY)

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

      if (!paymentContext) {
        throw new Error(t('swap.errors.payment_context', 'No se pudo preparar la transacci?n.'))
      }
      if (wallet.chainId && wallet.chainId !== paymentContext.chainId) {
        throw new Error(t('swap.errors.network_mismatch', 'La billetera est? conectada a otra red.'))
      }
      if (!paymentContext.depositAddress) {
        throw new Error(t('swap.errors.missing_deposit', 'Falta la direcci?n de dep?sito.'))
      }

      const amountString = state.sourceAmount.trim() || String(paymentContext.amount)

      dispatch({ type: 'SET_VIEW', view: 'wait-sign' })
      let onChainTx = ''

      if (paymentContext.chainFamily === 'stellar') {
        const assetIssuer = paymentContext.mintAddress
        if (!assetIssuer) {
          throw new Error(t('swap.errors.missing_asset', 'Falta la configuraci?n del activo.'))
        }
        const horizonUrl = paymentContext.rpcUrl || 'https://horizon.stellar.org'
        const networkPassphrase = resolveStellarNetworkPassphrase(paymentContext.chainId)
        const paymentAsset = new Asset(paymentContext.cryptoCurrency, assetIssuer)
        const unsignedXdr = await buildPaymentXdr({
          amount: amountString,
          asset: paymentAsset,
          destination: paymentContext.depositAddress,
          horizonUrl,
          memoValue: paymentContext.memo ?? transaction_reference ?? '',
          networkPassphrase,
          source: wallet.address,
        })

        const { signedTxXdr } = await wallet.signTransaction({ message: unsignedXdr })
        const tx = new Transaction(signedTxXdr, networkPassphrase)
        const horizon = new Horizon.Server(horizonUrl)
        const result = await horizon.submitTransaction(tx)
        onChainTx = result.hash
      }
      else if (paymentContext.chainFamily === 'solana') {
        if (!wallet.request) {
          throw new Error(t('swap.errors.wallet_unsupported', 'La billetera no soporta esta red.'))
        }
        if (!paymentContext.rpcUrl) {
          throw new Error(t('swap.errors.missing_rpc', 'No se configur? el RPC para esta red.'))
        }
        if (!paymentContext.mintAddress) {
          throw new Error(t('swap.errors.missing_asset', 'Falta la configuraci?n del activo.'))
        }
        if (paymentContext.decimals == null) {
          throw new Error(t('swap.errors.missing_decimals', 'Faltan los decimales del activo.'))
        }
        const amountUnits = parseAmountUnits(amountString, paymentContext.decimals)
        const connection = new Connection(paymentContext.rpcUrl, 'confirmed')
        const mint = new PublicKey(paymentContext.mintAddress)
        const owner = new PublicKey(wallet.address)
        const destinationOwner = new PublicKey(paymentContext.depositAddress)
        const sourceAta = await getAssociatedTokenAddress(mint, owner)
        const destinationAta = await getAssociatedTokenAddress(mint, destinationOwner, true)
        const sourceInfo = await connection.getAccountInfo(sourceAta)
        if (!sourceInfo) {
          throw new Error(t('swap.errors.missing_balance', 'No encontramos saldo suficiente en tu billetera.'))
        }
        const instructions = []
        const destinationInfo = await connection.getAccountInfo(destinationAta)
        if (!destinationInfo) {
          instructions.push(
            createAssociatedTokenAccountInstruction(
              owner,
              destinationAta,
              destinationOwner,
              mint,
            ),
          )
        }
        instructions.push(
          createTransferInstruction(
            sourceAta,
            destinationAta,
            owner,
            amountUnits,
            [],
            TOKEN_PROGRAM_ID,
          ),
        )

        const { blockhash } = await connection.getLatestBlockhash()
        const message = new TransactionMessage({
          instructions,
          payerKey: owner,
          recentBlockhash: blockhash,
        }).compileToV0Message()
        const unsignedTx = new VersionedTransaction(message)
        const unsignedBase64 = toBase64(unsignedTx.serialize())

        const signed = await wallet.request<string | { signedTransaction?: string, transaction?: string }>({
          chainId: paymentContext.chainId,
          method: 'solana_signTransaction',
          params: {
            pubkey: wallet.address,
            transaction: unsignedBase64,
          },
        })
        const signedBase64 = typeof signed === 'string' ? signed : signed.signedTransaction || signed.transaction
        if (!signedBase64) {
          throw new Error(t('swap.errors.wallet_signature', 'No se pudo firmar la transacci?n.'))
        }
        const signature = await connection.sendRawTransaction(fromBase64(signedBase64))
        onChainTx = signature
      }
      else if (paymentContext.chainFamily === 'evm') {
        if (!wallet.request) {
          throw new Error(t('swap.errors.wallet_unsupported', 'La billetera no soporta esta red.'))
        }
        if (!paymentContext.mintAddress) {
          throw new Error(t('swap.errors.missing_asset', 'Falta la configuraci?n del activo.'))
        }
        if (paymentContext.decimals == null) {
          throw new Error(t('swap.errors.missing_decimals', 'Faltan los decimales del activo.'))
        }
        const amountUnits = parseAmountUnits(amountString, paymentContext.decimals)
        const toAddress = getAddress(paymentContext.depositAddress)
        const tokenAddress = getAddress(paymentContext.mintAddress)
        const iface = new Interface(['function transfer(address to, uint256 value)'])
        const data = iface.encodeFunctionData('transfer', [toAddress, amountUnits])
        const txRequest = {
          data,
          from: wallet.address,
          to: tokenAddress,
          value: '0x0',
        }
        const txHash = await wallet.request<string>({
          chainId: paymentContext.chainId,
          method: 'eth_sendTransaction',
          params: [txRequest],
        })
        if (typeof txHash !== 'string' || !txHash) {
          throw new Error(t('swap.errors.wallet_signature', 'No se pudo firmar la transacci?n.'))
        }
        onChainTx = txHash
      }
      else {
        throw new Error(t('swap.errors.unsupported_chain', 'Red no soportada.'))
      }

      dispatch({ transactionId: acceptedTxId || null, type: 'SET_TRANSACTION_ID' })
      dispatch({ type: 'SET_VIEW', view: 'txStatus' })

      if (paymentContext.notify.required) {
        const notifyResponse = await notifyPayment({
          blockchain: paymentContext.blockchain,
          on_chain_tx: onChainTx,
          transaction_id: acceptedTxId,
        })
        if (!notifyResponse.ok && !isAbortError(notifyResponse)) {
          const reason = extractReason(notifyResponse.error?.body) || notifyResponse.error?.message || t('swap.notify_error', 'No pudimos notificar el pago.')
          notifyError(reason, notifyResponse.error?.message)
        }
      }
    }
    catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return
      const userMessage = err instanceof Error
        ? err.message
        : hasMessage(err)
          ? err.message
          : t('swap.transaction_error', 'Error en la transacci?n')
      notifyError(userMessage)
      resetForNewTransaction()
    }
    finally {
      dispatch({ loadingSubmit: false, type: 'SET_SUBMITTING' })
    }
  }, [
    buildPaymentXdr,
    notifyError,
    selectedCorridor,
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
    wallet,
    walletUserId,
  ])

  const handleConfirmQr = useCallback(() => {
    if (!state.targetAmount || !state.sourceAmount) {
      notifyError(t('confirm_qr.missing_amount', 'Faltan los montos para continuar.'))
      dispatch({ type: 'SET_VIEW', view: 'swap' })
      return
    }
    if (state.targetCurrency === TargetCurrency.BRL && (!state.taxId || !state.pixKey)) {
      notifyError(t('confirm_qr.missing_data', 'Faltan datos para completar la transacci?n.'))
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
    exchangeRateDisplay,
    isAuthenticated,
    isAboveMaximum,
    isBelowMinimum,
    loadingSource: state.loadingSource,
    loadingTarget: state.loadingTarget,
    onOpenSourceModal: () => { /* handled in WebSwap */ },
    onOpenTargetModal: () => { /* handled in WebSwap */ },
    onPrimaryAction,
    onSourceChange,
    onTargetChange,
    selectedAssetLabel,
    selectedChainLabel,
    sourceAmount: state.sourceAmount,
    sourceSymbol,
    targetAmount: state.targetAmount,
    targetCurrency: state.targetCurrency,
    targetSymbol,
    toggleAssetMenu: _toggleAssetMenu,
    toggleChainMenu: _toggleChainMenu,
    toggleCurrencyMenu: _toggleCurrencyMenu,
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
    assetOptions,
    bankDetailsProps,
    chainOptions,
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
    onWalletConnect: connectWallet,
    openQr,
    resetForNewTransaction,
    selectAssetOption,
    selectChain,
    selectCurrency,
    selectedChainKey: activeChainKey,
    swapViewProps: swapProps,
    targetAmount: state.targetAmount,
    targetCurrency: state.targetCurrency,
    transactionId: state.transactionId,
    view: state.view,
  }
}

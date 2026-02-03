import { useTranslate } from '@tolgee/react'
import {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react'

import type { PublicCorridor } from '../../../services/public/types'
import type { SwapProps } from '../components/Swap'
import type { SwapView } from '../types'

import { _36EnumsTargetCurrency as TargetCurrency } from '../../../api'
import { useNotices } from '../../../contexts/NoticeContext'
import { fetchPublicCorridors, requestQuote, requestReverseQuote } from '../../../services/public/publicApi'
// ⛔️ Removed: import { useDebounce } from '../../../shared/hooks'
import { useWalletAuth } from '../../../shared/hooks/useWalletAuth'

type UseSwapArgs = {
  isDesktop: boolean
  quoteId: string
  setIsQrOpen: (isOpen: boolean) => void
  setQuoteId: (quoteId: string) => void
  setSourceAmount: (amount: string) => void
  setTargetAmount: (amount: string) => void
  setTargetCurrency: (currency: (typeof TargetCurrency)[keyof typeof TargetCurrency]) => void
  setView: (view: SwapView) => void
  sourceAmount: string
  targetAmount: string
  targetCurrency: (typeof TargetCurrency)[keyof typeof TargetCurrency]
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

export const useSwap = ({
  isDesktop,
  quoteId,
  setIsQrOpen,
  setQuoteId,
  setSourceAmount,
  setTargetAmount,
  setTargetCurrency,
  setView,
  sourceAmount,
  targetAmount,
  targetCurrency,
}: UseSwapArgs): SwapProps => {
  const textColor = isDesktop ? 'white' : '#356E6A'
  const { t } = useTranslate()
  const { addNotice } = useNotices()
  const { wallet, walletAuthentication } = useWalletAuth()
  const [corridors, setCorridors] = useState<PublicCorridor[]>([])
  const [corridorError, setCorridorError] = useState<null | string>(null)
  const [corridorKey, setCorridorKey] = useState('')
  const [chainKey, setChainKey] = useState('')

  // Derived by currency
  const targetLocale = targetCurrency === TargetCurrency.BRL ? 'pt-BR' : 'es-CO'
  const targetSymbol = targetCurrency === TargetCurrency.BRL ? 'R$' : '$'
  const availableCorridors = useMemo(
    () => corridors.filter(corridor => corridor.targetCurrency === targetCurrency),
    [corridors, targetCurrency],
  )
  const selectedCorridor = useMemo(() => {
    const match = availableCorridors.find(corridor => corridorKeyOf(corridor) === corridorKey)
    if (match && (!chainKey || chainKeyOf(match) === chainKey)) return match
    if (chainKey) {
      return availableCorridors.find(corridor => chainKeyOf(corridor) === chainKey) ?? null
    }
    return availableCorridors[0] ?? null
  }, [
    availableCorridors,
    chainKey,
    corridorKey,
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
  const targetPaymentMethod = selectedCorridor?.paymentMethod ?? (targetCurrency === TargetCurrency.BRL ? 'PIX' : 'BREB')
  const transferFee
    = targetCurrency === TargetCurrency.BRL ? BRL_TRANSFER_FEE : COP_TRANSFER_FEE
  const sourceSymbol = selectedCorridor?.cryptoCurrency ?? ''
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

  // Local UI state
  const [loadingSource, setLoadingSource] = useState(false) // typing in target field -> fetching source
  const [loadingTarget, setLoadingTarget] = useState(false) // typing in source field -> fetching target
  const [displayedTRM, setDisplayedTRM] = useState(0.0)

  const [currencyMenuOpen, setCurrencyMenuOpen] = useState(false)
  const currencyMenuRef = useRef<HTMLDivElement | null>(null)
  // Prevent immediate close from the same click that opens the menu
  const skipNextDocumentClickRef = useRef(false)
  const [assetMenuOpen, setAssetMenuOpen] = useState(false)
  const assetMenuRef = useRef<HTMLDivElement | null>(null)
  const skipNextAssetClickRef = useRef(false)
  const [chainMenuOpen, setChainMenuOpen] = useState(false)
  const chainMenuRef = useRef<HTMLDivElement | null>(null)
  const skipNextChainClickRef = useRef(false)

  // Request-cancellation + stale-response protection --------------------------
  // Track which side the user edited last (to avoid cross-updates)
  const lastEditedRef = useRef<'source' | 'target' | null>(null)

  // Separate controllers for each direction
  const directAbortRef = useRef<AbortController | null>(null) // source -> target (getReverseQuote)
  const reverseAbortRef = useRef<AbortController | null>(null) // target -> source (getQuote)

  // Incrementing ids so only the latest request can update state
  const directReqIdRef = useRef(0)
  const reverseReqIdRef = useRef(0)

  // Helpers
  const formatTargetNumber = useCallback(
    (value: number) =>
      new Intl.NumberFormat(targetLocale, {
        maximumFractionDigits: 2,
        minimumFractionDigits: 2,
      }).format(value),
    [targetLocale],
  )

  const isAuthenticated = Boolean(walletAuthentication?.jwtToken && wallet?.address && wallet?.chainId)

  const isButtonDisabled = useCallback(() => {
    const numericSource = parseFloat(String(sourceAmount))
    const cleanedTarget = String(targetAmount).replace(/\./g, '').replace(/,/g, '.')
    const numericTarget = parseFloat(cleanedTarget)
    return !(numericSource > 0 && numericTarget > 0)
  }, [sourceAmount, targetAmount])

  const continueDisabled = useMemo(() => {
    // When not authenticated, button should enable to allow connecting wallet
    if (!isAuthenticated) return false
    return isButtonDisabled() || !quoteId
  }, [
    isAuthenticated,
    isButtonDisabled,
    quoteId,
  ])

  const exchangeRateDisplay = useMemo(
    () => (displayedTRM === 0 ? '-' : `${targetSymbol}${formatTargetNumber(displayedTRM)}`),
    [
      displayedTRM,
      formatTargetNumber,
      targetSymbol,
    ],
  )
  const transferFeeDisplay = useMemo(
    () => `${targetSymbol}${formatTargetNumber(transferFee)}`,
    [
      formatTargetNumber,
      targetSymbol,
      transferFee,
    ],
  )

  // API calls -----------------------------------------------------------------
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

  useEffect(() => {
    if (!selectedCorridor) return
    const key = corridorKeyOf(selectedCorridor)
    if (corridorKey !== key) {
      setCorridorKey(key)
    }
    const chain = chainKeyOf(selectedCorridor)
    if (chainKey !== chain) {
      setChainKey(chain)
    }
  }, [
    chainKey,
    corridorKey,
    selectedCorridor,
  ])

  useEffect(() => {
    if (!corridorError) return
    addNotice({
      description: corridorError,
      kind: 'error',
      message: t('swap.corridor_load_error', 'No pudimos cargar los activos disponibles.'),
    })
  }, [
    addNotice,
    corridorError,
    t,
  ])

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
    wallet.disconnect().catch(() => undefined)
  }, [selectedCorridor, wallet])

  const formatCryptoAmount = useCallback((value: number) => {
    if (!Number.isFinite(value)) return ''
    return new Intl.NumberFormat('en-US', {
      maximumFractionDigits: 8,
      minimumFractionDigits: 0,
      useGrouping: false,
    }).format(value)
  }, [])

  // SOURCE → TARGET (user edits source; we compute target)
  const fetchDirectConversion = useCallback(
    async (value: string) => {
      const corridor = selectedCorridor
      if (!corridor) {
        addNotice({ kind: 'error', message: t('swap.corridor_error', 'No corridor available for this currency.') })
        return
      }
      // Cancel any in-flight SOURCE→TARGET request; also cancel the opposite to avoid cross-updates.
      directAbortRef.current?.abort()
      reverseAbortRef.current?.abort()

      const controller = new AbortController()
      directAbortRef.current = controller
      const reqId = ++directReqIdRef.current

      const num = parseFloat(value)
      if (isNaN(num)) {
        // Clear target if input is not a number
        setTargetAmount('')
        return
      }

      setLoadingTarget(true)
      setQuoteId('') // invalidate previous quote
      try {
        // NOTE: We pass an AbortSignal as a 2nd arg; ensure your API helper forwards it to fetch/axios.
        const response = await requestReverseQuote(
          {
            crypto_currency: corridor.cryptoCurrency,
            network: corridor.blockchain,
            payment_method: targetPaymentMethod,
            source_amount: num,
            target_currency: corridor.targetCurrency,
          },
          { signal: controller.signal },
        )

        // If this request is no longer the latest, or user switched fields, ignore.
        if (controller.signal.aborted || reqId !== directReqIdRef.current || lastEditedRef.current !== 'source') return

        if (!response.ok) {
          if (response.error?.type !== 'aborted') {
            addNotice({ kind: 'error', message: t('swap.quote_error', 'This quote exceeded the maximum allowed amount.') })
          }
          return
        }

        const formatted = formatTargetNumber(response.data.value)
        setQuoteId(response.data.quote_id)
        setTargetAmount(formatted)
      }
      catch (error: unknown) {
        if (
          (error as Error)?.name === 'AbortError'
          || (error as { code?: string })?.code === 'ERR_CANCELED'
          || (error as { message?: string })?.message === 'canceled'
        ) {
          return
        }
        console.error('Reverse quote error', error)
      }
      finally {
        if (reqId === directReqIdRef.current && lastEditedRef.current === 'source') {
          setLoadingTarget(false)
        }
      }
    },
    [
      formatTargetNumber,
      selectedCorridor,
      setQuoteId,
      setTargetAmount,
      addNotice,
      t,
      targetPaymentMethod,
    ],
  )

  // TARGET → SOURCE (user edits target; we compute source)
  const fetchReverseConversion = useCallback(
    async (value: string) => {
      const corridor = selectedCorridor
      if (!corridor) {
        addNotice({ kind: 'error', message: t('swap.corridor_error', 'No corridor available for this currency.') })
        return
      }
      // Cancel any in-flight TARGET→SOURCE request; also cancel the opposite to avoid cross-updates.
      reverseAbortRef.current?.abort()
      directAbortRef.current?.abort()

      const controller = new AbortController()
      reverseAbortRef.current = controller
      const reqId = ++reverseReqIdRef.current

      const raw = value.replace(/[^0-9.,]/g, '')
      const normalized = raw.replace(/\./g, '').replace(/,/g, '.')
      const num = parseFloat(normalized)
      if (isNaN(num)) {
        setSourceAmount('')
        return
      }

      setLoadingSource(true)
      setQuoteId('') // invalidate previous quote
      try {
        const response = await requestQuote(
          {
            amount: num,
            crypto_currency: corridor.cryptoCurrency,
            network: corridor.blockchain,
            payment_method: targetPaymentMethod,
            target_currency: corridor.targetCurrency,
          },
          { signal: controller.signal },
        )

        if (controller.signal.aborted || reqId !== reverseReqIdRef.current || lastEditedRef.current !== 'target') return

        if (!response.ok) {
          if (response.error?.type !== 'aborted') {
            addNotice({ kind: 'error', message: t('swap.quote_error', 'This quote exceeded the maximum allowed amount.') })
          }
          return
        }

        setQuoteId(response.data.quote_id)
        setSourceAmount(formatCryptoAmount(response.data.value))
      }
      catch (error: unknown) {
        if (
          (error as Error)?.name === 'AbortError'
          || (error as { code?: string })?.code === 'ERR_CANCELED'
          || (error as { message?: string })?.message === 'canceled'
        ) {
          return
        }
        console.error('Quote error', error)
      }
      finally {
        if (reqId === reverseReqIdRef.current && lastEditedRef.current === 'target') {
          setLoadingSource(false)
        }
      }
    },
    [
      formatCryptoAmount,
      selectedCorridor,
      setQuoteId,
      setSourceAmount,
      addNotice,
      t,
      targetPaymentMethod,
    ],
  )

  // Handlers ------------------------------------------------------------------

  const onSourceChange = useCallback(
    (val: string) => {
      lastEditedRef.current = 'source'
      const sanitized = val.replace(/[^0-9.]/g, '')
      setSourceAmount(sanitized)
      // Immediate fetch; previous request gets aborted
      fetchDirectConversion(sanitized)
    },
    [setSourceAmount, fetchDirectConversion],
  )

  const onTargetChange = useCallback(
    (val: string) => {
      lastEditedRef.current = 'target'
      const sanitized = val.replace(/[^0-9.,]/g, '')
      setTargetAmount(sanitized)
      // Immediate fetch; previous request gets aborted
      fetchReverseConversion(sanitized)
    },
    [setTargetAmount, fetchReverseConversion],
  )

  const openQr = useCallback(() => {
    if (!isAuthenticated) {
      void connectWallet()
      return
    }
    setIsQrOpen(true)
    setTargetCurrency(TargetCurrency.BRL)
  }, [
    isAuthenticated,
    connectWallet,
    setIsQrOpen,
    setTargetCurrency,
  ])

  const toggleAssetMenu = useCallback(() => {
    if (assetOptions.length <= 1) return
    setAssetMenuOpen((v) => {
      const next = !v
      if (!v && next) {
        skipNextAssetClickRef.current = true
        setCurrencyMenuOpen(false)
        setChainMenuOpen(false)
      }
      return next
    })
  }, [assetOptions.length])

  const selectAssetOption = useCallback((key: string) => {
    setAssetMenuOpen(false)
    setCorridorKey(key)
    const selected = availableCorridors.find(corridor => corridorKeyOf(corridor) === key)
    if (selected) setChainKey(chainKeyOf(selected))
    lastEditedRef.current = null
    directAbortRef.current?.abort()
    reverseAbortRef.current?.abort()
    setQuoteId('')
    setSourceAmount('')
    setTargetAmount('')
    setDisplayedTRM(0)
  }, [
    availableCorridors,
    setCorridorKey,
    setChainKey,
    setQuoteId,
    setSourceAmount,
    setTargetAmount,
  ])

  const toggleCurrencyMenu = useCallback(() => {
    setCurrencyMenuOpen((v) => {
      const next = !v
      if (!v && next) {
        // Opening menu: ignore the very next document click
        skipNextDocumentClickRef.current = true
        setAssetMenuOpen(false)
        setChainMenuOpen(false)
      }
      return next
    })
  }, [])

  const toggleChainMenu = useCallback(() => {
    if (chainOptions.length <= 1) return
    setChainMenuOpen((v) => {
      const next = !v
      if (!v && next) {
        skipNextChainClickRef.current = true
        setAssetMenuOpen(false)
        setCurrencyMenuOpen(false)
      }
      return next
    })
  }, [chainOptions.length])

  const selectChain = useCallback((key: string) => {
    setChainMenuOpen(false)
    setChainKey(key)
    const currentCrypto = selectedCorridor?.cryptoCurrency
    const next = availableCorridors.find(corridor => (
      chainKeyOf(corridor) === key && corridor.cryptoCurrency === currentCrypto
    )) ?? availableCorridors.find(corridor => chainKeyOf(corridor) === key)
    if (next) {
      setCorridorKey(corridorKeyOf(next))
    }
    else {
      const fallback = corridors.find(corridor => (
        chainKeyOf(corridor) === key && corridor.cryptoCurrency === currentCrypto
      )) ?? corridors.find(corridor => chainKeyOf(corridor) === key)
      if (fallback) {
        if (fallback.targetCurrency !== targetCurrency) {
          setTargetCurrency(fallback.targetCurrency)
        }
        setCorridorKey(corridorKeyOf(fallback))
      }
      else {
        setCorridorKey('')
      }
    }
    lastEditedRef.current = null
    directAbortRef.current?.abort()
    reverseAbortRef.current?.abort()
    setQuoteId('')
    setSourceAmount('')
    setTargetAmount('')
    setDisplayedTRM(0)
  }, [
    availableCorridors,
    corridors,
    selectedCorridor,
    setCorridorKey,
    setChainKey,
    setQuoteId,
    setSourceAmount,
    setTargetAmount,
    setTargetCurrency,
    targetCurrency,
  ])

  const selectCurrency = useCallback(
    (currency: (typeof TargetCurrency)[keyof typeof TargetCurrency]) => {
      setCurrencyMenuOpen(false)
      setTargetCurrency(currency)
      setCorridorKey('')
      setChainKey('')

      // Reset any quote data to avoid using stale results after changing currency.
      lastEditedRef.current = null
      directAbortRef.current?.abort()
      reverseAbortRef.current?.abort()
      setQuoteId('')
      setSourceAmount('')
      setTargetAmount('')
      setDisplayedTRM(0)
    },
    [
      setCorridorKey,
      setQuoteId,
      setSourceAmount,
      setTargetAmount,
      setTargetCurrency,
    ],
  )

  const onPrimaryAction = useCallback(async () => {
    if (!isAuthenticated) {
      // Connect wallet
      await connectWallet()
      return
    }
    if (!quoteId) {
      addNotice({ kind: 'info', message: t('swap.wait_for_quote', 'Please wait for the quote to load before continuing') })
      return
    }
    // proceed
    setView('bankDetails')
  }, [
    isAuthenticated,
    connectWallet,
    quoteId,
    addNotice,
    setView,
    t,
  ])

  // Effects -------------------------------------------------------------------

  // Exchange rate (TRM) display
  useEffect(() => {
    if (!loadingSource && !loadingTarget) {
      const numericSource = parseFloat(sourceAmount)
      const cleanedTarget = targetAmount.replace(/\./g, '').replace(/,/g, '.')
      const numericTarget = parseFloat(cleanedTarget)
      if (numericSource > 0 && !isNaN(numericTarget) && numericTarget >= 0) {
        setDisplayedTRM((numericTarget + transferFee) / numericSource)
      }
      else {
        setDisplayedTRM(0.0)
      }
    }
  }, [
    sourceAmount,
    targetAmount,
    loadingSource,
    loadingTarget,
    transferFee,
  ])

  // ⛔️ Removed debounced fetchers:
  // useEffect(() => { ... }, [sourceDebouncedAmount])
  // useEffect(() => { ... }, [targetDebounceAmount])

  // Close currency menu on outside click and Escape
  useEffect(() => {
    if (!currencyMenuOpen) return

    const onDocumentClick = (event: MouseEvent) => {
      if (skipNextDocumentClickRef.current) {
        skipNextDocumentClickRef.current = false
        return
      }
      const container = currencyMenuRef.current
      if (!container) return

      // Prefer composedPath for better accuracy across trees
      const path = (event as unknown as { composedPath?: () => EventTarget[] }).composedPath?.()
      const clickedInside = path ? path.includes(container) : container.contains(event.target as Node)

      if (!clickedInside) setCurrencyMenuOpen(false)
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setCurrencyMenuOpen(false)
    }

    document.addEventListener('click', onDocumentClick)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('click', onDocumentClick)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [currencyMenuOpen])

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

      if (!clickedInside) setAssetMenuOpen(false)
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setAssetMenuOpen(false)
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

      if (!clickedInside) setChainMenuOpen(false)
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setChainMenuOpen(false)
    }

    document.addEventListener('click', onDocumentClick)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('click', onDocumentClick)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [chainMenuOpen])

  // Cleanup on unmount: abort any in-flight requests
  useEffect(() => {
    return () => {
      directAbortRef.current?.abort()
      reverseAbortRef.current?.abort()
    }
  }, [])

  // Return props for stateless view -------------------------------------------
  return {
    // Primary action
    assetMenuOpen,
    assetMenuRef,
    assetOptions,
    chainMenuOpen,
    chainMenuRef,
    chainOptions,
    continueDisabled,
    currencyMenuOpen,
    currencyMenuRef,

    exchangeRateDisplay,
    isAuthenticated,
    loadingSource,
    loadingTarget,

    onPrimaryAction,
    // Handlers
    onSourceChange,

    onTargetChange,
    // QR + currency menu
    openQr,
    selectAssetOption,
    selectChain,
    selectCurrency,
    selectedAssetLabel,
    selectedChainLabel,
    // Amounts & loaders
    sourceAmount,
    sourceSymbol,
    targetAmount,

    targetCurrency,
    // Derived display
    targetSymbol,
    // UI look & currency
    textColor,

    toggleAssetMenu,
    toggleChainMenu,
    toggleCurrencyMenu,
    transferFeeDisplay,
  }
}

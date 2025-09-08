import { useTranslate } from '@tolgee/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { SwapProps } from '../components/Swap'
import type { SwapView } from '../types'

import {
  _36EnumsBlockchainNetwork as BlockchainNetwork,
  _36EnumsCryptoCurrency as CryptoCurrency,
  getQuote,
  getReverseQuote,
  _36EnumsPaymentMethod as PaymentMethod,
  _36EnumsTargetCurrency as TargetCurrency,
} from '../../../api'
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
  const { kit, walletAuthentication } = useWalletAuth()

  // Derived by currency
  const targetLocale = targetCurrency === TargetCurrency.BRL ? 'pt-BR' : 'es-CO'
  const targetSymbol = targetCurrency === TargetCurrency.BRL ? 'R$' : '$'
  const targetPaymentMethod
    = targetCurrency === TargetCurrency.BRL ? PaymentMethod.PIX : PaymentMethod.MOVII
  const transferFee
    = targetCurrency === TargetCurrency.BRL ? BRL_TRANSFER_FEE : COP_TRANSFER_FEE

  // Local UI state
  const [loadingSource, setLoadingSource] = useState(false) // typing in target field -> fetching source
  const [loadingTarget, setLoadingTarget] = useState(false) // typing in source field -> fetching target
  const [displayedTRM, setDisplayedTRM] = useState(0.0)

  const [currencyMenuOpen, setCurrencyMenuOpen] = useState(false)
  const currencyMenuRef = useRef<HTMLDivElement | null>(null)
  // Prevent immediate close from the same click that opens the menu
  const skipNextDocumentClickRef = useRef(false)

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

  const isAuthenticated = Boolean(walletAuthentication?.jwtToken)

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

  // SOURCE → TARGET (user edits source; we compute target)
  const fetchDirectConversion = useCallback(
    async (value: string) => {
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
      try {
        // NOTE: We pass an AbortSignal as a 2nd arg; ensure your API helper forwards it to fetch/axios.
        const response = await (getReverseQuote)(
          {
            crypto_currency: CryptoCurrency.USDC,
            network: BlockchainNetwork.STELLAR,
            payment_method: targetPaymentMethod,
            source_amount: num,
            target_currency: targetCurrency,
          },
          { signal: controller.signal },
        )

        // If this request is no longer the latest, or user switched fields, ignore.
        if (controller.signal.aborted || reqId !== directReqIdRef.current || lastEditedRef.current !== 'source') return

        if (response.status === 200) {
          const formatted = formatTargetNumber(response.data.value)
          setQuoteId(response.data.quote_id)
          setTargetAmount(formatted)
        }
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
      setQuoteId,
      setTargetAmount,
      targetCurrency,
      targetPaymentMethod,
    ],
  )

  // TARGET → SOURCE (user edits target; we compute source)
  const fetchReverseConversion = useCallback(
    async (value: string) => {
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
      try {
        const response = await (getQuote)(
          {
            amount: num,
            crypto_currency: CryptoCurrency.USDC,
            network: BlockchainNetwork.STELLAR,
            payment_method: targetPaymentMethod,
            target_currency: targetCurrency,
          },
          { signal: controller.signal },
        )

        if (controller.signal.aborted || reqId !== reverseReqIdRef.current || lastEditedRef.current !== 'target') return

        if (response.status === 200) {
          setQuoteId(response.data.quote_id)
          setSourceAmount(response.data.value.toFixed(2))
        }
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
      setQuoteId,
      setSourceAmount,
      targetCurrency,
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
    setIsQrOpen(true)
    setTargetCurrency(TargetCurrency.BRL)
  }, [setIsQrOpen, setTargetCurrency])

  const toggleCurrencyMenu = useCallback(() => {
    setCurrencyMenuOpen((v) => {
      const next = !v
      if (!v && next) {
        // Opening menu: ignore the very next document click
        skipNextDocumentClickRef.current = true
      }
      return next
    })
  }, [])

  const selectCurrency = useCallback(
    (currency: (typeof TargetCurrency)[keyof typeof TargetCurrency]) => {
      setCurrencyMenuOpen(false)
      setTargetCurrency(currency)
      // Optional: you can trigger a recompute for the current side here if desired.
      // if (lastEditedRef.current === 'source' && sourceAmount) fetchDirectConversion(sourceAmount)
      // if (lastEditedRef.current === 'target' && targetAmount) fetchReverseConversion(targetAmount)
    },
    [setTargetCurrency],
  )

  const onPrimaryAction = useCallback(async () => {
    if (!isAuthenticated) {
      // Connect wallet
      await kit?.connect()
      return
    }
    if (!quoteId) {
      alert(t('swap.wait_for_quote', 'Please wait for the quote to load before continuing'))
      return
    }
    // proceed
    setView('bankDetails')
  }, [
    isAuthenticated,
    kit,
    quoteId,
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
    selectCurrency,
    // Amounts & loaders
    sourceAmount,
    targetAmount,

    targetCurrency,
    // Derived display
    targetSymbol,
    // UI look & currency
    textColor,

    toggleCurrencyMenu,
    transferFeeDisplay,
  }
}

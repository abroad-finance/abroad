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
import { useDebounce } from '../../../shared/hooks'
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
  const { authenticateWithWallet, token } = useWalletAuth()

  // Derived by currency
  const targetLocale = targetCurrency === TargetCurrency.BRL ? 'pt-BR' : 'es-CO'
  const targetSymbol = targetCurrency === TargetCurrency.BRL ? 'R$' : '$'
  const targetPaymentMethod
    = targetCurrency === TargetCurrency.BRL ? PaymentMethod.PIX : PaymentMethod.MOVII
  const transferFee
    = targetCurrency === TargetCurrency.BRL ? BRL_TRANSFER_FEE : COP_TRANSFER_FEE

  // Local UI state
  const [loadingSource, setLoadingSource] = useState(false)
  const [loadingTarget, setLoadingTarget] = useState(false)
  const [displayedTRM, setDisplayedTRM] = useState(0.0)

  const [currencyMenuOpen, setCurrencyMenuOpen] = useState(false)
  const currencyMenuRef = useRef<HTMLDivElement | null>(null)
  // Prevent immediate close from the same click that opens the menu
  const skipNextDocumentClickRef = useRef(false)

  // which input triggered the fetch: true=source, false=target
  const triggerRef = useRef<boolean | null>(null)

  // Debounced inputs
  const sourceDebouncedAmount = useDebounce(sourceAmount, 1500)
  const targetDebounceAmount = useDebounce(targetAmount, 1500)

  // Helpers
  const formatTargetNumber = useCallback(
    (value: number) =>
      new Intl.NumberFormat(targetLocale, {
        maximumFractionDigits: 2,
        minimumFractionDigits: 2,
      }).format(value),
    [targetLocale],
  )

  const isAuthenticated = !!token

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

  const fetchDirectConversion = useCallback(
    async (value: string) => {
      const num = parseFloat(value)
      if (isNaN(num)) {
        setTargetAmount('')
        return
      }
      setLoadingTarget(true)
      try {
        const response = await getReverseQuote({
          crypto_currency: CryptoCurrency.USDC,
          network: BlockchainNetwork.STELLAR,
          payment_method: targetPaymentMethod,
          source_amount: num,
          target_currency: targetCurrency,
        })
        if (response.status === 200) {
          const formatted = formatTargetNumber(response.data.value)
          setQuoteId(response.data.quote_id)
          setTargetAmount(formatted)
        }
      }
      catch (error) {
        console.error('Reverse quote error', error)
      }
      finally {
        setLoadingTarget(false)
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

  const fetchReverseConversion = useCallback(
    async (value: string) => {
      const raw = value.replace(/[^0-9.,]/g, '')
      const normalized = raw.replace(/\./g, '').replace(/,/g, '.')
      const num = parseFloat(normalized)
      if (isNaN(num)) {
        setSourceAmount('')
        return
      }
      setLoadingSource(true)
      try {
        const response = await getQuote({
          amount: num,
          crypto_currency: CryptoCurrency.USDC,
          network: BlockchainNetwork.STELLAR,
          payment_method: targetPaymentMethod,
          target_currency: targetCurrency,
        })
        if (response.status === 200) {
          setQuoteId(response.data.quote_id)
          setSourceAmount(response.data.value.toFixed(2))
        }
      }
      catch (error) {
        console.error('Quote error', error)
      }
      finally {
        setLoadingSource(false)
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
      triggerRef.current = true
      setSourceAmount(val.replace(/[^0-9.]/g, ''))
    },
    [setSourceAmount],
  )

  const onTargetChange = useCallback(
    (val: string) => {
      triggerRef.current = false
      setTargetAmount(val.replace(/[^0-9.,]/g, ''))
    },
    [setTargetAmount],
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
    },
    [setTargetCurrency],
  )

  const onPrimaryAction = useCallback(async () => {
    if (!isAuthenticated) {
      // Connect wallet
      await authenticateWithWallet()
      return
    }
    if (!quoteId) {
      alert(t('swap.wait_for_quote', 'Please wait for the quote to load before continuing'))
      return
    }
    // proceed
    setView('bankDetails')
  }, [
    authenticateWithWallet,
    isAuthenticated,
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

  // Debounced fetchers
  useEffect(() => {
    if (sourceDebouncedAmount && triggerRef.current === true) {
      fetchDirectConversion(sourceDebouncedAmount)
    }
  }, [fetchDirectConversion, sourceDebouncedAmount])

  useEffect(() => {
    if (targetDebounceAmount && triggerRef.current === false) {
      fetchReverseConversion(targetDebounceAmount)
    }
  }, [targetDebounceAmount, fetchReverseConversion])

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

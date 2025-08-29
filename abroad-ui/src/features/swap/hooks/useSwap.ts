import { useTranslate } from '@tolgee/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { SwapProps } from '../components/Swap'

import {
  _36EnumsBlockchainNetwork as BlockchainNetwork,
  _36EnumsCryptoCurrency as CryptoCurrency,
  getQuote,
  getReverseQuote,
  _36EnumsPaymentMethod as PaymentMethod,
  _36EnumsTargetCurrency as TargetCurrency,
} from '../../../api'
import { useWalletAuth } from '../../../contexts/WalletAuthContext'
import { kit } from '../../../services/stellarKit'
import { swapBus } from '../../../shared/events/swapBus'
import { useDebounce, useDomEvent } from '../../../shared/hooks'

type UseSwapArgs = {
  quoteId: string
  sourceAmount: string
  targetAmount: string
  targetCurrency: (typeof TargetCurrency)[keyof typeof TargetCurrency]
}

const COP_TRANSFER_FEE = 0.0
const BRL_TRANSFER_FEE = 0.0

export const useSwap = ({
  quoteId,
  sourceAmount,
  targetAmount,
  targetCurrency,
}: UseSwapArgs): SwapProps => {
  const isDesktop = useMemo(() => window.innerWidth >= 768, [])
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
        swapBus.emit('swap/quoteFromSourceCalculated', { quoteId: '', targetAmount: '' })
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
          swapBus.emit('swap/quoteFromSourceCalculated', {
            quoteId: response.data.quote_id,
            targetAmount: formatted,
          })
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
        swapBus.emit('swap/quoteFromTargetCalculated', { quoteId: '', srcAmount: '' })
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
          swapBus.emit('swap/quoteFromTargetCalculated', {
            quoteId: response.data.quote_id,
            srcAmount: response.data.value.toFixed(2),
          })
        }
      }
      catch (error) {
        console.error('Quote error', error)
      }
      finally {
        setLoadingSource(false)
      }
    },
    [targetCurrency, targetPaymentMethod],
  )

  // Handlers ------------------------------------------------------------------

  const onSourceChange = useCallback(
    (val: string) => {
      triggerRef.current = true
      const cleaned = val.replace(/[^0-9.]/g, '')
      swapBus.emit('swap/userSourceInputChanged', { value: cleaned })
    },
    [],
  )

  const onTargetChange = useCallback(
    (val: string) => {
      triggerRef.current = false
      const cleaned = val.replace(/[^0-9.,]/g, '')
      swapBus.emit('swap/userTargetInputChanged', { value: cleaned })
    },
    [],
  )

  const openQr = useCallback(() => {
    swapBus.emit('swap/qrOpenRequestedByUser')
    swapBus.emit('swap/targetCurrencySelected', { currency: TargetCurrency.BRL })
  }, [])

  const toggleCurrencyMenu = useCallback(() => {
    setCurrencyMenuOpen(v => !v)
  }, [])

  const selectCurrency = useCallback(
    (currency: (typeof TargetCurrency)[keyof typeof TargetCurrency]) => {
      setCurrencyMenuOpen(false)
      swapBus.emit('swap/targetCurrencySelected', { currency })
    },
    [],
  )

  const onPrimaryAction = useCallback(() => {
    if (!isAuthenticated) {
      // Connect wallet
      kit.openModal({
        onWalletSelected: async (option) => {
          await authenticateWithWallet(option.id)
        },
      })
      return
    }
    if (!quoteId) {
      alert(t('swap.wait_for_quote', 'Please wait for the quote to load before continuing'))
      return
    }
    // proceed
    swapBus.emit('swap/continueRequested')
  }, [
    authenticateWithWallet,
    isAuthenticated,
    quoteId,
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

  // Close currency dropdown on outside click
  const onDocClick = useCallback((e: MouseEvent) => {
    if (currencyMenuRef.current && !currencyMenuRef.current.contains(e.target as Node)) {
      setCurrencyMenuOpen(false)
    }
  }, [])
  useDomEvent(document, 'mousedown', onDocClick)

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

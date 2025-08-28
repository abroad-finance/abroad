import { useCallback, useEffect } from 'react'

import type { WebSwapLayoutProps } from '../../../features/swap/WebSwapLayout'

import { _36EnumsTargetCurrency as TargetCurrency } from '../../../api/index'
import { PENDING_TX_KEY } from '../../../constants'
import { useWalletAuth } from '../../../contexts/WalletAuthContext'
import { SwapView } from '../../../features/swap/webSwap.types'

type UseWebSwapLayoutProps = {
  quoteId: string
  setIsQrOpen: (isOpen: boolean) => void
  setQuoteId: (quoteId: string) => void
  setSourceAmount: (amount: string) => void
  setTargetAmount: (amount: string) => void
  setTargetCurrency: (currency: (typeof TargetCurrency)[keyof typeof TargetCurrency]) => void
  setTransactionId: (id: null | string) => void
  setView: (view: SwapView) => void
  sourceAmount: string
  targetAmount: string
  targetCurrency: (typeof TargetCurrency)[keyof typeof TargetCurrency]
  transactionId: null | string
  view: SwapView
}

export const useWebSwapLayout = ({ quoteId, setIsQrOpen, setQuoteId, setSourceAmount, setTargetAmount, setTargetCurrency, setTransactionId, setView, sourceAmount, targetAmount, targetCurrency, transactionId, view }: UseWebSwapLayoutProps): WebSwapLayoutProps => {
  const { token } = useWalletAuth()

  // Restore state if user returns from KYC
  useEffect(() => {
    const stored = localStorage.getItem(PENDING_TX_KEY)
    if (stored && token) {
      try {
        const parsed = JSON.parse(stored)
        setQuoteId(parsed.quote_id)
        setSourceAmount(parsed.srcAmount)
        setTargetAmount(parsed.tgtAmount)
        setTargetCurrency(parsed.targetCurrency || TargetCurrency.COP)
        setView('bankDetails')
      }
      catch (e) {
        console.error('Failed to restore pending transaction', e)
      }
    }
  }, [
    setQuoteId,
    setSourceAmount,
    setTargetAmount,
    setTargetCurrency,
    setView,
    token,
  ])

  const handleSwapContinue = useCallback(() => {
    setView('bankDetails')
  }, [setView])

  const handleAmountsChange = useCallback(({ currency, src, tgt }: { currency?: (typeof TargetCurrency)[keyof typeof TargetCurrency], src?: string, tgt?: string }) => {
    if (typeof src === 'string') setSourceAmount(src || '')
    if (typeof tgt === 'string') setTargetAmount(tgt || '')
    if (typeof currency === 'string') setTargetCurrency(currency)
  }, [
    setSourceAmount,
    setTargetAmount,
    setTargetCurrency,
  ])

  const handleBackToSwap = useCallback(() => {
    localStorage.removeItem(PENDING_TX_KEY)
    setView('swap')
  }, [setView])

  // Reset from TxStatus to start a fresh transaction
  const resetForNewTransaction = useCallback(() => {
    localStorage.removeItem(PENDING_TX_KEY)
    setSourceAmount('')
    setTargetAmount('')
    setTransactionId(null)
    setView('swap')
  }, [
    setSourceAmount,
    setTargetAmount,
    setTransactionId,
    setView,
  ])

  const onOpenQr = useCallback(() => {
    setIsQrOpen(true)
    setTargetCurrency(TargetCurrency.BRL)
  }, [setIsQrOpen, setTargetCurrency])

  return {
    handleAmountsChange,
    handleBackToSwap,
    handleSwapContinue,
    openQr: onOpenQr,
    quoteId,
    resetForNewTransaction,
    setQuoteId,
    sourceAmount,
    targetAmount,
    targetCurrency,
    transactionId,
    view,
  }
}

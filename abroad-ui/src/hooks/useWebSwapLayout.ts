import { useCallback, useEffect } from 'react'

import type { WebSwapLayoutProps } from '../features/swap/WebSwapLayout'

import { _36EnumsTargetCurrency as TargetCurrency } from '../api/index'
import { PENDING_TX_KEY } from '../constants'
import { useWalletAuth } from '../contexts/WalletAuthContext'
import { SwapView } from '../features/swap/webSwap.types'

type UseWebSwapLayoutProps = {
  pixKey: string
  quoteId: string
  setIsQrOpen: (isOpen: boolean) => void
  setPixKey: (pixKey: string) => void
  setQuoteId: (quoteId: string) => void
  setSourceAmount: (amount: string) => void
  setTargetAmount: (amount: string) => void
  setTargetCurrency: (currency: (typeof TargetCurrency)[keyof typeof TargetCurrency]) => void
  setTaxId: (taxId: string) => void
  setTransactionId: (id: null | string) => void
  setView: (view: SwapView) => void
  sourceAmount: string
  targetAmount: string
  targetCurrency: (typeof TargetCurrency)[keyof typeof TargetCurrency]
  taxId: string
  transactionId: null | string
  view: SwapView
}

export const useWebSwapLayout = ({ pixKey, quoteId, setIsQrOpen, setPixKey, setQuoteId, setSourceAmount, setTargetAmount, setTargetCurrency, setTaxId, setTransactionId, setView, sourceAmount, targetAmount, targetCurrency, taxId, transactionId, view }: UseWebSwapLayoutProps): WebSwapLayoutProps => {
  const { address, token } = useWalletAuth()

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

  // Show TxStatus screen right after signing
  const showTxStatus = useCallback((id: null | string) => {
    if (id) setTransactionId(id)
    setView('txStatus')
  }, [setTransactionId, setView])

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

  const redirectToKYCAuth = useCallback(() => {
    setView('kyc-needed')
  }, [setView])

  const redirectToWaitSign = useCallback(() => {
    setView('wait-sign')
  }, [setView])

  return {
    address,
    handleAmountsChange,
    handleBackToSwap,
    handleSwapContinue,
    openQr: onOpenQr,
    pixKey,
    quoteId,
    redirectToKYCAuth,
    redirectToWaitSign,
    resetForNewTransaction,
    setPixKey,
    setQuoteId,
    setTaxId,
    showTxStatus,
    sourceAmount,
    targetAmount,
    targetCurrency,
    taxId,
    transactionId,
    view,
  }
}

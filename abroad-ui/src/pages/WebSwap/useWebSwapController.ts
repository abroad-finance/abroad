import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import { _36EnumsBlockchainNetwork as BlockchainNetwork, _36EnumsCryptoCurrency as CryptoCurrency, decodeQrCodeBR, getQuote, _36EnumsPaymentMethod as PaymentMethod, _36EnumsTargetCurrency as TargetCurrency } from '../../api/index'
import { useWalletAuth } from '../../contexts/WalletAuthContext'
import { BRL_BACKGROUND_IMAGE } from '../../features/swap/constants'
import { ASSET_URLS, PENDING_TX_KEY } from '../../shared/constants'
import { swapBus } from '../../shared/events/swapBus'
import { useEventBus } from '../../shared/hooks'
export interface WebSwapControllerProps {
  // Controller actions/state
  closeQr: () => void
  currentBgUrl: string
  handleBackToSwap: () => void
  handleKycRedirect: () => void
  handleQrResult: (text: string) => Promise<void>
  handleWalletDetailsClose: () => void
  handleWalletDetailsOpen: () => void
  isDecodingQr: boolean
  isQrOpen: boolean
  isWalletDetailsOpen: boolean
  // Shared state for the page
  quoteId: string
  resetForNewTransaction: () => void
  sourceAmount: string
  targetAmount: string
  targetCurrency: (typeof TargetCurrency)[keyof typeof TargetCurrency]
}

export const useWebSwapController = (): WebSwapControllerProps => {
  // Modal visibility state
  const [isWalletDetailsOpen, setIsWalletDetailsOpen] = useState(false)
  const { kycUrl, token } = useWalletAuth()

  // QR scanner state and URL param handling
  const [isQrOpen, setIsQrOpen] = useState(false)
  const [isDecodingQr, setIsDecodingQr] = useState(false)
  const [searchParams] = useSearchParams()

  // Swap page state moved here
  const [sourceAmount, setSourceAmount] = useState<string>('')
  const [targetAmount, setTargetAmount] = useState<string>('')
  const [targetCurrency, setTargetCurrency] = useState<(typeof TargetCurrency)[keyof typeof TargetCurrency]>(TargetCurrency.BRL)
  const [quoteId, setQuoteId] = useState<string>('')

  // Derived controller state

  const targetPaymentMethod = targetCurrency === TargetCurrency.BRL ? PaymentMethod.PIX : PaymentMethod.MOVII

  useEffect(() => {
    if (searchParams.has('qr_scanner')) {
      setIsQrOpen(true)
      swapBus.emit('swap/qrOpenRequestedFromUrlParam')
      swapBus.emit('swap/targetCurrencySetFromUrlParam', { currency: TargetCurrency.BRL })
    }
  }, [searchParams])

  // Listen for requests to open the QR scanner (from other hooks/components)
  const open = useCallback(() => setIsQrOpen(true), [])
  useEventBus(swapBus, 'swap/qrOpenRequestedByUser', open)

  // Wire event bus listeners to update state (moved from WebSwap.tsx)
  const onTargetCurrencySelected = useCallback((p: { currency: (typeof TargetCurrency)[keyof typeof TargetCurrency] }) => setTargetCurrency(p.currency), [])
  const onUserSourceChanged = useCallback((p: { value: string }) => setSourceAmount(p.value), [])
  const onUserTargetChanged = useCallback((p: { value: string }) => setTargetAmount(p.value), [])
  const onQuoteFromSource = useCallback((p: { quoteId: string, targetAmount: string }) => {
    setQuoteId(p.quoteId)
    setTargetAmount(p.targetAmount)
  }, [])
  const onQuoteFromTarget = useCallback((p: { quoteId: string, srcAmount: string }) => {
    setQuoteId(p.quoteId)
    setSourceAmount(p.srcAmount)
  }, [])
  const onQuoteFromQr = useCallback((p: { quoteId: string, srcAmount: string }) => {
    setQuoteId(p.quoteId)
    setSourceAmount(p.srcAmount)
  }, [])
  const onQrDecoded = useCallback((p: { amount?: string, pixKey?: string, taxId?: string }) => {
    if (typeof p.amount === 'string') setTargetAmount(p.amount)
  }, [])
  const onNewTransaction = useCallback(() => {
    setSourceAmount('')
    setTargetAmount('')
  }, [])
  const onPendingRestored = useCallback((p: { quoteId?: string, srcAmount?: string, targetCurrency?: (typeof TargetCurrency)[keyof typeof TargetCurrency], tgtAmount?: string }) => {
    if (typeof p.quoteId === 'string') setQuoteId(p.quoteId)
    if (typeof p.srcAmount === 'string') setSourceAmount(p.srcAmount)
    if (typeof p.tgtAmount === 'string') setTargetAmount(p.tgtAmount)
    if (typeof p.targetCurrency === 'string') setTargetCurrency(p.targetCurrency)
  }, [])
  const onTargetCurrencyFromUrl = useCallback((p: { currency: (typeof TargetCurrency)[keyof typeof TargetCurrency] }) => setTargetCurrency(p.currency), [])

  useEventBus(swapBus, 'swap/targetCurrencySelected', onTargetCurrencySelected)
  useEventBus(swapBus, 'swap/userSourceInputChanged', onUserSourceChanged)
  useEventBus(swapBus, 'swap/userTargetInputChanged', onUserTargetChanged)
  useEventBus(swapBus, 'swap/quoteFromSourceCalculated', onQuoteFromSource)
  useEventBus(swapBus, 'swap/quoteFromTargetCalculated', onQuoteFromTarget)
  useEventBus(swapBus, 'swap/quoteFromQrCalculated', onQuoteFromQr)
  useEventBus(swapBus, 'swap/qrDecoded', onQrDecoded)
  useEventBus(swapBus, 'swap/newTransactionRequested', onNewTransaction)
  useEventBus(swapBus, 'swap/amountsRestoredFromPending', onPendingRestored)
  useEventBus(swapBus, 'swap/targetCurrencySetFromUrlParam', onTargetCurrencyFromUrl)

  // Restore state if user returns from KYC
  useEffect(() => {
    const stored = localStorage.getItem(PENDING_TX_KEY)
    if (stored && token) {
      try {
        const parsed = JSON.parse(stored)
        swapBus.emit('swap/amountsRestoredFromPending', {
          quoteId: parsed.quote_id,
          srcAmount: parsed.srcAmount,
          targetCurrency: parsed.targetCurrency || TargetCurrency.COP,
          tgtAmount: parsed.tgtAmount,
        })
      }
      catch (e) {
        console.error('Failed to restore pending transaction', e)
      }
    }
  }, [token])

  const handleWalletDetailsOpen = useCallback(() => setIsWalletDetailsOpen(true), [])
  const handleWalletDetailsClose = useCallback(() => setIsWalletDetailsOpen(false), [])

  const fetchQuote = useCallback(async (targetAmount: number) => {
    console.log('handleTargetChange called with:', { targetAmount, targetCurrency, targetPaymentMethod })
    const response = await getQuote({
      amount: targetAmount,
      crypto_currency: CryptoCurrency.USDC,
      network: BlockchainNetwork.STELLAR,
      payment_method: targetPaymentMethod,
      target_currency: targetCurrency,
    })
    if (response.status === 200) {
      const src = response.data.value.toFixed(2)
      swapBus.emit('swap/quoteFromQrCalculated', {
        quoteId: response.data.quote_id,
        srcAmount: src,
      })
    }
  }, [targetCurrency, targetPaymentMethod])

  // Handle QR results (PIX) and prefill amount
  const handleQrResult = useCallback(async (text: string) => {
    setIsQrOpen(false)
    setIsDecodingQr(true)
    try {
      const responseDecoder = await decodeQrCodeBR({ qrCode: text })
      if (responseDecoder.status !== 200) {
        alert(responseDecoder.data.reason)
        return
      }
      const amount = responseDecoder.data?.decoded?.amount
      const pixKey = responseDecoder.data.decoded?.account
      const taxIdDecoded = responseDecoder.data.decoded?.taxId
      if (amount) {
        swapBus.emit('swap/qrDecoded', { amount })
        fetchQuote(parseFloat(amount))
      }
      if (pixKey || taxIdDecoded) {
        swapBus.emit('swap/qrDecoded', { pixKey, taxId: taxIdDecoded })
      }
    }
    catch (e) {
      console.warn('Failed to decode PIX QR', e)
    }
    finally {
      setIsDecodingQr(false)
    }
  }, [fetchQuote])

  // Determine desired desktop background URL based on currency
  const currentBgUrl = targetCurrency === 'BRL' ? BRL_BACKGROUND_IMAGE : ASSET_URLS.BACKGROUND_IMAGE

  const handleKycRedirect = useCallback(() => {
    if (kycUrl) {
      window.location.href = kycUrl
    }
    else {
      alert('No KYC url finded')
    }
  }, [kycUrl])

  const handleBackToSwap = useCallback(() => {
    localStorage.removeItem(PENDING_TX_KEY)
    swapBus.emit('swap/backToSwapRequested')
  }, [])

  // Reset from TxStatus to start a fresh transaction
  const resetForNewTransaction = useCallback(() => {
    localStorage.removeItem(PENDING_TX_KEY)
    swapBus.emit('swap/newTransactionRequested')
  }, [])

  return {
    closeQr: () => setIsQrOpen(false),
    currentBgUrl,
    handleBackToSwap,
    handleKycRedirect,
    handleQrResult,
    handleWalletDetailsClose,
    handleWalletDetailsOpen,
    isDecodingQr,
    isQrOpen,
    isWalletDetailsOpen,
    quoteId,
    resetForNewTransaction,
    sourceAmount,
    targetAmount,
    targetCurrency,
  }
}

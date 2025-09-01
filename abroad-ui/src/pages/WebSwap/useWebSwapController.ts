import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import { _36EnumsBlockchainNetwork as BlockchainNetwork, _36EnumsCryptoCurrency as CryptoCurrency, decodeQrCodeBR, getQuote, _36EnumsPaymentMethod as PaymentMethod, _36EnumsTargetCurrency as TargetCurrency } from '../../api/index'
import { useWalletAuth } from '../../contexts/WalletAuthContext'
import { BRL_BACKGROUND_IMAGE } from '../../features/swap/constants'
import { SwapView } from '../../features/swap/types'
import { ASSET_URLS, PENDING_TX_KEY } from '../../shared/constants'
import { WebSwapControllerProps } from './WebSwap'

type UseWebSwapControllerProps = {
  setPixKey: (key: string) => void
  setQuoteId: (id: string) => void
  setSourceAmount: (amount: string) => void
  setTargetAmount: (amount: string) => void
  setTargetCurrency: (currency: (typeof TargetCurrency)[keyof typeof TargetCurrency]) => void
  setTaxId: (id: string) => void
  setTransactionId: (id: null | string) => void
  setView: (view: SwapView) => void
  targetCurrency: TargetCurrency
}

export const useWebSwapController = ({ setPixKey, setQuoteId, setSourceAmount, setTargetAmount, setTargetCurrency, setTaxId, setTransactionId, setView, targetCurrency }: UseWebSwapControllerProps): WebSwapControllerProps => {
  // Modal visibility state
  const [isWalletDetailsOpen, setIsWalletDetailsOpen] = useState(false)
  const { kycUrl, token } = useWalletAuth()

  // QR scanner state and URL param handling
  const [isQrOpen, setIsQrOpen] = useState(false)
  const [isDecodingQr, setIsDecodingQr] = useState(false)
  const [searchParams] = useSearchParams()

  const targetPaymentMethod = targetCurrency === TargetCurrency.BRL ? PaymentMethod.PIX : PaymentMethod.MOVII

  useEffect(() => {
    if (searchParams.has('qr_scanner')) {
      setIsQrOpen(true)
      setTargetCurrency(TargetCurrency.BRL)
    }
  }, [searchParams, setTargetCurrency])

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

  const handleWalletDetailsOpen = useCallback(() => setIsWalletDetailsOpen(true), [])
  const handleWalletDetailsClose = useCallback(() => setIsWalletDetailsOpen(false), [])

  const handleAmountsChange = useCallback(({ currency, src, tgt }: { currency?: (typeof TargetCurrency)[keyof typeof TargetCurrency], src?: string, tgt?: string }) => {
    if (typeof src === 'string') setSourceAmount(src || '')
    if (typeof tgt === 'string') setTargetAmount(tgt || '')
    if (typeof currency === 'string') setTargetCurrency(currency)
  }, [
    setSourceAmount,
    setTargetAmount,
    setTargetCurrency,
  ])

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
      handleAmountsChange?.({ src })
      setQuoteId(response.data.quote_id)
    }
  }, [
    targetCurrency,
    targetPaymentMethod,
    handleAmountsChange,
    setQuoteId,
  ])

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
        handleAmountsChange({ tgt: amount })
        fetchQuote(parseFloat(amount))
      }
      if (pixKey) {
        setPixKey(pixKey)
      }
      if (taxIdDecoded) {
        setTaxId(taxIdDecoded)
      }
    }
    catch (e) {
      console.warn('Failed to decode PIX QR', e)
    }
    finally {
      setIsDecodingQr(false)
    }
  }, [
    fetchQuote,
    handleAmountsChange,
    setPixKey,
    setTaxId,
  ])

  const isDesktop = useMemo(() => window.innerWidth >= 768, [])

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
    setView('swap')
  }, [setView])

  // Reset from TxStatus to start a fresh transaction
  const resetForNewTransaction = useCallback(() => {
    localStorage.removeItem(PENDING_TX_KEY)
    setSourceAmount('')
    setTargetAmount('')
    setTransactionId(null)
    setPixKey('')
    setTaxId('')
    setView('swap')
  }, [
    setPixKey,
    setSourceAmount,
    setTargetAmount,
    setTaxId,
    setTransactionId,
    setView,
  ])

  return {
    closeQr: () => setIsQrOpen(false),
    currentBgUrl,
    handleBackToSwap,
    handleKycRedirect,
    handleQrResult,
    handleWalletDetailsClose,
    handleWalletDetailsOpen,
    isDecodingQr,
    isDesktop,
    isQrOpen,
    isWalletDetailsOpen,
    resetForNewTransaction,
    setIsQrOpen,
  }
}

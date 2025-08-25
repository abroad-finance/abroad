import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import type { WebSwapLayoutProps } from './WebSwapLayout'

import { _36EnumsBlockchainNetwork as BlockchainNetwork, _36EnumsCryptoCurrency as CryptoCurrency, decodeQrCodeBR, getQuote, _36EnumsPaymentMethod as PaymentMethod, _36EnumsTargetCurrency as TargetCurrency } from '../../api/index'
import { useWalletAuth } from '../../contexts/WalletAuthContext'
import { ASSET_URLS, BRL_BACKGROUND_IMAGE } from './webSwap.constants'
import { SwapData, SwapView } from './webSwap.types'

const PENDING_TX_KEY = 'pendingTransaction'

// Extra controller-only fields not required by the layout component
type UseWebSwapControllerReturn = WebSwapControllerExtras & WebSwapLayoutProps

interface WebSwapControllerExtras {
  closeQr: () => void
  currentBgUrl: string
  handleQrResult: (text: string) => Promise<void>
  handleWalletConnectClose: () => void
  handleWalletDetailsClose: () => void
  handleWalletDetailsOpen: () => void
  handleWalletSelect: (walletType: 'stellar' | 'trust') => void
  isDecodingQr: boolean
  isQrOpen: boolean
  isWalletDetailsOpen: boolean
  isWalletModalOpen: boolean
  transactionReference: null | string
}

export const useWebSwapController = (): UseWebSwapControllerReturn => {
  const { address, token } = useWalletAuth()
  const [view, setView] = useState<SwapView>('swap')
  const [swapData, setSwapData] = useState<null | SwapData>(null)
  const [transactionId, setTransactionId] = useState<null | string>(null)
  const [transactionReference, setTransactionReference] = useState<null | string>(null)

  // Modal visibility state
  const [isWalletModalOpen, setIsWalletModalOpen] = useState(false)
  const [isWalletDetailsOpen, setIsWalletDetailsOpen] = useState(false)

  // Persist amounts between views
  const [sourceAmount, setSourceAmount] = useState('')
  const [targetAmount, setTargetAmount] = useState('')
  const [targetCurrency, setTargetCurrency] = useState<(typeof TargetCurrency)[keyof typeof TargetCurrency]>(TargetCurrency.BRL)

  // QR scanner state and URL param handling
  const [isQrOpen, setIsQrOpen] = useState(false)
  const [isDecodingQr, setIsDecodingQr] = useState(false)
  const [searchParams] = useSearchParams()
  const [quote_id, setquote_id] = useState<string>('')
  const [pixKey, setPixKey] = useState<string>('')
  const [taxId, setTaxId] = useState<string>('')

  const targetPaymentMethod = targetCurrency === TargetCurrency.BRL ? PaymentMethod.PIX : PaymentMethod.MOVII

  useEffect(() => {
    if (searchParams.has('qr_scanner')) {
      setIsQrOpen(true)
      setTargetCurrency(TargetCurrency.BRL)
    }
  }, [searchParams])

  // Restore state if user returns from KYC
  useEffect(() => {
    const stored = localStorage.getItem(PENDING_TX_KEY)
    if (stored && token) {
      try {
        const parsed = JSON.parse(stored)
        setSwapData({ quote_id: parsed.quote_id, srcAmount: parsed.srcAmount, targetCurrency: parsed.targetCurrency || TargetCurrency.COP, tgtAmount: parsed.tgtAmount })
        setSourceAmount(parsed.srcAmount)
        setTargetAmount(parsed.tgtAmount)
        setTargetCurrency(parsed.targetCurrency || TargetCurrency.COP)
        setView('bankDetails')
      }
      catch (e) {
        console.error('Failed to restore pending transaction', e)
      }
    }
  }, [token])

  const handleWalletConnectOpen = useCallback(() => setIsWalletModalOpen(true), [])
  const handleWalletConnectClose = useCallback(() => setIsWalletModalOpen(false), [])

  const handleWalletDetailsOpen = useCallback(() => setIsWalletDetailsOpen(true), [])
  const handleWalletDetailsClose = useCallback(() => setIsWalletDetailsOpen(false), [])

  const handleWalletSelect = useCallback((walletType: 'stellar' | 'trust') => {
    console.log('Wallet selected:', walletType)
    // Add wallet connection logic here
    setIsWalletModalOpen(false)
  }, [])

  const handleSwapContinue = useCallback((data: SwapData) => {
    console.log('handleSwapContinue called with data:', data)
    setSwapData(data)
    setTargetCurrency(data.targetCurrency || TargetCurrency.COP)
    setView('bankDetails')
  }, [])

  const handleAmountsChange = useCallback(({ currency, src, tgt }: { currency?: (typeof TargetCurrency)[keyof typeof TargetCurrency], src?: string, tgt?: string }) => {
    if (typeof src === 'string') setSourceAmount(src || '')
    if (typeof tgt === 'string') setTargetAmount(tgt || '')
    if (typeof currency === 'string') setTargetCurrency(currency)
  }, [])

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
      setquote_id(response.data.quote_id)
    }
  }, [targetCurrency, targetPaymentMethod, handleAmountsChange])

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
  }, [fetchQuote, handleAmountsChange])

  const handleBackToSwap = useCallback(() => {
    localStorage.removeItem(PENDING_TX_KEY)
    setView('swap')
  }, [])

  const handleTransactionComplete = useCallback(async ({ memo }: { memo: null | string }) => {
    console.log('Transaction complete with memo:', memo)
    localStorage.removeItem(PENDING_TX_KEY)
    // If we're already showing status screen, keep it so user can see final state.
    setSwapData(null)
    setSourceAmount('')
    setTargetAmount('')
    setTransactionReference(null)
  }, [])

  const handleTransactionFailed = useCallback(() => {
    setView('swap')
    setSwapData(null)
    setSourceAmount('')
    setTargetAmount('')
    setTransactionReference(null)
  }, [])

  // Show TxStatus screen right after signing
  const showTxStatus = useCallback((id: null | string, reference: null | string) => {
    if (id) setTransactionId(id)
    if (reference) setTransactionReference(reference)
    setView('txStatus')
  }, [])

  // Reset from TxStatus to start a fresh transaction
  const resetForNewTransaction = useCallback(() => {
    setSwapData(null)
    setSourceAmount('')
    setTargetAmount('')
    setTransactionId(null)
    setTransactionReference(null)
    setView('swap')
  }, [])

  // Determine desired desktop background URL based on currency
  const currentBgUrl = targetCurrency === 'BRL' ? BRL_BACKGROUND_IMAGE : ASSET_URLS.BACKGROUND_IMAGE

  const onOpenQr = useCallback(() => {
    setIsQrOpen(true)
    setTargetCurrency(TargetCurrency.BRL)
  }, [])

  const redirectToKYCAuth = useCallback(() => {
    setView('kyc-needed')
  }, [])

  useEffect(() => {
    console.log('view', view)
  }, [view])

  return {
    address,
    closeQr: () => setIsQrOpen(false),
    currentBgUrl,
    handleAmountsChange,
    handleBackToSwap,
    handleQrResult,
    handleSwapContinue,
    handleTargetChange: fetchQuote,
    handleTransactionComplete,
    handleTransactionFailed,
    handleWalletConnectClose,
    // Handlers
    handleWalletConnectOpen,
    handleWalletDetailsClose,

    handleWalletDetailsOpen,
    handleWalletSelect,
    isDecodingQr,
    isQrOpen,
    isWalletDetailsOpen,
    isWalletModalOpen,
    openQr: onOpenQr,
    pixKey,
    quoteId: quote_id,
    redirectToKYCAuth,
    resetForNewTransaction,
    setPixKey,
    setQuoteId: setquote_id,
    setTaxId,
    showTxStatus,
    sourceAmount,
    swapData,
    targetAmount,
    targetCurrency,
    taxId,
    transactionId,
    transactionReference,
    // State
    view,
  }
}

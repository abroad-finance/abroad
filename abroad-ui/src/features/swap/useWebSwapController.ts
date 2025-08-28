import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import { _36EnumsBlockchainNetwork as BlockchainNetwork, _36EnumsCryptoCurrency as CryptoCurrency, decodeQrCodeBR, getQuote, _36EnumsPaymentMethod as PaymentMethod, _36EnumsTargetCurrency as TargetCurrency } from '../../api/index'
import { WebSwapControllerProps } from '../../pages/WebSwap/WebSwap'
import { ASSET_URLS, BRL_BACKGROUND_IMAGE } from './webSwap.constants'

type UseWebSwapControllerProps = {
  setPixKey: (key: string) => void
  setQuoteId: (id: string) => void
  setSourceAmount: (amount: string) => void
  setTargetAmount: (amount: string) => void
  setTargetCurrency: (currency: (typeof TargetCurrency)[keyof typeof TargetCurrency]) => void
  setTaxId: (id: string) => void
  targetCurrency: TargetCurrency
}

export const useWebSwapController = ({ setPixKey, setQuoteId, setSourceAmount, setTargetAmount, setTargetCurrency, setTaxId, targetCurrency }: UseWebSwapControllerProps): WebSwapControllerProps => {
  // Modal visibility state
  const [isWalletDetailsOpen, setIsWalletDetailsOpen] = useState(false)

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

  return {
    closeQr: () => setIsQrOpen(false),
    currentBgUrl,
    handleQrResult,
    handleWalletDetailsClose,
    handleWalletDetailsOpen,
    isDecodingQr,
    isDesktop,
    isQrOpen,
    isWalletDetailsOpen,
    setIsQrOpen,
  }
}

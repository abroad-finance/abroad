import {
  Asset,
  BASE_FEE,
  Horizon,
  Memo,
  Networks,
  Operation,
  Transaction,
  TransactionBuilder,
} from '@stellar/stellar-sdk'
import { useTranslate } from '@tolgee/react'
import {
  useCallback, useEffect, useMemo, useState,
} from 'react'
import { useSearchParams } from 'react-router-dom'

import {
  acceptTransaction, _36EnumsBlockchainNetwork as BlockchainNetwork, _36EnumsCryptoCurrency as CryptoCurrency, decodeQrCodeBR, getQuote, _36EnumsPaymentMethod as PaymentMethod, _36EnumsTargetCurrency as TargetCurrency,
} from '../../api/index'
import { BRL_BACKGROUND_IMAGE } from '../../features/swap/constants'
import { SwapView } from '../../features/swap/types'
import { ASSET_URLS, PENDING_TX_KEY } from '../../shared/constants'
import { useWalletAuth } from '../../shared/hooks/useWalletAuth'
import { hasMessage } from '../../shared/utils'
import { WebSwapControllerProps } from './WebSwap'

type UseWebSwapControllerProps = {
  accountNumber: string
  bankCode: string
  pixKey: string
  qrCode: null | string
  quoteId: string
  setPixKey: (key: string) => void
  setQrCode: (code: string) => void
  setQuoteId: (id: string) => void
  setRecipentName: (name: string) => void
  setSourceAmount: (amount: string) => void
  setTargetAmount: (amount: string) => void
  setTargetCurrency: (currency: (typeof TargetCurrency)[keyof typeof TargetCurrency]) => void
  setTaxId: (id: string) => void
  setTransactionId: (id: null | string) => void
  setView: (view: SwapView) => void
  sourceAmount: string
  targetCurrency: TargetCurrency
  taxId: string
}

const networkPassphrase = Networks.PUBLIC
const server = new Horizon.Server('https://horizon.stellar.org')

export const useWebSwapController = (props: UseWebSwapControllerProps): WebSwapControllerProps => {
  const {
    accountNumber,
    bankCode,
    pixKey,
    qrCode,
    quoteId,
    setPixKey,
    setQrCode,
    setQuoteId,
    setRecipentName,
    setSourceAmount,
    setTargetAmount,
    setTargetCurrency,
    setTaxId,
    setTransactionId,
    setView,
    sourceAmount,
    targetCurrency,
    taxId,
  } = props

  // Modal visibility state
  const [isWalletDetailsOpen, setIsWalletDetailsOpen] = useState(false)
  const { kit, setKycUrl, walletAuthentication } = useWalletAuth()
  const { t } = useTranslate()

  // QR scanner state and URL param handling
  const [isQrOpen, setIsQrOpen] = useState(false)
  const [loadingSubmit, setLoadingSubmit] = useState(false)
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
    if (stored && walletAuthentication?.jwtToken) {
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
    walletAuthentication?.jwtToken,
  ])

  const handleWalletDetailsOpen = useCallback(() => setIsWalletDetailsOpen(true), [])
  const handleWalletDetailsClose = useCallback(() => setIsWalletDetailsOpen(false), [])

  const handleAmountsChange = useCallback(({ currency, src, tgt }: {
    currency?: (typeof TargetCurrency)[keyof typeof TargetCurrency]
    src?: string
    tgt?: string
  }) => {
    if (typeof src === 'string') setSourceAmount(src || '')
    if (typeof tgt === 'string') setTargetAmount(tgt || '')
    if (typeof currency === 'string') setTargetCurrency(currency)
  }, [
    setSourceAmount,
    setTargetAmount,
    setTargetCurrency,
  ])

  const fetchQuote = useCallback(async (targetAmount: number) => {
    console.log('handleTargetChange called with:', {
      targetAmount,
      targetCurrency,
      targetPaymentMethod,
    })
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
    setQrCode(text)
    try {
      const responseDecoder = await decodeQrCodeBR({ qrCode: text })
      if (responseDecoder.status !== 200) {
        alert(responseDecoder.data.reason)
        return
      }
      console.log('QR Scanned', responseDecoder.data)
      const amount = responseDecoder.data?.decoded?.amount
      const pixKey = responseDecoder.data.decoded?.account
      const taxIdDecoded = responseDecoder.data.decoded?.taxId
      const name = responseDecoder.data.decoded?.name
      if (name) {
        setRecipentName(name)
      }
      if (amount) {
        handleAmountsChange({ tgt: amount })
        fetchQuote(parseFloat(amount))
      }
      if (pixKey) {
        setPixKey(pixKey)
      }
      if (taxIdDecoded && !taxIdDecoded.includes('*')) {
        setTaxId(taxIdDecoded)
      }
      // Redirect to the confirmation view so user can verify decoded data
      setView('confirm-qr')
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
    setQrCode,
    setRecipentName,
    setTaxId,
    setView,
  ])

  const isDesktop = useMemo(() => window.innerWidth >= 768, [])

  // Determine desired desktop background URL based on currency
  const currentBgUrl = targetCurrency === 'BRL' ? BRL_BACKGROUND_IMAGE : ASSET_URLS.BACKGROUND_IMAGE

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
  // --------------------------- HELPERS ----------------------------------------

  const buildPaymentXdr = useCallback(
    async ({
      amount,
      asset,
      destination,
      memoValue,
      source,
    }: {
      amount: string
      asset: Asset
      destination: string
      memoValue: string
      source: string
    }): Promise<string> => {
      try {
        const account = await server.loadAccount(source)
        const fee = await server.fetchBaseFee()
        const tx = new TransactionBuilder(account, {
          fee: String(fee || BASE_FEE),
          networkPassphrase,
        })
          .addOperation(
            Operation.payment({
              amount,
              asset,
              destination,
            }),
          )
          .addMemo(Memo.text(memoValue))
          .setTimeout(180)
          .build()
        return tx.toXDR()
      }
      catch (err: unknown) {
        let detail = ''
        if (err instanceof Error) detail = err.message
        else if (typeof err === 'object' && err !== null) detail = JSON.stringify(err)
        else detail = String(err)
        const message = `${t('bank_details.error_creating_transaction', 'No se pudo crear la transacción de pago')}: ${detail}`
        throw new Error(message)
      }
    },
    [t],
  )

  // --------------------------- SUBMIT FLOW ------------------------------------
  const handleTransactionFlow = useCallback(async () => {
    setLoadingSubmit(true)
    try {
      if (!quoteId || !kit?.address) throw new Error('Quote ID or User ID missing.')

      // 1) Reserve quote & obtain details
      const redirectUrl = encodeURIComponent(
        window.location.href.replace(/^https?:\/\//, ''),
      )
      const response = await acceptTransaction({
        account_number:
          targetCurrency === TargetCurrency.BRL ? pixKey : accountNumber,
        bank_code: targetCurrency === TargetCurrency.BRL ? 'PIX' : bankCode,
        qr_code: qrCode,
        quote_id: quoteId,
        redirectUrl,
        tax_id: targetCurrency === TargetCurrency.BRL ? taxId : undefined,
        user_id: kit.address,
      })

      if (response.status !== 200) {
        alert(`Error: ${response.data.reason}`)
        return
      }

      const { id: acceptedTxId, kycLink, transaction_reference } = response.data

      const stellar_account = import.meta.env.VITE_ABROAD_STELLAR_ADDRESS
      const asset_code = 'USDC'
      const asset_issuer
        = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN'

      // 2) Redirect to KYC if needed
      if (kycLink) {
        setKycUrl(kycLink)
        setView('kyc-needed')
        return
      }

      // cleanup pending
      localStorage.removeItem(PENDING_TX_KEY)

      // 3) If no wallet connected, finalize SEP flow via redirect
      if (kit?.walletId === 'sep24') {
        const queryParams = new URLSearchParams(window.location.search)
        const callbackUrl = queryParams.get('callback')
        const sepTransactionId = queryParams.get('transaction_id')
        const sepBaseUrl
          = import.meta.env.VITE_SEP_BASE_URL || 'http://localhost:8000'
        let url = encodeURI(
          `${sepBaseUrl}/sep24/transactions/withdraw/interactive/complete?amount_expected=${sourceAmount}&transaction_id=${sepTransactionId}`,
        )
        if (callbackUrl && callbackUrl.toLowerCase() !== 'none') {
          url += `&callback=${encodeURIComponent(callbackUrl)}`
        }
        if (transaction_reference) {
          url += `&memo=${encodeURIComponent(transaction_reference)}`
        }
        localStorage.removeItem(PENDING_TX_KEY)
        window.location.href = url
        return
      }

      // 4) Build payment XDR
      const paymentAsset = new Asset(asset_code, asset_issuer)
      if (!kit?.address) {
        throw new Error('Wallet address is not available.')
      }
      const unsignedXdr = await buildPaymentXdr({
        amount: sourceAmount,
        asset: paymentAsset,
        destination: stellar_account,
        memoValue: transaction_reference ?? '',
        source: kit.address,
      })

      // 5) Sign via wallet
      setView('wait-sign')
      const { signedTxXdr } = await kit.signTransaction({ message: unsignedXdr })

      // Show TxStatus UI right after signing
      setTransactionId(acceptedTxId || null)
      setView('txStatus')

      // 6) Submit the transaction
      const tx = new Transaction(signedTxXdr, networkPassphrase)
      await server.submitTransaction(tx)
    }
    catch (err) {
      console.error('Transaction submission error:', err)
      let userMessage = 'Transaction error'
      if (err instanceof Error) userMessage = err.message
      else if (hasMessage(err)) userMessage = err.message
      alert(userMessage)
      resetForNewTransaction()
    }
    finally {
      setLoadingSubmit(false)
    }
  }, [
    quoteId,
    kit,
    targetCurrency,
    pixKey,
    accountNumber,
    bankCode,
    qrCode,
    taxId,
    buildPaymentXdr,
    sourceAmount,
    setView,
    setTransactionId,
    setKycUrl,
    resetForNewTransaction,
  ])

  return {
    closeQr: () => setIsQrOpen(false),
    currentBgUrl,
    handleBackToSwap,
    handleQrResult,
    handleTransactionFlow,
    handleWalletDetailsClose,
    handleWalletDetailsOpen,
    isDecodingQr,
    isDesktop,
    isQrOpen,
    isWalletDetailsOpen,
    loadingSubmit,
    resetForNewTransaction,
    setIsQrOpen,
  }
}

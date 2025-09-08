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
import { useCallback, useEffect, useMemo, useState } from 'react'

import type { Option } from '../../../shared/components/DropSelector'
import type { BankDetailsRouteProps } from '../components/BankDetailsRoute'
import type { SwapView } from '../types'

import {
  acceptTransaction,
  Bank,
  getBanks,
  getBanksResponse200,
  _36EnumsTargetCurrency as TargetCurrency,
} from '../../../api'
import { useWalletAuth } from '../../../shared/hooks/useWalletAuth'
import { hasMessage } from '../../../shared/utils'
import { BANK_CONFIG } from '../constants'

type UseBankDetailsRouteArgs = {
  isDesktop?: boolean
  onBackClick: () => void
  onRedirectToHome: () => void
  pixKey: string
  quoteId: string
  setPixKey: (pixKey: string) => void
  setTaxId: (taxId: string) => void
  setTransactionId: (id: null | string) => void
  setView: (view: SwapView) => void
  sourceAmount: string
  targetAmount: string
  targetCurrency: (typeof TargetCurrency)[keyof typeof TargetCurrency]
  taxId: string
  userId: null | string
}

const networkPassphrase = Networks.PUBLIC
const server = new Horizon.Server('https://horizon.stellar.org')
const PENDING_TX_KEY = 'pendingTransaction'

// Banks to exclude --------------------------------------------------------------
const EXCLUDED_BANKS = [
  'CFA COOPERATIVA FINANCIERA',
  'CONFIAR COOPERATIVA FINANCIERA',
  'BANCOCOOPCENTRAL',
  'BANCO SERFINANZA',
  'BANCO FINANDINA',
  'BANCO CREZCAMOS',
  'BANCO POWWI',
  'SUPERDIGITAL',
  'BANCAMIA',
]

export const useBankDetailsRoute = ({
  isDesktop,
  onBackClick,
  onRedirectToHome,
  pixKey,
  quoteId,
  setPixKey,
  setTaxId,
  setTransactionId,
  setView,
  sourceAmount,
  targetAmount,
  targetCurrency,
  taxId,
  userId,
}: UseBankDetailsRouteArgs): BankDetailsRouteProps => {
  const textColor = isDesktop ? 'white' : '#356E6A'
  const { t } = useTranslate()
  const { kit, setKycUrl, token } = useWalletAuth()

  // ------------------------------- STATE -----------------------------------
  const [accountNumber, setAccountNumber] = useState('')
  const [bankCode, setBankCode] = useState<string>('')

  const [loadingSubmit, setLoadingSubmit] = useState(false)
  const [bankOpen, setBankOpen] = useState(false)
  const [selectedBank, setSelectedBank] = useState<null | Option>(null)

  const [apiBanks, setApiBanks] = useState<Bank[]>([])
  const [loadingBanks, setLoadingBanks] = useState<boolean>(false)
  const [errorBanks, setErrorBanks] = useState<null | string>(null)

  // ------------------------------ EFFECTS -----------------------------------

  // Restore saved details (returning from KYC)
  useEffect(() => {
    const stored = localStorage.getItem(PENDING_TX_KEY)
    if (stored && token) {
      try {
        const parsed = JSON.parse(stored)
        if (parsed.account_number) setAccountNumber(parsed.account_number)
        if (parsed.bank_code) setBankCode(parsed.bank_code)
        if (parsed.pixKey) setPixKey(parsed.pixKey)
        if (parsed.taxId) setTaxId(parsed.taxId)
        if (parsed.selectedBank) setSelectedBank(parsed.selectedBank)
      }
      catch (e) {
        console.error('Failed to restore pending transaction', e)
      }
    }
  }, [
    setPixKey,
    setTaxId,
    token,
  ])

  // Fetch banks once for COP flow
  useEffect(() => {
    ;(async () => {
      if (targetCurrency !== TargetCurrency.COP) return
      setLoadingBanks(true)
      setErrorBanks(null)
      try {
        const response = await getBanks()
        if (
          response.status === 200
          && (response as getBanksResponse200).data?.banks
        ) {
          setApiBanks((response as getBanksResponse200).data.banks)
        }
        else {
          const errorMessage
            = response.status === 400
              ? 'Bad request to bank API.'
              : `Failed to fetch banks. Status: ${response.status}`
          setErrorBanks(errorMessage)
          console.error('Error fetching banks:', response)
        }
      }
      catch (err) {
        setErrorBanks(
          err instanceof Error
            ? err.message
            : 'An unknown error occurred while fetching banks.',
        )
        console.error(err)
      }
      finally {
        setLoadingBanks(false)
      }
    })()
  }, [targetCurrency])

  // --------------------------- DERIVED DATA ---------------------------------

  const bankOptions: Option[] = useMemo(
    () => {
      const priorityBanks = [
        'BANCOLOMBIA',
        'DAVIPLATA',
        'DAVIVIENDA',
        'NEQUI',
      ]

      return apiBanks
        .filter((bank: Bank) => !EXCLUDED_BANKS.includes(bank.bankName.toUpperCase()))
        .map((bank: Bank) => {
          const bankNameUpper = bank.bankName.toUpperCase()
          const config = BANK_CONFIG[bankNameUpper]
          return {
            iconUrl: config?.iconUrl,
            label: config?.displayLabel || bank.bankName,
            value: String(bank.bankCode),
          }
        })
        .sort((a, b) => {
          const aIsPriority = priorityBanks.some(priority =>
            a.label.toUpperCase().includes(priority),
          )
          const bIsPriority = priorityBanks.some(priority =>
            b.label.toUpperCase().includes(priority),
          )

          // Both are priority - sort by priority order
          if (aIsPriority && bIsPriority) {
            const aIndex = priorityBanks.findIndex(priority =>
              a.label.toUpperCase().includes(priority),
            )
            const bIndex = priorityBanks.findIndex(priority =>
              b.label.toUpperCase().includes(priority),
            )
            return aIndex - bIndex
          }

          // One is priority - priority comes first
          if (aIsPriority && !bIsPriority) return -1
          if (!aIsPriority && bIsPriority) return 1

          // Neither is priority - sort alphabetically
          return a.label.localeCompare(b.label)
        })
    },
    [apiBanks],
  )

  const continueDisabled = useMemo(() => {
    if (loadingSubmit) return true
    if (targetCurrency === TargetCurrency.BRL) {
      return !(pixKey && taxId)
    }
    return (
      loadingBanks
      || !!errorBanks
      || !selectedBank
      || accountNumber.length !== 10
    )
  }, [
    loadingSubmit,
    targetCurrency,
    pixKey,
    taxId,
    loadingBanks,
    errorBanks,
    selectedBank,
    accountNumber,
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

  // --------------------------- INPUT HANDLERS ---------------------------------

  const onAccountNumberChange = useCallback((value: string) => {
    const input = value.replace(/[^\d]/g, '').slice(0, 10)
    setAccountNumber(input)
  }, [])

  const onTaxIdChange = useCallback(
    (value: string) => {
      const input = value.replace(/[^\d]/g, '')
      setTaxId(input)
    },
    [setTaxId],
  )

  const onPixKeyChange = useCallback(
    (value: string) => setPixKey(value),
    [setPixKey],
  )

  const onSelectBank = useCallback(
    (option: Option) => {
      setSelectedBank(option)
      setBankCode(option.value)
    },
    [],
  )

  // --------------------------- SUBMIT FLOW ------------------------------------

  const onContinue = useCallback(async () => {
    setLoadingSubmit(true)
    try {
      if (!quoteId || !userId) throw new Error('Quote ID or User ID missing.')

      // 1) Reserve quote & obtain details
      const redirectUrl = encodeURIComponent(
        window.location.href.replace(/^https?:\/\//, ''),
      )
      const response = await acceptTransaction({
        account_number:
          targetCurrency === TargetCurrency.BRL ? pixKey : accountNumber,
        bank_code: targetCurrency === TargetCurrency.BRL ? 'PIX' : bankCode,
        quote_id: quoteId,
        redirectUrl,
        tax_id: targetCurrency === TargetCurrency.BRL ? taxId : undefined,
        user_id: userId,
      })

      if (response.status !== 200) {
        alert(`Error: ${response.data.reason}`)
        return
      }

      const {
        id: acceptedTxId,
        kycLink,
        transaction_reference,
      } = response.data

      const stellar_account = import.meta.env.VITE_ABROAD_STELLAR_ADDRESS
      const asset_code = 'USDC'
      const asset_issuer
        = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN'

      // 2) Redirect to KYC if needed
      if (kycLink) {
        localStorage.setItem(
          PENDING_TX_KEY,
          JSON.stringify({
            account_number:
              targetCurrency === TargetCurrency.BRL ? pixKey : accountNumber,
            bank_code: targetCurrency === TargetCurrency.BRL ? 'PIX' : bankCode,
            pixKey: targetCurrency === TargetCurrency.BRL ? pixKey : undefined,
            quote_id: quoteId,
            selectedBank,
            srcAmount: sourceAmount,
            targetCurrency,
            taxId: targetCurrency === TargetCurrency.BRL ? taxId : undefined,
            tgtAmount: targetAmount,
            userId,
          }),
        )
        setKycUrl(kycLink)
        setView('kyc-needed')
        return
      }

      // cleanup pending
      localStorage.removeItem(PENDING_TX_KEY)

      // 3) If no wallet connected, finalize SEP flow via redirect
      if (!kit?.walletId) {
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
      if (!kit.address) {
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
      onRedirectToHome()
    }
    finally {
      setLoadingSubmit(false)
    }
  }, [
    quoteId,
    userId,
    targetCurrency,
    pixKey,
    accountNumber,
    bankCode,
    taxId,
    buildPaymentXdr,
    sourceAmount,
    setView,
    kit,
    setTransactionId,
    selectedBank,
    targetAmount,
    setKycUrl,
    onRedirectToHome,
  ])

  // --------------------------- RETURN (props for stateless view) --------------

  return {
    accountNumber,
    bankOpen,
    bankOptions,
    continueDisabled,
    errorBanks,
    loadingBanks,
    loadingSubmit,
    onAccountNumberChange,
    onBackClick,
    onContinue,
    onPixKeyChange,
    onSelectBank,
    onTaxIdChange,
    pixKey,
    selectedBank,
    setBankOpen,
    targetAmount,
    targetCurrency,
    taxId,
    textColor,
  }
}

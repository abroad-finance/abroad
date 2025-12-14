import {
  useCallback, useEffect, useMemo, useState,
} from 'react'

import type { Option } from '../../../shared/components/DropSelector'
import type { BankDetailsRouteProps } from '../components/BankDetailsRoute'
import type { SwapView } from '../types'

import {
  Bank,
  getBanks,
  getBanksResponse200,
  _36EnumsPaymentMethod as PaymentMethod,
  _36EnumsTargetCurrency as TargetCurrency,
} from '../../../api'
import { useWalletAuth } from '../../../shared/hooks/useWalletAuth'
import { BANK_CONFIG } from '../constants'

type UseBankDetailsRouteArgs = {
  accountNumber: string
  isDesktop?: boolean
  onBackClick: () => void
  pixKey: string
  setAccountNumber: (accountNumber: string) => void
  setBankCode: (bankCode: string) => void
  setPixKey: (pixKey: string) => void
  setTaxId: (taxId: string) => void
  setView: (view: SwapView) => void
  targetAmount: string
  targetCurrency: (typeof TargetCurrency)[keyof typeof TargetCurrency]
  taxId: string
}

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
  accountNumber,
  isDesktop,
  onBackClick,
  pixKey,
  setAccountNumber,
  setBankCode,
  setPixKey,
  setTaxId,
  setView,
  targetAmount,
  targetCurrency,
  taxId,
}: UseBankDetailsRouteArgs): BankDetailsRouteProps => {
  const textColor = isDesktop ? 'white' : '#356E6A'
  const { walletAuthentication } = useWalletAuth()

  // ------------------------------- STATE -----------------------------------

  const [bankOpen, setBankOpen] = useState(false)
  const [selectedBank, setSelectedBank] = useState<null | Option>(null)

  const [apiBanks, setApiBanks] = useState<Bank[]>([])
  const [loadingBanks, setLoadingBanks] = useState<boolean>(false)
  const [errorBanks, setErrorBanks] = useState<null | string>(null)

  // ------------------------------ EFFECTS -----------------------------------

  // Restore saved details (returning from KYC)
  useEffect(() => {
    const stored = localStorage.getItem(PENDING_TX_KEY)
    if (stored && walletAuthentication?.jwtToken) {
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
    setAccountNumber,
    setBankCode,
    setPixKey,
    setTaxId,
    walletAuthentication?.jwtToken,
  ])

  // Fetch banks once for COP flow
  useEffect(() => {
    ; (async () => {
      if (targetCurrency !== TargetCurrency.COP) return
      setLoadingBanks(true)
      setErrorBanks(null)
      try {
        const response = await getBanks({ paymentMethod: PaymentMethod.BREB })
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
        'BREB',
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
    if (targetCurrency === TargetCurrency.BRL) {
      return !(pixKey && taxId)
    }
    return (
      accountNumber.length !== 10
    )
  }, [
    targetCurrency,
    accountNumber.length,
    pixKey,
    taxId,
  ])

  // --------------------------- INPUT HANDLERS ---------------------------------

  const onAccountNumberChange = useCallback((value: string) => {
    const input = value.replace(/[^\d]/g, '').slice(0, 10)
    setAccountNumber(input)
  }, [setAccountNumber])

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
    [setBankCode],
  )

  const onContinue = useCallback(() => setView('confirm-qr'), [setView])

  // --------------------------- RETURN (props for stateless view) --------------

  return {
    accountNumber,
    bankOpen,
    bankOptions,
    continueDisabled,
    errorBanks,
    loadingBanks,
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

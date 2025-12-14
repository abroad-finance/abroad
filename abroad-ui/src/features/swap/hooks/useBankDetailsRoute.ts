import { useCallback, useEffect, useMemo } from 'react'

import type { BankDetailsRouteProps } from '../components/BankDetailsRoute'
import type { SwapView } from '../types'

import {
  _36EnumsTargetCurrency as TargetCurrency,
} from '../../../api'
import { useWalletAuth } from '../../../shared/hooks/useWalletAuth'

type UseBankDetailsRouteArgs = {
  accountNumber: string
  isDesktop?: boolean
  onBackClick: () => void
  pixKey: string
  setAccountNumber: (accountNumber: string) => void
  setPixKey: (pixKey: string) => void
  setTaxId: (taxId: string) => void
  setView: (view: SwapView) => void
  targetAmount: string
  targetCurrency: (typeof TargetCurrency)[keyof typeof TargetCurrency]
  taxId: string
}

const PENDING_TX_KEY = 'pendingTransaction'

export const useBankDetailsRoute = ({
  accountNumber,
  isDesktop,
  onBackClick,
  pixKey,
  setAccountNumber,
  setPixKey,
  setTaxId,
  setView,
  targetAmount,
  targetCurrency,
  taxId,
}: UseBankDetailsRouteArgs): BankDetailsRouteProps => {
  const textColor = isDesktop ? 'white' : '#356E6A'
  const { walletAuthentication } = useWalletAuth()

  // ------------------------------ EFFECTS -----------------------------------

  // Restore saved details (returning from KYC)
  useEffect(() => {
    const stored = localStorage.getItem(PENDING_TX_KEY)
    if (stored && walletAuthentication?.jwtToken) {
      try {
        const parsed = JSON.parse(stored)
        if (parsed.account_number) setAccountNumber(parsed.account_number)
        if (parsed.pixKey) setPixKey(parsed.pixKey)
        if (parsed.taxId) setTaxId(parsed.taxId)
      }
      catch (e) {
        console.error('Failed to restore pending transaction', e)
      }
    }
  }, [
    setAccountNumber,
    setPixKey,
    setTaxId,
    walletAuthentication?.jwtToken,
  ])

  const continueDisabled = useMemo(() => {
    if (targetCurrency === TargetCurrency.BRL) {
      return !(pixKey && taxId)
    }
    return accountNumber.trim().length < 6
  }, [
    targetCurrency,
    accountNumber,
    pixKey,
    taxId,
  ])

  // --------------------------- INPUT HANDLERS ---------------------------------

  const onAccountNumberChange = useCallback((value: string) => {
    const sanitized = value.trim().slice(0, 64)
    setAccountNumber(sanitized)
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

  const onContinue = useCallback(() => setView('confirm-qr'), [setView])

  // --------------------------- RETURN (props for stateless view) --------------

  return {
    accountNumber,
    continueDisabled,
    onAccountNumberChange,
    onBackClick,
    onContinue,
    onPixKeyChange,
    onTaxIdChange,
    pixKey,
    targetAmount,
    targetCurrency,
    taxId,
    textColor,
  }
}

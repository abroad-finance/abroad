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
  setView: (view: SwapView) => void
  targetAmount: string
  targetCurrency: (typeof TargetCurrency)[keyof typeof TargetCurrency]
}

const PENDING_TX_KEY = 'pendingTransaction'

export const useBankDetailsRoute = ({
  accountNumber,
  onBackClick,
  pixKey,
  setAccountNumber,
  setPixKey,
  setView,
  targetAmount,
  targetCurrency,
}: UseBankDetailsRouteArgs): BankDetailsRouteProps => {
  const { walletAuthentication } = useWalletAuth()

  // ------------------------------ EFFECTS -----------------------------------

  // Restore saved details (returning from KYC)
  useEffect(() => {
    const stored = localStorage.getItem(PENDING_TX_KEY)
    if (!stored || !walletAuthentication?.jwtToken) return

    try {
      const parsed = JSON.parse(stored) as {
        account_number?: string
        accountNumber?: string
        pixKey?: string
      }

      const accountNumberValue = parsed.accountNumber ?? parsed.account_number
      if (accountNumberValue) setAccountNumber(accountNumberValue)
      if (parsed.pixKey) setPixKey(parsed.pixKey)
    }
    catch (e) {
      if (import.meta.env.DEV) {
        console.error('Failed to restore pending transaction', e)
      }
    }
  }, [
    setAccountNumber,
    setPixKey,
    walletAuthentication?.jwtToken,
  ])

  const continueDisabled = useMemo(() => {
    if (targetCurrency === TargetCurrency.BRL) {
      return pixKey.trim().length === 0
    }
    return accountNumber.trim().length < 6
  }, [
    targetCurrency,
    accountNumber,
    pixKey,
  ])

  // --------------------------- INPUT HANDLERS ---------------------------------

  const onAccountNumberChange = useCallback((value: string) => {
    const sanitized = value.trim().slice(0, 64)
    setAccountNumber(sanitized)
  }, [setAccountNumber])

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
    pixKey,
    targetAmount,
    targetCurrency,
  }
}

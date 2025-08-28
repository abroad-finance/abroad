import { useCallback } from 'react'

import { _36EnumsTargetCurrency as TargetCurrency } from '../../../api/index'
import { BankDetailsRouteProps } from '../components/BankDetailsRoute'
import { SwapView } from '../webSwap.types'

type UseBankDetailsRoute = {
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

export const useBankDetailsRoute = ({ isDesktop, onBackClick, onRedirectToHome, pixKey, quoteId, setPixKey, setTaxId, setTransactionId, setView, sourceAmount, targetAmount, targetCurrency, taxId, userId }: UseBankDetailsRoute): BankDetailsRouteProps => {
  const textColor = isDesktop ? 'white' : undefined

  // Show TxStatus screen right after signing
  const showTxStatus = useCallback((id: null | string) => {
    if (id) setTransactionId(id)
    setView('txStatus')
  }, [setTransactionId, setView])

  const redirectToKYCAuth = useCallback(() => {
    setView('kyc-needed')
  }, [setView])

  const redirectToWaitSign = useCallback(() => {
    setView('wait-sign')
  }, [setView])

  return {
    onBackClick,
    onKycRedirect: redirectToKYCAuth,
    onRedirectToHome,
    onRedirectToWaitSign: redirectToWaitSign,
    onTransactionSigned: id => showTxStatus(id),
    pixKey,
    quote_id: quoteId,
    setPixKey,
    setTaxId,
    sourceAmount,
    targetAmount,
    targetCurrency,
    taxId,
    textColor,
    userId,
  }
}

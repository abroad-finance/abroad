import React, { useEffect, useState } from 'react'
import { lazy, Suspense } from 'react'

import { useWebSwapController } from './useWebSwapController'
const QrScannerFullScreen = lazy(() => import('../../features/swap/components/QrScannerFullScreen'))
import { Loader } from 'lucide-react'

import { _36EnumsTargetCurrency as TargetCurrency } from '../../api/index'
import { useWalletAuth } from '../../contexts/WalletAuthContext'
import BankDetailsRoute from '../../features/swap/components/BankDetailsRoute'
import NavBarResponsive from '../../features/swap/components/NavBarResponsive'
import Swap from '../../features/swap/components/Swap'
import TxStatus from '../../features/swap/components/TxStatus'
import UserVerification from '../../features/swap/components/UserVerification'
import WaitSign from '../../features/swap/components/WaitSign'
import WalletDetails from '../../features/swap/components/WalletDetails'
import WebSwapLayout from '../../features/swap/components/WebSwapLayout'
import { useBankDetailsRoute } from '../../features/swap/hooks/useBankDetailsRoute'
import { useSwap } from '../../features/swap/hooks/useSwap'
import { SwapView } from '../../features/swap/types'
import BackgroundCrossfade from '../../shared/components/BackgroundCrossfade'
import LanguageSelector from '../../shared/components/LanguageSelector'
import { ModalOverlay } from '../../shared/components/ModalOverlay'
import { swapBus } from '../../shared/events/swapBus'
import { useWalletDetails } from '../../shared/hooks'
import { useLanguageSelector, useNavBarResponsive } from '../../shared/hooks'

export interface WebSwapControllerProps {
  closeQr: () => void
  currentBgUrl: string
  handleBackToSwap: () => void
  handleKycRedirect: () => void
  handleQrResult: (text: string) => Promise<void>
  handleWalletDetailsClose: () => void
  handleWalletDetailsOpen: () => void
  isDecodingQr: boolean
  isDesktop: boolean
  isQrOpen: boolean
  isWalletDetailsOpen: boolean
  resetForNewTransaction: () => void
}

const WebSwap: React.FC = () => {
  const { address } = useWalletAuth()

  // State management
  const [view, setView] = useState<SwapView>('swap')
  const [transactionId, setTransactionId] = useState<null | string>(null)
  const [sourceAmount, setSourceAmount] = useState('')
  const [targetAmount, setTargetAmount] = useState('')
  const [targetCurrency, setTargetCurrency] = useState<(typeof TargetCurrency)[keyof typeof TargetCurrency]>(TargetCurrency.BRL)
  const [quoteId, setQuoteId] = useState<string>('')
  const [pixKey, setPixKey] = useState<string>('')
  const [taxId, setTaxId] = useState<string>('')

  // Main controller
  const {
    closeQr,
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
  } = useWebSwapController({ targetCurrency })

  // Wire event bus listeners to update state (cause-based events)
  useEffect(() => {
    const onTargetCurrencySelected = (p: { currency: (typeof TargetCurrency)[keyof typeof TargetCurrency] }) => setTargetCurrency(p.currency)
    const onUserSourceChanged = (p: { value: string }) => setSourceAmount(p.value)
    const onUserTargetChanged = (p: { value: string }) => setTargetAmount(p.value)
    const onQuoteFromSource = (p: { quoteId: string, targetAmount: string }) => {
      setQuoteId(p.quoteId)
      setTargetAmount(p.targetAmount)
    }
    const onQuoteFromTarget = (p: { quoteId: string, srcAmount: string }) => {
      setQuoteId(p.quoteId)
      setSourceAmount(p.srcAmount)
    }
    const onQuoteFromQr = (p: { quoteId: string, srcAmount: string }) => {
      setQuoteId(p.quoteId)
      setSourceAmount(p.srcAmount)
    }
    const onQrDecoded = (p: { amount?: string, pixKey?: string, taxId?: string }) => {
      if (typeof p.amount === 'string') setTargetAmount(p.amount)
      if (typeof p.pixKey === 'string') setPixKey(p.pixKey)
      if (typeof p.taxId === 'string') setTaxId(p.taxId)
    }
    const onBackToSwap = () => setView('swap')
    const onNewTransaction = () => {
      setSourceAmount('')
      setTargetAmount('')
      setTransactionId(null)
      setView('swap')
    }
    const onContinue = () => setView('bankDetails')
    const onKycRequired = () => setView('kyc-needed')
    const onSigningStarted = () => setView('wait-sign')
    const onTransactionSigned = (p: { transactionId: null | string }) => {
      setTransactionId(p.transactionId)
      setView('txStatus')
    }
    const onPendingRestored = (p: { quoteId?: string, srcAmount?: string, targetCurrency?: (typeof TargetCurrency)[keyof typeof TargetCurrency], tgtAmount?: string }) => {
      if (typeof p.quoteId === 'string') setQuoteId(p.quoteId)
      if (typeof p.srcAmount === 'string') setSourceAmount(p.srcAmount)
      if (typeof p.tgtAmount === 'string') setTargetAmount(p.tgtAmount)
      if (typeof p.targetCurrency === 'string') setTargetCurrency(p.targetCurrency)
      setView('bankDetails')
    }
    const onKycInputsRestored = (p: { pixKey?: string, taxId?: string }) => {
      if (typeof p.pixKey === 'string') setPixKey(p.pixKey)
      if (typeof p.taxId === 'string') setTaxId(p.taxId)
    }
    const onTargetCurrencyFromUrl = (p: { currency: (typeof TargetCurrency)[keyof typeof TargetCurrency] }) => setTargetCurrency(p.currency)
    const onPixKeyChanged = (p: { value: string }) => setPixKey(p.value)
    const onTaxIdChanged = (p: { value: string }) => setTaxId(p.value)

    swapBus.on('swap/targetCurrencySelected', onTargetCurrencySelected)
    swapBus.on('swap/userSourceInputChanged', onUserSourceChanged)
    swapBus.on('swap/userTargetInputChanged', onUserTargetChanged)
    swapBus.on('swap/quoteFromSourceCalculated', onQuoteFromSource)
    swapBus.on('swap/quoteFromTargetCalculated', onQuoteFromTarget)
    swapBus.on('swap/quoteFromQrCalculated', onQuoteFromQr)
    swapBus.on('swap/qrDecoded', onQrDecoded)
    swapBus.on('swap/backToSwapRequested', onBackToSwap)
    swapBus.on('swap/newTransactionRequested', onNewTransaction)
    swapBus.on('swap/continueRequested', onContinue)
    swapBus.on('swap/kycRequired', onKycRequired)
    swapBus.on('swap/walletSigningStarted', onSigningStarted)
    swapBus.on('swap/transactionSigned', onTransactionSigned)
    swapBus.on('swap/amountsRestoredFromPending', onPendingRestored)
    swapBus.on('bankDetails/kycInputsRestored', onKycInputsRestored)
    swapBus.on('swap/targetCurrencySetFromUrlParam', onTargetCurrencyFromUrl)
    swapBus.on('bankDetails/pixKeyChanged', onPixKeyChanged)
    swapBus.on('bankDetails/taxIdChanged', onTaxIdChanged)

    return () => {
      swapBus.off('swap/targetCurrencySelected', onTargetCurrencySelected)
      swapBus.off('swap/userSourceInputChanged', onUserSourceChanged)
      swapBus.off('swap/userTargetInputChanged', onUserTargetChanged)
      swapBus.off('swap/quoteFromSourceCalculated', onQuoteFromSource)
      swapBus.off('swap/quoteFromTargetCalculated', onQuoteFromTarget)
      swapBus.off('swap/quoteFromQrCalculated', onQuoteFromQr)
      swapBus.off('swap/qrDecoded', onQrDecoded)
      swapBus.off('swap/backToSwapRequested', onBackToSwap)
      swapBus.off('swap/newTransactionRequested', onNewTransaction)
      swapBus.off('swap/continueRequested', onContinue)
      swapBus.off('swap/kycRequired', onKycRequired)
      swapBus.off('swap/walletSigningStarted', onSigningStarted)
      swapBus.off('swap/transactionSigned', onTransactionSigned)
      swapBus.off('swap/amountsRestoredFromPending', onPendingRestored)
      swapBus.off('bankDetails/kycInputsRestored', onKycInputsRestored)
      swapBus.off('swap/targetCurrencySetFromUrlParam', onTargetCurrencyFromUrl)
      swapBus.off('bankDetails/pixKeyChanged', onPixKeyChanged)
      swapBus.off('bankDetails/taxIdChanged', onTaxIdChanged)
    }
  }, [])

  // Components controllers
  const navBar = useNavBarResponsive({
    onWalletDetails: handleWalletDetailsOpen,
  })
  const languageSelector = useLanguageSelector()
  const walletDetails = useWalletDetails({ onClose: handleWalletDetailsClose })
  const bankDetailRoute = useBankDetailsRoute({
    isDesktop,
    onBackClick: handleBackToSwap,
    onRedirectToHome: resetForNewTransaction,
    pixKey,
    quoteId,
    sourceAmount,
    targetAmount,
    targetCurrency,
    taxId,
    userId: address,
  })
  const swap = useSwap({
    isDesktop,
    quoteId,
    sourceAmount,
    targetAmount,
    targetCurrency,
  })

  return (
    <div className="w-screen min-h-screen md:h-screen md:overflow-hidden flex flex-col">
      {/* Desktop page background with crossfade (no white flash) */}
      <BackgroundCrossfade
        backgroundAttachment="fixed"
        imageUrl={currentBgUrl}
        positionClass="absolute inset-0"
        visibilityClass="hidden md:block"
        zIndexClass="z-0"
      />

      {/* Shared Navigation */}
      <div className="relative z-10 bg-green-50 md:bg-transparent">
        <NavBarResponsive
          {...navBar}
          languageSelector={<LanguageSelector {...languageSelector} />}
          languageSelectorMobile={
            <LanguageSelector {...languageSelector} variant="mobile" />
          }
        />
      </div>

      {/* Main Content Area */}
      <main className="flex-1 relative z-10 flex">
        <WebSwapLayout
          slots={{
            bankDetails: <BankDetailsRoute {...bankDetailRoute} />,
            kycNeeded: <UserVerification onVerify={handleKycRedirect} />,
            swap: <Swap {...swap} />,
            txStatus: (
              <TxStatus
                onNewTransaction={resetForNewTransaction}
                onRetry={handleBackToSwap}
                transactionId={transactionId}
              />
            ),
            waitSign: <WaitSign />,
          }}
          targetCurrency={targetCurrency}
          view={view}
        />
      </main>

      {/* Top-level Modals */}
      <ModalOverlay
        onClose={handleWalletDetailsClose}
        open={!!isWalletDetailsOpen}
      >
        <WalletDetails {...walletDetails} />
      </ModalOverlay>

      {/* Full-screen QR Scanner */}
      {isQrOpen
        && (
          <Suspense fallback={null}>
            <QrScannerFullScreen onClose={closeQr} onResult={handleQrResult} />
          </Suspense>
        )}

      {/* Decoding overlay */}
      {isDecodingQr
        && (
          <div className="fixed inset-0 z-[1100] bg-black/60 backdrop-blur-sm flex items-center justify-center">
            <div className="flex flex-col items-center gap-3 text-white">
              <Loader className="w-8 h-8 animate-spin" />
              <p className="text-sm">Decodificando QR…</p>
            </div>
          </div>
        )}
    </div>
  )
}

export default WebSwap

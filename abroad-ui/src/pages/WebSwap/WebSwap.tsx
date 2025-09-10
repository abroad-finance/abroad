import React, { useCallback, useState } from 'react'
import { lazy, Suspense } from 'react'

import { useWebSwapController } from './useWebSwapController'
const QrScannerFullScreen = lazy(() => import('../../features/swap/components/QrScannerFullScreen'))
import { Loader } from 'lucide-react'

import { _36EnumsTargetCurrency as TargetCurrency } from '../../api/index'
import BankDetailsRoute from '../../features/swap/components/BankDetailsRoute'
import ConfirmQr from '../../features/swap/components/ConfirmQr'
import NavBarResponsive from '../../features/swap/components/NavBarResponsive'
import Swap from '../../features/swap/components/Swap'
import TxStatus from '../../features/swap/components/TxStatus'
import UserVerification from '../../features/swap/components/UserVerification'
import WaitSign from '../../features/swap/components/WaitSign'
import WalletDetails from '../../features/swap/components/WalletDetails'
import WebSwapLayout from '../../features/swap/components/WebSwapLayout'
import { useBankDetailsRoute } from '../../features/swap/hooks/useBankDetailsRoute'
import { useSwap } from '../../features/swap/hooks/useSwap'
import { useWalletDetails } from '../../features/swap/hooks/useWalletDetails'
import { SwapView } from '../../features/swap/types'
import BackgroundCrossfade from '../../shared/components/BackgroundCrossfade'
import LanguageSelector from '../../shared/components/LanguageSelector'
import { ModalOverlay } from '../../shared/components/ModalOverlay'
import { useLanguageSelector, useNavBarResponsive } from '../../shared/hooks'
import { useWalletAuth } from '../../shared/hooks/useWalletAuth'

export interface WebSwapControllerProps {
  closeQr: () => void
  currentBgUrl: string
  handleBackToSwap: () => void
  handleQrResult: (text: string) => Promise<void>
  handleWalletDetailsClose: () => void
  handleWalletDetailsOpen: () => void
  isDecodingQr: boolean
  isDesktop: boolean
  isQrOpen: boolean
  isWalletDetailsOpen: boolean
  resetForNewTransaction: () => void
  setIsQrOpen: (isOpen: boolean) => void
}

const WebSwap: React.FC = () => {
  const { kit } = useWalletAuth()

  // State management
  const [view, setView] = useState<SwapView>('swap')
  const [transactionId, setTransactionId] = useState<null | string>(null)
  const [sourceAmount, setSourceAmount] = useState('')
  const [targetAmount, setTargetAmount] = useState('')
  const [targetCurrency, setTargetCurrency] = useState<(typeof TargetCurrency)[keyof typeof TargetCurrency]>(TargetCurrency.BRL)
  const [quoteId, setQuoteId] = useState<string>('')
  const [pixKey, setPixKey] = useState<string>('')
  const [taxId, setTaxId] = useState<string>('')
  const [recipentName, setRecipentName] = useState<string>('')

  // Main controller
  const {
    closeQr,
    currentBgUrl,
    handleBackToSwap,
    handleQrResult,
    handleWalletDetailsClose,
    handleWalletDetailsOpen,
    isDecodingQr,
    isDesktop,
    isQrOpen,
    isWalletDetailsOpen,
    resetForNewTransaction,
    setIsQrOpen,
  } = useWebSwapController({
    setPixKey,
    setQuoteId,
    setRecipentName,
    setSourceAmount,
    setTargetAmount,
    setTargetCurrency,
    setTaxId,
    setTransactionId,
    setView,
    targetCurrency,
  })

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
    setPixKey,
    setTaxId,
    setTransactionId,
    setView,
    sourceAmount,
    targetAmount,
    targetCurrency,
    taxId,
    userId: kit?.address || null,
  })
  const swap = useSwap({
    isDesktop,
    quoteId,
    setIsQrOpen,
    setQuoteId,
    setSourceAmount,
    setTargetAmount,
    setTargetCurrency,
    setView,
    sourceAmount,
    targetAmount,
    targetCurrency,
  })

  // handler when user select continue on confirmation after QR code scan
  const handleOnConfirmQR = useCallback(() => {
    if (!targetAmount || !sourceAmount) {
      setView('swap')
      return
    }
    if (!taxId && targetCurrency === TargetCurrency.BRL) {
      setView('bankDetails')
      return
    }
    bankDetailRoute.onContinue()
  }, [
    bankDetailRoute,
    sourceAmount,
    targetAmount,
    targetCurrency,
    taxId,
  ])

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
            bankDetails: <BankDetailsRoute {...bankDetailRoute} onContinue={() => setView('confirm-qr')} />,
            confirmQr: (
              <ConfirmQr
                currency={targetCurrency}
                loadingSubmit={bankDetailRoute.loadingSubmit}
                onBack={handleBackToSwap}
                onConfirm={handleOnConfirmQR}
                onEdit={() => setView('swap')}
                pixKey={pixKey}
                recipentName={recipentName}
                sourceAmount={sourceAmount}
                targetAmount={targetAmount}
                taxId={taxId}
              />
            ),
            kycNeeded: (
              <UserVerification onApproved={() => setView('confirm-qr')} />
            ),
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

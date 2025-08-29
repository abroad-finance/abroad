import React from 'react'
import { lazy, Suspense } from 'react'

import { useWebSwapController } from './useWebSwapController'
const QrScannerFullScreen = lazy(() => import('../../features/swap/components/QrScannerFullScreen'))
import { Loader } from 'lucide-react'

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
import { useSwapView } from '../../features/swap/hooks/useSwapView'
import { useTxStatus } from '../../features/swap/hooks/useTxStatus'
import BackgroundCrossfade from '../../shared/components/BackgroundCrossfade'
import LanguageSelector from '../../shared/components/LanguageSelector'
import { ModalOverlay } from '../../shared/components/ModalOverlay'
import { useWalletDetails } from '../../shared/hooks'
import { useLanguageSelector, useNavBarResponsive } from '../../shared/hooks'

// Controller provides all swap state and event-driven values
const WebSwap: React.FC = () => {
  const { address } = useWalletAuth()

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
    isQrOpen,
    isWalletDetailsOpen,
    quoteId,
    resetForNewTransaction,
    sourceAmount,
    targetAmount,
    targetCurrency,
  } = useWebSwapController()

  // Components controllers
  const { view } = useSwapView()
  const { transactionId } = useTxStatus()
  const navBar = useNavBarResponsive({
    onWalletDetails: handleWalletDetailsOpen,
  })
  const languageSelector = useLanguageSelector()
  const walletDetails = useWalletDetails({ onClose: handleWalletDetailsClose })
  const bankDetailRoute = useBankDetailsRoute({
    onBackClick: handleBackToSwap,
    onRedirectToHome: resetForNewTransaction,
    quoteId,
    sourceAmount,
    targetAmount,
    targetCurrency,
    userId: address,
  })
  const swap = useSwap({
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

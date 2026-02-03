import React from 'react'
import { lazy, Suspense } from 'react'

import { useWebSwapController } from './useWebSwapController'
const QrScannerFullScreen = lazy(() => import('../../features/swap/components/QrScannerFullScreen'))
import { Loader } from 'lucide-react'

import type { BankDetailsRouteProps } from '../../features/swap/components/BankDetailsRoute'
import type { ConfirmQrProps } from '../../features/swap/components/ConfirmQr'
import type { SwapProps } from '../../features/swap/components/Swap'

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
import { useWalletDetails } from '../../features/swap/hooks/useWalletDetails'
import { SwapView } from '../../features/swap/types'
import BackgroundCrossfade from '../../shared/components/BackgroundCrossfade'
import LanguageSelector from '../../shared/components/LanguageSelector'
import { ModalOverlay } from '../../shared/components/ModalOverlay'
import { useLanguageSelector, useNavBarResponsive } from '../../shared/hooks'

export interface WebSwapControllerProps {
  bankDetailsProps: BankDetailsRouteProps
  closeQr: () => void
  confirmQrProps: ConfirmQrProps
  currentBgUrl: string
  handleBackToSwap: () => void
  handleKycApproved: () => void
  handleQrResult: (text: string) => Promise<void>
  handleWalletDetailsClose: () => void
  handleWalletDetailsOpen: () => void
  isDecodingQr: boolean
  isQrOpen: boolean
  isWalletDetailsOpen: boolean
  onWalletConnect: () => Promise<void>
  resetForNewTransaction: () => void
  swapViewProps: SwapProps
  targetAmount: string
  targetCurrency: TargetCurrency
  transactionId: null | string
  view: SwapView
}

const WebSwap: React.FC = () => {
  const {
    bankDetailsProps,
    closeQr,
    confirmQrProps,
    currentBgUrl,
    handleBackToSwap,
    handleKycApproved,
    handleQrResult,
    handleWalletDetailsClose,
    handleWalletDetailsOpen,
    isDecodingQr,
    isQrOpen,
    isWalletDetailsOpen,
    onWalletConnect,
    resetForNewTransaction,
    swapViewProps,
    targetAmount,
    targetCurrency,
    transactionId,
    view,
  } = useWebSwapController()

  // Components controllers
  const navBar = useNavBarResponsive({ onWalletConnect, onWalletDetails: handleWalletDetailsOpen })
  const languageSelector = useLanguageSelector()
  const walletDetails = useWalletDetails({ onClose: handleWalletDetailsClose })

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
            bankDetails: <BankDetailsRoute {...bankDetailsProps} />,
            confirmQr: <ConfirmQr {...confirmQrProps} />,
            kycNeeded: (
              <UserVerification onApproved={handleKycApproved} onClose={handleBackToSwap} />
            ),
            swap: <Swap {...swapViewProps} />,
            txStatus: (
              <TxStatus
                onNewTransaction={resetForNewTransaction}
                onRetry={handleBackToSwap}
                targetAmount={targetAmount}
                targetCurrency={targetCurrency}
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

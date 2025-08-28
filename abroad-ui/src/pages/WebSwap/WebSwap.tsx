import React, { useState } from 'react'
import { lazy, Suspense } from 'react'

import { useWebSwapController } from '../../features/swap/useWebSwapController'
const QrScannerFullScreen = lazy(() => import('../../features/swap/components/QrScannerFullScreen'))
import { Loader } from 'lucide-react'

import { _36EnumsTargetCurrency as TargetCurrency } from '../../api/index'
import { useWalletAuth } from '../../contexts/WalletAuthContext'
import BankDetailsRoute from '../../features/swap/components/BankDetailsRoute'
import NavBarResponsive from '../../features/swap/components/NavBarResponsive'
import WaitSign from '../../features/swap/components/WaitSign'
import WalletDetails from '../../features/swap/components/WalletDetails'
import { useBankDetailsRoute } from '../../features/swap/hooks/useBankDetailsRoute'
import { useWebSwapLayout } from '../../features/swap/hooks/useWebSwapLayout'
import { SwapView } from '../../features/swap/webSwap.types'
import WebSwapLayout from '../../features/swap/WebSwapLayout'
import { useWalletDetails } from '../../hooks'
import { useLanguageSelector, useNavBarResponsive } from '../../hooks'
import BackgroundCrossfade from '../../shared/components/BackgroundCrossfade'
import LanguageSelector from '../../shared/components/LanguageSelector'
import { ModalOverlay } from '../../shared/components/ModalOverlay'

export interface WebSwapControllerProps {
  closeQr: () => void
  currentBgUrl: string
  handleQrResult: (text: string) => Promise<void>
  handleWalletDetailsClose: () => void
  handleWalletDetailsOpen: () => void
  isDecodingQr: boolean
  isDesktop: boolean
  isQrOpen: boolean
  isWalletDetailsOpen: boolean
  setIsQrOpen: (isOpen: boolean) => void
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
    handleQrResult,
    handleWalletDetailsClose,
    handleWalletDetailsOpen,
    isDecodingQr,
    isDesktop,
    isQrOpen,
    isWalletDetailsOpen,
    setIsQrOpen,
  } = useWebSwapController({
    setPixKey,
    setQuoteId,
    setSourceAmount,
    setTargetAmount,
    setTargetCurrency,
    setTaxId,
    targetCurrency,
  })

  // Components controllers
  const navBar = useNavBarResponsive({
    onWalletDetails: handleWalletDetailsOpen,
  })
  const languageSelector = useLanguageSelector()
  const walletDetails = useWalletDetails({ onClose: handleWalletDetailsClose })
  const webSwapLayout = useWebSwapLayout({
    quoteId,
    setIsQrOpen,
    setQuoteId,
    setSourceAmount,
    setTargetAmount,
    setTargetCurrency,
    setTransactionId,
    setView,
    sourceAmount,
    targetAmount,
    targetCurrency,
    transactionId,
    view,
  })
  const bankDetailRoute = useBankDetailsRoute({
    isDesktop,
    onBackClick: webSwapLayout.handleBackToSwap,
    onRedirectToHome: webSwapLayout.resetForNewTransaction,
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
    userId: address,
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
          {...webSwapLayout}
          slots={{
            bankDetails: (
              <BankDetailsRoute {...bankDetailRoute} />
            ),
            waitSign: <WaitSign />,
          }}
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

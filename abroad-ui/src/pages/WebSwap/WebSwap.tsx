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

export interface WebSwapControllerProps {
  closeQr: () => void
  currentBgUrl: string
  handleBackToSwap: () => void
  handleQrResult: (text: string) => Promise<void>
  handleTransactionFlow: () => Promise<void>
  handleWalletDetailsClose: () => void
  handleWalletDetailsOpen: () => void
  isDecodingQr: boolean
  isDesktop: boolean
  isQrOpen: boolean
  isWalletDetailsOpen: boolean
  loadingSubmit: boolean
  resetForNewTransaction: () => void
  setIsQrOpen: (isOpen: boolean) => void
}

const WebSwap: React.FC = () => {
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
  const [accountNumber, setAccountNumber] = useState('')
  const [bankCode, setBankCode] = useState<string>('')
  const [qrCode, setQrCode] = useState<null | string>(null)

  // Main controller
  const {
    closeQr,
    currentBgUrl,
    handleBackToSwap,
    handleQrResult,
    handleTransactionFlow,
    handleWalletDetailsClose,
    handleWalletDetailsOpen,
    isDecodingQr,
    isDesktop,
    isQrOpen,
    isWalletDetailsOpen,
    loadingSubmit,
    resetForNewTransaction,
    setIsQrOpen,
  } = useWebSwapController({
    accountNumber,
    bankCode,
    pixKey,
    qrCode,
    quoteId,
    setPixKey,
    setQrCode,
    setQuoteId,
    setRecipentName,
    setSourceAmount,
    setTargetAmount,
    setTargetCurrency,
    setTaxId,
    setTransactionId,
    setView,
    sourceAmount,
    targetCurrency,
    taxId,
  })

  // Components controllers
  const navBar = useNavBarResponsive({ onWalletDetails: handleWalletDetailsOpen })
  const languageSelector = useLanguageSelector()
  const walletDetails = useWalletDetails({ onClose: handleWalletDetailsClose })
  const bankDetailRoute = useBankDetailsRoute({
    accountNumber,
    isDesktop,
    onBackClick: handleBackToSwap,
    pixKey,
    setAccountNumber,
    setBankCode,
    setPixKey,
    setTaxId,
    setView,
    targetAmount,
    targetCurrency,
    taxId,
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
    handleTransactionFlow()
  }, [
    handleTransactionFlow,
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
            bankDetails: <BankDetailsRoute {...bankDetailRoute} />,
            confirmQr: (
              <ConfirmQr
                currency={targetCurrency}
                loadingSubmit={loadingSubmit}
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
                targerCurrency={targetCurrency}
                targetAmount={targetAmount}
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

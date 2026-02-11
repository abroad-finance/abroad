import React, { lazy, Suspense, useCallback, useState } from 'react'
import { Loader } from 'lucide-react'

import { useWebSwapController } from './useWebSwapController'

import type { BankDetailsRouteProps } from '../../features/swap/components/BankDetailsRoute'
import type { ConfirmQrProps } from '../../features/swap/components/ConfirmQr'
import type { SwapProps } from '../../features/swap/components/Swap'

import { _36EnumsTargetCurrency as TargetCurrency } from '../../api/index'
import BankDetailsRoute from '../../features/swap/components/BankDetailsRoute'
import ConfirmQr from '../../features/swap/components/ConfirmQr'
import NavBarResponsive from '../../features/swap/components/NavBarResponsive'
import Swap from '../../features/swap/components/Swap'
import TokenSelectModal from '../../features/swap/components/TokenSelectModal'
import type { ChainOption, TokenOption } from '../../features/swap/components/TokenSelectModal'
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
import { ASSET_URLS } from '../../shared/constants'
import { useLanguageSelector, useNavBarResponsive } from '../../shared/hooks'

const QrScannerFullScreen = lazy(() => import('../../features/swap/components/QrScannerFullScreen'))

export interface WebSwapControllerProps {
  assetOptions: Array<{ key: string, label: string }>
  bankDetailsProps: BankDetailsRouteProps
  chainOptions: Array<{ key: string, label: string }>
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
  selectAssetOption: (key: string) => void
  selectChain: (key: string) => void
  selectCurrency: (currency: TargetCurrency) => void
  selectedChainKey: string
  swapViewProps: SwapProps
  targetAmount: string
  targetCurrency: TargetCurrency
  transactionId: null | string
  view: SwapView
}

/* ── Token/chain icon helpers ── */

const CRYPTO_ICONS: Record<string, string> = {
  USDC: ASSET_URLS.USDC_TOKEN_ICON,
  USDT: ASSET_URLS.USDT_TOKEN_ICON,
}

const CHAIN_ICON_MAP: Record<string, string> = {
  Celo: ASSET_URLS.CELO_CHAIN_ICON,
  Solana: ASSET_URLS.SOLANA_CHAIN_ICON,
  Stellar: ASSET_URLS.STELLAR_CHAIN_ICON,
}

const WebSwap: React.FC = () => {
  const controller = useWebSwapController()
  const {
    assetOptions,
    bankDetailsProps,
    chainOptions,
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
    selectAssetOption,
    selectChain,
    selectCurrency,
    selectedChainKey,
    swapViewProps,
    targetAmount,
    targetCurrency,
    transactionId,
    view,
  } = controller

  // Components controllers
  const navBar = useNavBarResponsive({ onWalletConnect, onWalletDetails: handleWalletDetailsOpen })
  const languageSelector = useLanguageSelector()
  const walletDetails = useWalletDetails({ onClose: handleWalletDetailsClose })

  // Modal state for source (chain + token) and target (currency)
  const [sourceModalOpen, setSourceModalOpen] = useState(false)
  const [targetModalOpen, setTargetModalOpen] = useState(false)

  const openSourceModal = useCallback(() => setSourceModalOpen(true), [])
  const closeSourceModal = useCallback(() => setSourceModalOpen(false), [])
  const openTargetModal = useCallback(() => setTargetModalOpen(true), [])
  const closeTargetModal = useCallback(() => setTargetModalOpen(false), [])

  // Build chain options for modal
  const sourceChains: ChainOption[] = chainOptions.map(c => ({
    icon: Object.entries(CHAIN_ICON_MAP).find(([prefix]) => c.label.startsWith(prefix))?.[1],
    key: c.key,
    label: c.label,
  }))

  // Build token options for modal
  const sourceTokens: TokenOption[] = assetOptions.map(a => ({
    icon: CRYPTO_ICONS[a.label],
    key: a.key,
    label: a.label,
    subtitle: a.label,
  }))

  // Build target currency options
  const targetCurrencyTokens: TokenOption[] = [
    {
      icon: 'https://hatscripts.github.io/circle-flags/flags/br.svg',
      key: 'BRL',
      label: 'BRL',
      subtitle: 'Brazilian Real',
    },
    {
      icon: 'https://hatscripts.github.io/circle-flags/flags/co.svg',
      key: 'COP',
      label: 'COP',
      subtitle: 'Colombian Peso',
    },
  ]

  const handleSourceTokenSelect = useCallback((key: string) => {
    selectAssetOption(key)
    setSourceModalOpen(false)
  }, [selectAssetOption])

  const handleSourceChainSelect = useCallback((key: string) => {
    selectChain(key)
  }, [selectChain])

  const handleTargetCurrencySelect = useCallback((key: string) => {
    selectCurrency(key as TargetCurrency)
    setTargetModalOpen(false)
  }, [selectCurrency])

  return (
    <div
      className="w-full min-h-[100dvh] md:h-screen md:overflow-hidden flex flex-col overflow-x-hidden"
      style={{ background: 'var(--ab-bg)' }}
    >
      {/* Desktop page background with crossfade */}
      <BackgroundCrossfade
        backgroundAttachment="fixed"
        imageUrl={currentBgUrl}
        positionClass="absolute inset-0"
        visibilityClass="hidden md:block"
        zIndexClass="z-0"
      />

      {/* Shared Navigation */}
      <div className="relative z-10">
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
            swap: (
              <Swap
                {...swapViewProps}
                hasInsufficientFunds={
                  swapViewProps.isAuthenticated
                  && !!walletDetails.usdcBalance
                  && !!swapViewProps.sourceAmount
                  && parseFloat(swapViewProps.sourceAmount) > parseFloat(walletDetails.usdcBalance.replace(/,/g, ''))
                }
                loadingBalance={walletDetails.isLoadingBalance}
                onOpenSourceModal={openSourceModal}
                onOpenTargetModal={openTargetModal}
                usdcBalance={walletDetails.usdcBalance}
              />
            ),
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

      {/* Source Modal (chain + token selection) */}
      <TokenSelectModal
        chains={sourceChains}
        onClose={closeSourceModal}
        onSelectChain={handleSourceChainSelect}
        onSelectToken={handleSourceTokenSelect}
        open={sourceModalOpen}
        selectedChainKey={selectedChainKey}
        selectedTokenKey={assetOptions.find(a => a.label === swapViewProps.selectedAssetLabel)?.key}
        title="Swap from"
        tokens={sourceTokens}
      />

      {/* Target Modal (currency selection) */}
      <TokenSelectModal
        chains={[]}
        onClose={closeTargetModal}
        onSelectToken={handleTargetCurrencySelect}
        open={targetModalOpen}
        selectedTokenKey={String(targetCurrency)}
        title="Swap to"
        tokens={targetCurrencyTokens}
      />

      {/* Wallet Details Modal */}
      <ModalOverlay
        onClose={handleWalletDetailsClose}
        open={!!isWalletDetailsOpen}
      >
        <WalletDetails {...walletDetails} />
      </ModalOverlay>

      {/* Full-screen QR Scanner */}
      {isQrOpen && (
        <Suspense fallback={null}>
          <QrScannerFullScreen onClose={closeQr} onResult={handleQrResult} />
        </Suspense>
      )}

      {/* Decoding overlay */}
      {isDecodingQr && (
        <div className="fixed inset-0 z-[1100] bg-black/60 backdrop-blur-sm flex items-center justify-center">
          <div className="flex flex-col items-center gap-3 text-white">
            <Loader className="w-8 h-8 animate-spin" />
            <p className="text-sm">Decodificando QR...</p>
          </div>
        </div>
      )}
    </div>
  )
}

export default WebSwap

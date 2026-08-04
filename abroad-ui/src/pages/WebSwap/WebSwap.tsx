import { useTranslate } from '@tolgee/react'
import { Loader } from 'lucide-react'
import React, {
  lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState,
} from 'react'
import { useNavigate } from 'react-router-dom'

import type { WalletSourceOption } from '../../components/ui'
import type { ConfirmQrProps } from '../../features/swap/components/ConfirmQr'
import type { SwapProps } from '../../features/swap/components/Swap'
import type { ChainOption, TokenOption } from '../../features/swap/components/TokenSelectModal'
import type { PaymentAuthorizationState } from '../../features/swap/model/paymentIntent'
import type { WalletConnectionIssue } from '../../features/swap/model/walletConnection'
import type {
  KycFormValues, KycSubmitOutcome, OnboardingRates, QrEntryMode, SwapView,
} from '../../features/swap/types'

import { _36EnumsTargetCurrency as TargetCurrency } from '../../api/index'
import { ChainSelectorModal, ConnectWalletChainModal, ModalSurface } from '../../components/ui'
import { useConsumerActivityList } from '../../features/activity/hooks/useConsumerActivity'
import ConfirmQr from '../../features/swap/components/ConfirmQr'
import HomeScreen from '../../features/swap/components/HomeScreen'
import KycForm from '../../features/swap/components/KycForm'
import MiniPayDisclosure from '../../features/swap/components/MiniPayDisclosure'
import NavBarResponsive from '../../features/swap/components/NavBarResponsive'
import Swap from '../../features/swap/components/Swap'
import TokenSelectModal from '../../features/swap/components/TokenSelectModal'
import TxStatus from '../../features/swap/components/TxStatus'
import WaitSign from '../../features/swap/components/WaitSign'
import WebSwapLayout from '../../features/swap/components/WebSwapLayout'
import {
  hasCompletedOnboarding,
  rememberOnboardingCompletion,
} from '../../features/swap/model/onboardingPreference'
import {
  type ConsumerUxAction,
  type ConsumerUxDimensions,
  type ConsumerUxEventName,
  getAppTelemetrySessionKey,
  getCheckoutTelemetrySessionKey,
  recordConsumerUxEvent,
} from '../../observability/consumerUxTelemetry'
import LanguageSelector from '../../shared/components/LanguageSelector'
import { AB_STYLES, ABROAD_SUPPORT_URL, CHAIN_ICON_MAP } from '../../shared/constants'
import { useLanguageSelector, useNavBarResponsive, useVersionCheck } from '../../shared/hooks'
import { cn } from '../../shared/utils'
import { useWebSwapController } from './useWebSwapController'

const QrScannerFullScreen = lazy(() => import('../../features/swap/components/QrScannerFullScreen'))

export interface WebSwapControllerProps {
  assetOptions: Array<{ key: string, label: string }>
  authorizationState: null | PaymentAuthorizationState
  balancesByAsset: Readonly<{ USDC: null | string, USDT: null | string }>
  cancelDestinationChange: () => void
  chainOptions: Array<{ key: string, label: string }>
  clearWalletConnectionIssue: () => void
  closeQr: () => void
  confirmDestinationChange: () => void
  confirmQrProps: ConfirmQrProps
  currentBgUrl: string
  goToManual: () => void
  handleBackToSwap: () => void
  handleKycClose: () => void
  handleKycSubmit: (values: KycFormValues) => Promise<KycSubmitOutcome>
  handleQrResult: (text: string) => Promise<void>
  isDecodingQr: boolean
  isLoadingBalance: boolean
  isMiniPay: boolean
  isQrOpen: boolean
  kycCanResumePayment: boolean
  onboardingRates: OnboardingRates
  onDisconnectWallet: () => Promise<void>
  openQr: (entryMode: QrEntryMode) => void
  pendingDestinationCurrency: null | TargetCurrency
  qrEntryMode: QrEntryMode
  requestConnectAfterSourceSelect: () => void
  resetForNewTransaction: () => void
  resumeAcceptedAuthorization: () => Promise<void>
  retryWalletConnection: () => void
  selectAssetOption: (key: string) => void
  selectChain: (key: string) => void
  selectCurrency: (currency: TargetCurrency) => void
  selectedChainKey: string
  sourceAmountForBalanceCheck: string | undefined
  sourceAssetBalance: null | string
  swapViewProps: SwapProps
  targetCurrency: TargetCurrency
  transactionId: null | string
  view: SwapView
  walletAddress: null | string
  walletConnectionInProgress: boolean
  walletConnectionIssue: null | WalletConnectionIssue
  walletSourceOptions: WalletSourceOption[]
}

const WebSwap: React.FC = () => {
  const controller = useWebSwapController()
  const navigate = useNavigate()
  useVersionCheck({
    currentView: controller.view,
    suppressWhileViews: ['txStatus', 'wait-sign'],
  })
  const {
    assetOptions,
    authorizationState,
    balancesByAsset,
    cancelDestinationChange,
    chainOptions,
    clearWalletConnectionIssue,
    closeQr,
    confirmDestinationChange,
    confirmQrProps,
    goToManual,
    handleBackToSwap,
    handleKycClose,
    handleKycSubmit,
    handleQrResult,
    isDecodingQr,
    isLoadingBalance,
    isMiniPay,
    isQrOpen,
    kycCanResumePayment,
    onboardingRates,
    onDisconnectWallet,
    openQr,
    pendingDestinationCurrency,
    qrEntryMode,
    requestConnectAfterSourceSelect,
    resetForNewTransaction,
    resumeAcceptedAuthorization,
    retryWalletConnection,
    selectAssetOption,
    selectChain,
    selectCurrency,
    selectedChainKey,
    sourceAmountForBalanceCheck,
    sourceAssetBalance,
    swapViewProps,
    targetCurrency,
    transactionId,
    view,
    walletAddress,
    walletConnectionInProgress,
    walletConnectionIssue,
    walletSourceOptions,
  } = controller

  const appTelemetrySessionKeyRef = useRef(getAppTelemetrySessionKey())
  const recordCheckoutEvent = useCallback((
    name: ConsumerUxEventName,
    dimensions?: ConsumerUxDimensions,
    onceSuffix?: string,
  ): void => {
    const sessionKey = getCheckoutTelemetrySessionKey()
    if (!sessionKey) return
    recordConsumerUxEvent({
      dimensions,
      name,
      session: { key: sessionKey, kind: 'checkout' },
    }, onceSuffix ? { onceKey: `${sessionKey}:${onceSuffix}` } : undefined)
  }, [])
  const recordAppEvent = useCallback((
    name: 'conditional_service_action' | 'conditional_service_state_viewed',
    dimensions: ConsumerUxDimensions,
    onceSuffix?: string,
  ): void => {
    const sessionKey = appTelemetrySessionKeyRef.current
    if (!sessionKey) return
    recordConsumerUxEvent({
      dimensions,
      name,
      session: { key: sessionKey, kind: 'app' },
    }, onceSuffix ? { onceKey: `${sessionKey}:${onceSuffix}` } : undefined)
  }, [])

  const openQrJourney = useCallback(() => openQr('camera'), [openQr])

  // Modal state for connect-wallet chain (must be before navBar, which uses handleConnectWalletClick)
  const [showConnectChainModal, setShowConnectChainModal] = useState(false)
  const handleConnectWalletClick = useCallback(() => {
    recordCheckoutEvent('wallet_cta_clicked', {
      source_surface: 'journey',
      trigger_location: 'flow',
    })
    recordCheckoutEvent('wallet_selector_opened', {
      source_surface: 'journey',
      trigger_location: 'flow',
    })
    setShowConnectChainModal(true)
  }, [recordCheckoutEvent])

  const recentActivity = useConsumerActivityList({ page: 1, pageSize: 2 })

  const openActivity = useCallback(() => navigate('/activity'), [navigate])
  const navBar = useNavBarResponsive()
  const languageSelector = useLanguageSelector()
  const { t } = useTranslate()

  useEffect(() => {
    if (swapViewProps.isAuthenticated || (view !== 'home' && view !== 'swap')) return
    recordCheckoutEvent('wallet_cta_impression', {
      source_surface: 'journey',
      trigger_location: 'flow',
    }, `wallet-cta-impression:${view}`)
  }, [
    recordCheckoutEvent,
    swapViewProps.isAuthenticated,
    view,
  ])

  useEffect(() => {
    if (view !== 'home') return
    const rail = targetCurrency === TargetCurrency.BRL ? 'PIX' : 'BREB'
    recordCheckoutEvent('recipient_method_impression', {
      method: 'camera',
      rail,
      step: 'payment_details',
    }, `recipient-method-impression:${rail}:qr`)
    recordCheckoutEvent('recipient_method_impression', {
      method: 'payment_key',
      rail,
      step: 'payment_details',
    }, `recipient-method-impression:${rail}:payment-key`)
  }, [
    recordCheckoutEvent,
    targetCurrency,
    view,
  ])

  useEffect(() => {
    if (!isMiniPay) return
    recordAppEvent('conditional_service_state_viewed', {
      state: 'minipay_disclosure',
    }, 'minipay-disclosure')
  }, [isMiniPay, recordAppEvent])

  const recordHeaderAction = useCallback((action: ConsumerUxAction): void => {
    recordCheckoutEvent('header_action_clicked', {
      action,
      immediate_reversal: false,
      source_surface: 'header',
    })
  }, [recordCheckoutEvent])

  const walletConnectionMessage = useMemo(() => {
    switch (walletConnectionIssue?.code) {
      case 'disconnected':
        return t('wallet.connection.disconnected', 'The wallet disconnected before Abroad could verify the session. Your payment details are still here.')
      case 'network':
        return t('wallet.connection.network', 'The wallet service could not be reached. Check your connection and try again.')
      case 'rejected':
        return t('wallet.connection.rejected', 'Wallet connection was cancelled. Nothing was signed or sent.')
      case 'timeout':
        return t('wallet.connection.timeout', 'The wallet did not respond in time. Check the wallet app, then try again if it is still disconnected.')
      case undefined:
        return null
      case 'unknown':
        return t('wallet.connection.unknown', 'Abroad could not verify the wallet connection. Your payment details are still here.')
      case 'unsupported-network':
        return t('wallet.connection.unsupported_network', 'This wallet does not support the selected network. Choose another network.')
      case 'unsupported-wallet':
        return t('wallet.connection.unsupported_wallet', 'No compatible wallet is available for the selected network.')
    }
  }, [t, walletConnectionIssue?.code])

  const handleBalanceClick = useCallback(() => {
    if (sourceAssetBalance) {
      const raw = sourceAssetBalance.replace(/,/g, '')
      swapViewProps.onSourceChange?.(raw)
    }
  }, [sourceAssetBalance, swapViewProps])

  // Modal state for source (chain + token) and target (currency)
  const [sourceModalOpen, setSourceModalOpen] = useState(false)
  const [targetModalOpen, setTargetModalOpen] = useState(false)

  // Track if user has entered the app from onboarding
  const [hasEnteredApp, setHasEnteredApp] = useState(hasCompletedOnboarding)
  const handleEnterApp = useCallback(() => {
    setHasEnteredApp(true)
    rememberOnboardingCompletion()
  }, [])

  const openSourceModal = useCallback(() => setSourceModalOpen(true), [])
  const closeSourceModal = useCallback(() => setSourceModalOpen(false), [])
  const openTargetModal = useCallback(() => setTargetModalOpen(true), [])
  const closeTargetModal = useCallback(() => setTargetModalOpen(false), [])

  // Build chain options for modal
  const supportedNetworks: ChainOption[] = chainOptions.map(c => ({
    icon: CHAIN_ICON_MAP[c.key.toLowerCase().split(':')[0] ?? ''],
    key: c.key,
    label: c.label,
  }))
  const sourceChains = isMiniPay ? [] : supportedNetworks

  // Build target currency options
  const targetCurrencyTokens: TokenOption[] = useMemo(() => [{
    icon: 'https://hatscripts.github.io/circle-flags/flags/br.svg',
    key: 'BRL',
    label: 'BRL',
    subtitle: t('swap.currency_brl', 'Brazilian Real'),
  }, {
    icon: 'https://hatscripts.github.io/circle-flags/flags/co.svg',
    key: 'COP',
    label: 'COP',
    subtitle: t('swap.currency_cop', 'Colombian Peso'),
  }], [t])

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
    <div className="flex h-dvh w-full flex-col overflow-hidden bg-[linear-gradient(135deg,var(--ab-bg),var(--ab-bg-end))]">
      {/* Shared Navigation */}
      <div className="relative z-10">
        <NavBarResponsive
          {...navBar}
          languageSelector={<LanguageSelector {...languageSelector} />}
          onDisconnect={onDisconnectWallet}
          onHeaderAction={recordHeaderAction}
          onHistoryClick={openActivity}
        />
      </div>

      {(walletConnectionInProgress || walletConnectionMessage) && (
        <aside
          aria-live="polite"
          className="relative z-20 mx-3 mt-2 flex flex-col gap-3 rounded-2xl border border-ab-border bg-[var(--ab-bg-card)] p-4 shadow-lg sm:mx-auto sm:w-[calc(100%-2rem)] sm:max-w-2xl sm:flex-row sm:items-center sm:justify-between"
          role={walletConnectionMessage ? 'alert' : 'status'}
        >
          <p className="text-sm font-semibold text-ab-text">
            {walletConnectionInProgress
              ? t('wallet.connection.waiting', 'Waiting for wallet approval…')
              : walletConnectionMessage}
          </p>
          {!walletConnectionInProgress && walletConnectionIssue && (
            <div className="flex flex-wrap gap-2">
              {walletConnectionIssue.retryable && (
                <button className="min-h-11 rounded-xl bg-ab-btn px-4 text-sm font-semibold text-ab-btn-text" onClick={retryWalletConnection} type="button">
                  {t('common.try_again', 'Try again')}
                </button>
              )}
              <button className="min-h-11 rounded-xl border border-ab-border px-4 text-sm font-semibold text-ab-text" onClick={handleConnectWalletClick} type="button">
                {t('wallet.connection.choose_network', 'Choose network')}
              </button>
              <button className="min-h-11 rounded-xl px-4 text-sm font-semibold text-ab-text-3" onClick={clearWalletConnectionIssue} type="button">
                {t('common.dismiss', 'Dismiss')}
              </button>
            </div>
          )}
        </aside>
      )}

      {/* Main Content Area */}
      <main className="flex-1 min-h-0 relative z-10 flex">
        <WebSwapLayout
          disclosure={isMiniPay ? <MiniPayDisclosure isDark={navBar.isDark} /> : null}
          showJourneyProgress={hasEnteredApp || swapViewProps.isAuthenticated}
          slots={{
            confirmQr: <ConfirmQr {...confirmQrProps} />,
            home: (
              <HomeScreen
                balance={sourceAssetBalance}
                hasEnteredApp={hasEnteredApp}
                isAuthenticated={swapViewProps.isAuthenticated}
                onboardingRates={onboardingRates}
                onEnterApp={handleEnterApp}
                onGoToManual={goToManual}
                onHistoryClick={openActivity}
                onOpenChainModal={openSourceModal}
                onRequestConnect={handleConnectWalletClick}
                onSelectCurrency={selectCurrency}
                onSelectTransaction={tx => navigate(`/activity/${tx.id}`)}
                onUseQr={openQrJourney}
                recentTransactions={recentActivity.items}
                selectedChainKey={selectedChainKey}
                selectedTokenLabel={swapViewProps.selectedAssetLabel}
                supportedNetworks={supportedNetworks}
                targetCurrency={targetCurrency}
              />
            ),
            kycNeeded: (
              <KycForm
                canResumePayment={kycCanResumePayment}
                onClose={handleKycClose}
                onSubmit={handleKycSubmit}
              />
            ),
            swap: (
              <Swap
                {...swapViewProps}
                hasInsufficientFunds={
                  swapViewProps.isAuthenticated
                  && !!sourceAssetBalance
                  && !!(sourceAmountForBalanceCheck ?? swapViewProps.sourceAmount)
                  && Number.parseFloat(sourceAmountForBalanceCheck ?? swapViewProps.sourceAmount) > Number.parseFloat(sourceAssetBalance.replace(/,/g, ''))
                }
                loadingBalance={isLoadingBalance}
                onBackClick={handleBackToSwap}
                onBalanceClick={handleBalanceClick}
                onOpenSourceModal={openSourceModal}
                onOpenTargetModal={openTargetModal}
                usdcBalance={sourceAssetBalance ?? undefined}
                walletAddress={isMiniPay ? null : walletAddress}
              />
            ),
            txStatus: (
              <TxStatus
                authorizationState={authorizationState}
                onNewTransaction={resetForNewTransaction}
                onResumeAuthorization={resumeAcceptedAuthorization}
                transactionId={transactionId}
              />
            ),
            waitSign: (
              <WaitSign
                isDark={navBar.isDark}
                networkLabel={swapViewProps.networkLabel}
                recipient={swapViewProps.recipientValue ?? ''}
                recipientName={swapViewProps.recipientName}
                sourceAmount={swapViewProps.sourceAmount}
                sourceAsset={swapViewProps.selectedAssetLabel}
                transactionId={transactionId}
                walletCategory={isMiniPay
                  ? 'minipay'
                  : selectedChainKey.toLowerCase().startsWith('stellar')
                    ? 'stellar'
                    : 'walletconnect'}
              />
            ),
          }}
          targetCurrency={targetCurrency}
          view={view}
        />
      </main>

      {/* Desktop footer (Allbridge-style) */}
      {!isMiniPay && (
        <footer className={cn('hidden md:flex items-center justify-center gap-6 h-[74px] px-6 border-t border-ab-separator flex-shrink-0 relative z-10', AB_STYLES.cardBgOnly)}>
          <a
            className={cn('text-sm font-medium hover:underline', AB_STYLES.textSecondary)}
            href="https://linktr.ee/Abroad.finance"
            rel="noopener noreferrer"
            target="_blank"
          >
            {t('footer.guides', 'Guides')}
          </a>
          <a
            className={cn('text-sm font-medium hover:underline', AB_STYLES.textSecondary)}
            href={ABROAD_SUPPORT_URL}
            rel="noopener noreferrer"
            target="_blank"
          >
            {t('footer.need_help', 'Need help?')}
          </a>
        </footer>
      )}

      {/* Source Modal: "Pay from" (chain + token selection) */}
      {!isMiniPay && (
        <ChainSelectorModal
          balances={balancesByAsset}
          chains={sourceChains}
          isAuthenticated={swapViewProps.isAuthenticated}
          onClose={closeSourceModal}
          onSelectChain={handleSourceChainSelect}
          onSelectToken={handleSourceTokenSelect}
          open={sourceModalOpen}
          selectedChainKey={selectedChainKey}
          selectedTokenKey={assetOptions.find(a => a.label === swapViewProps.selectedAssetLabel)?.key ?? ''}
          tokens={assetOptions}
        />
      )}

      {/* Connect wallet: choose the source asset, confirm a compatible network, then open its wallet. */}
      {!isMiniPay && (
        <ConnectWalletChainModal
          onClose={(outcome) => {
            recordCheckoutEvent('wallet_selector_closed', {
              outcome: outcome === 'selected' ? 'success' : 'dismissed',
              trigger_location: 'flow',
            })
            setShowConnectChainModal(false)
          }}
          onConnectRequest={requestConnectAfterSourceSelect}
          onSelectSource={selectAssetOption}
          open={showConnectChainModal}
          options={walletSourceOptions}
        />
      )}

      {/* Target Modal (currency selection) */}
      <TokenSelectModal
        chains={[]}
        onClose={closeTargetModal}
        onSelectToken={handleTargetCurrencySelect}
        open={targetModalOpen}
        selectedTokenKey={String(targetCurrency)}
        title={t('swap.modal_swap_to', 'Swap to')}
        tokens={targetCurrencyTokens}
      />

      <ModalSurface
        descriptionId="destination-change-description"
        onClose={cancelDestinationChange}
        open={pendingDestinationCurrency !== null}
        titleId="destination-change-title"
      >
        <div className="w-full max-w-md rounded-3xl border border-ab-border bg-[var(--ab-bg-card)] p-6 shadow-2xl">
          <h2 className="text-xl font-bold text-ab-text" id="destination-change-title">
            {t('swap.destination_change.title', 'Change payment destination?')}
          </h2>
          <p className="mt-3 text-sm leading-6 text-ab-text-3" id="destination-change-description">
            {t('swap.destination_change.description', 'Changing country switches the payment rail and clears the current recipient, amount, and quote. Your wallet stays connected.')}
          </p>
          <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <button className="min-h-11 rounded-xl border border-ab-border px-4 font-semibold text-ab-text" data-modal-initial-focus onClick={cancelDestinationChange} type="button">
              {t('common.cancel', 'Cancel')}
            </button>
            <button className="min-h-11 rounded-xl bg-ab-btn px-4 font-semibold text-ab-btn-text" onClick={confirmDestinationChange} type="button">
              {t('swap.destination_change.confirm', 'Change and clear details')}
            </button>
          </div>
        </div>
      </ModalSurface>

      {/* Full-screen QR Scanner */}
      {isQrOpen && (
        <Suspense fallback={null}>
          <QrScannerFullScreen
            currency={targetCurrency}
            initialMode={qrEntryMode}
            onClose={closeQr}
            onResult={handleQrResult}
            rail={targetCurrency === TargetCurrency.BRL ? 'PIX' : 'BREB'}
          />
        </Suspense>
      )}

      {/* Decoding overlay */}
      {isDecodingQr && (
        <div aria-busy="true" aria-live="polite" className="fixed inset-0 z-[1100] flex items-center justify-center bg-black/60 backdrop-blur-sm" role="status">
          <div className="flex flex-col items-center gap-3 text-white">
            <Loader className="h-8 w-8 animate-spin motion-reduce:animate-none" />
            <p className="text-sm">{t('swap.decoding_qr', 'Decoding QR...')}</p>
          </div>
        </div>
      )}
    </div>
  )
}

export default WebSwap

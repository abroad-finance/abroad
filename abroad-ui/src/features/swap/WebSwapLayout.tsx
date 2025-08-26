// WebSwapLayout.tsx
import React from 'react'

import AnimatedHeroText from '../../components/common/AnimatedHeroText'
import BackgroundCrossfade from '../../components/common/BackgroundCrossfade'
import ImageAttribution from '../../components/common/ImageAttribution'
import BankDetailsRoute from '../../components/Swap/BankDetailsRoute'
import Swap from '../../components/Swap/Swap'
import TxStatus from '../../components/Swap/TxStatus'
import UserVerification from '../../components/WebSwap/UserVerification'
import { useWalletAuth } from '../../contexts/WalletAuthContext'
import { kit } from '../../services/stellarKit'
import { useWebSwapController } from './useWebSwapController' // For prop types
import { ASSET_URLS, BRL_BACKGROUND_IMAGE } from './webSwap.constants'

type LayoutProps = ReturnType<typeof useWebSwapController>

const WebSwapLayout: React.FC<LayoutProps> = (props) => {
  const {
    address,
    handleAmountsChange,
    handleBackToSwap,
    handleSwapContinue,
    handleTransactionComplete,
    handleTransactionFailed,
    handleWalletConnectOpen,
    pixKey,
    quoteId,
    redirectToKYCAuth,
    resetForNewTransaction,
    setPixKey,
    setQuoteId,
    // new handlers/state for tx status view
    showTxStatus,
    sourceAmount,
    swapData,
    targetAmount,
    targetCurrency,
    transactionId,
    view,
  } = props

  const { authenticateWithWallet, kycUrl } = useWalletAuth()

  // Marketing background for mobile hero
  const currentBgUrl
    = props.targetCurrency === 'BRL'
      ? BRL_BACKGROUND_IMAGE
      : ASSET_URLS.BACKGROUND_IMAGE

  // Direct wallet connection (used on mobile and as desktop fallback)
  const handleDirectWalletConnect = React.useCallback(() => {
    kit.openModal({
      onWalletSelected: async (option) => {
        authenticateWithWallet(option.id)
      },
    })
  }, [authenticateWithWallet])

  // Prefer controller-provided handler on desktop; fallback to direct connect
  const onDesktopWalletConnect = handleWalletConnectOpen || handleDirectWalletConnect

  // Shared renderer for Swap + BankDetails
  const renderSwap = (isDesktop: boolean) => {
    const textColorProps = isDesktop ? ({ textColor: 'white' } as const) : undefined

    const handleKycRedirect = () => {
      if (kycUrl) {
        window.location.href = kycUrl
      }
      else {
        alert('No KYC url finded')
      }
    }

    return (
      <div className="w-full max-w-md">
        { view === 'kyc-needed' && (
          <UserVerification onVerify={handleKycRedirect} />
        )}

        {view === 'swap' && (
          <Swap
            onAmountsChange={handleAmountsChange}
            onContinue={(quote_id, srcAmount, tgtAmount, targetCurrency) => {
              console.log(
                `${isDesktop ? 'Desktop' : 'Mobile'} onContinue called with:`,
                { quote_id, srcAmount, targetCurrency, tgtAmount },
              )
              handleSwapContinue({ quote_id, srcAmount, targetCurrency, tgtAmount })
            }}
            onWalletConnect={isDesktop ? onDesktopWalletConnect : handleDirectWalletConnect}
            openQr={props.openQr}
            quoteId={quoteId}
            setQuoteId={setQuoteId}
            sourceAmount={sourceAmount}
            targetAmount={targetAmount}
            targetCurrency={targetCurrency}
            {...(textColorProps ?? {})}
          />
        )}

        {view === 'bankDetails' && swapData && address && (
          <>
            {console.log(
              `${isDesktop ? 'Desktop' : 'Mobile'} rendering BankDetailsRoute with swapData:`,
              swapData,
            )}
            <BankDetailsRoute
              onBackClick={handleBackToSwap}
              onKycRedirect={redirectToKYCAuth}
              onTransactionComplete={handleTransactionComplete}
              onTransactionFailed={handleTransactionFailed}
              onTransactionSigned={(id, ref) => showTxStatus(id, ref)}
              pixKey={pixKey}
              quote_id={swapData.quote_id}
              setPixKey={setPixKey}
              sourceAmount={swapData.srcAmount}
              targetAmount={swapData.tgtAmount}
              targetCurrency={swapData.targetCurrency}
              userId={address}
              {...(textColorProps ?? {})}
              setTaxId={props.setTaxId}
              taxId={props.taxId}
            />
          </>
        )}

        {view === 'txStatus' && (
          <TxStatus
            onNewTransaction={resetForNewTransaction}
            onRetry={handleBackToSwap}
            transactionId={transactionId}
          />
        )}
      </div>
    )
  }

  return (
    <div className="w-full min-h-screen">
      {/* ---------- Mobile (<= md) ---------- */}
      <div className="md:hidden flex flex-col w-full min-h-screen">
        {/* Swap Interface */}
        <div className="h-[calc(100vh-80px)] bg-green-50 flex items-center justify-center p-4">
          {renderSwap(false)}
        </div>

        {/* Marketing / Hero */}
        <div className="relative min-h-screen flex flex-col justify-between items-center p-5 text-center overflow-hidden">
          <BackgroundCrossfade
            backgroundAttachment="fixed"
            imageUrl={currentBgUrl}
            positionClass="absolute inset-0"
            visibilityClass="block"
            zIndexClass="-z-10"
          />
          <ImageAttribution currency={String(props.targetCurrency)} />
          <div className="text-3xl">
            <AnimatedHeroText currency={props.targetCurrency as 'BRL' | 'COP'} />
          </div>
          <div className="flex items-center gap-3 text-white font-sans text-sm">
            <span>powered by</span>
            <img alt="Stellar" className="h-6 w-auto" src={ASSET_URLS.STELLAR_LOGO} />
          </div>
        </div>
      </div>

      {/* ---------- Desktop (>= md) ---------- */}
      <div className="hidden md:flex flex-row w-full h-full">
        {/* Left Column - Marketing */}
        <div className="w-1/2 flex flex-col justify-center relative px-4 py-10 sm:px-6 lg:px-8">
          <div className="text-6xl max-w-xl">
            <AnimatedHeroText currency={props.targetCurrency as 'BRL' | 'COP'} />
          </div>
          <ImageAttribution
            className="absolute bottom-5 left-5"
            currency={String(props.targetCurrency)}
          />
        </div>

        {/* Right Column - Swap Interface */}
        <div className="w-1/2 flex flex-col justify-center items-center p-10 relative">
          {renderSwap(true)}
          <div className="absolute bottom-5 right-5 flex items-center gap-3 text-white font-sans text-base">
            <span>powered by</span>
            <img alt="Stellar" className="h-9 w-auto" src={ASSET_URLS.STELLAR_LOGO} />
          </div>
        </div>
      </div>
    </div>
  )
}

export default WebSwapLayout

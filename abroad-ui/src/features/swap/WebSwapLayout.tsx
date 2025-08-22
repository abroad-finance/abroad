// WebSwapLayout.tsx
import React from 'react';
import Swap from '../../components/Swap/Swap';
import BankDetailsRoute from '../../components/Swap/BankDetailsRoute';
import AnimatedHeroText from '../../components/common/AnimatedHeroText';
import ImageAttribution from '../../components/common/ImageAttribution';
import BackgroundCrossfade from '../../components/common/BackgroundCrossfade';
import { ASSET_URLS, BRL_BACKGROUND_IMAGE } from './webSwap.constants';
import { useWebSwapController } from './useWebSwapController'; // For prop types
import { kit } from '../../services/stellarKit';
import { useWalletAuth } from '../../context/WalletAuthContext';
import TxStatus from '../../components/Swap/TxStatus';

type LayoutProps = ReturnType<typeof useWebSwapController>;

const WebSwapLayout: React.FC<LayoutProps> = (props) => {
  const {
    view,
    swapData,
    address,
    handleSwapContinue,
    handleBackToSwap,
    handleTransactionComplete,
    handleTransactionFailed,
    handleAmountsChange,
    handleWalletConnectOpen,
    sourceAmount,
    targetAmount,
    targetCurrency,
    handleTargetChange,
    quoteId,
    setQuoteId,
    pixKey,
    setPixKey,
    // new handlers/state for tx status view
    showTxStatus,
    resetForNewTransaction,
    transactionId,
  } = props;

  const { authenticateWithWallet } = useWalletAuth();

  // Marketing background for mobile hero
  const currentBgUrl =
    props.targetCurrency === 'BRL'
      ? BRL_BACKGROUND_IMAGE
      : ASSET_URLS.BACKGROUND_IMAGE;

  // Direct wallet connection (used on mobile and as desktop fallback)
  const handleDirectWalletConnect = React.useCallback(() => {
    kit.openModal({
      onWalletSelected: async (option) => {
        authenticateWithWallet(option.id);
      },
    });
  }, [authenticateWithWallet]);

  // Prefer controller-provided handler on desktop; fallback to direct connect
  const onDesktopWalletConnect = handleWalletConnectOpen || handleDirectWalletConnect;

  // Shared renderer for Swap + BankDetails
  const renderSwap = (isDesktop: boolean) => {
    const textColorProps = isDesktop ? ({ textColor: 'white' } as const) : undefined;

    return (
      <div className="w-full max-w-md">
        {view === 'swap' && (
          <Swap
            onContinue={(quote_id, srcAmount, tgtAmount, targetCurrency) => {
              console.log(
                `${isDesktop ? 'Desktop' : 'Mobile'} onContinue called with:`,
                { quote_id, srcAmount, tgtAmount, targetCurrency }
              );
              handleSwapContinue({ quote_id, srcAmount, tgtAmount, targetCurrency });
            }}
            onAmountsChange={handleAmountsChange}
            onWalletConnect={isDesktop ? onDesktopWalletConnect : handleDirectWalletConnect}
            sourceAmount={sourceAmount}
            targetAmount={targetAmount}
            targetCurrency={targetCurrency}
            onTargetChange={handleTargetChange}
            quoteId={quoteId}
            setQuoteId={setQuoteId}
            openQr={props.openQr}
            {...(textColorProps ?? {})}
          />
        )}

        {view === 'bankDetails' && swapData && address && (
          <>
            {console.log(
              `${isDesktop ? 'Desktop' : 'Mobile'} rendering BankDetailsRoute with swapData:`,
              swapData
            )}
            <BankDetailsRoute
              onBackClick={handleBackToSwap}
              onTransactionComplete={handleTransactionComplete}
              onTransactionFailed={handleTransactionFailed}
              onTransactionSigned={(id, ref) => showTxStatus(id, ref)}
              quote_id={swapData.quote_id}
              sourceAmount={swapData.srcAmount}
              targetAmount={swapData.tgtAmount}
              userId={address}
              targetCurrency={swapData.targetCurrency}
              pixKey={pixKey}
              setPixKey={setPixKey}
              {...(textColorProps ?? {})}
              taxId={props.taxId}
              setTaxId={props.setTaxId}
            />
          </>
        )}

        {view === 'txStatus' && (
          <TxStatus
            transactionId={transactionId}
            onNewTransaction={resetForNewTransaction}
            onRetry={handleBackToSwap}
          />
        )}
      </div>
    );
  };

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
            imageUrl={currentBgUrl}
            visibilityClass="block"
            positionClass="absolute inset-0"
            zIndexClass="-z-10"
            backgroundAttachment="fixed"
          />
          <ImageAttribution currency={String(props.targetCurrency)} />
          <div className="text-3xl">
            <AnimatedHeroText currency={props.targetCurrency as 'COP' | 'BRL'} />
          </div>
          <div className="flex items-center gap-3 text-white font-sans text-sm">
            <span>powered by</span>
            <img src={ASSET_URLS.STELLAR_LOGO} alt="Stellar" className="h-6 w-auto" />
          </div>
        </div>
      </div>

      {/* ---------- Desktop (>= md) ---------- */}
      <div className="hidden md:flex flex-row w-full h-full">
        {/* Left Column - Marketing */}
        <div className="w-1/2 flex flex-col justify-center relative px-4 py-10 sm:px-6 lg:px-8">
          <div className="text-6xl max-w-xl">
            <AnimatedHeroText currency={props.targetCurrency as 'COP' | 'BRL'} />
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
            <img src={ASSET_URLS.STELLAR_LOGO} alt="Stellar" className="h-9 w-auto" />
          </div>
        </div>
      </div>
    </div>
  );
};

export default WebSwapLayout;

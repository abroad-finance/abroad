import React from 'react';
import Swap from '../../components/Swap/Swap';
import BankDetailsRoute from '../../components/Swap/BankDetailsRoute';
import AnimatedHeroText from '../../components/common/AnimatedHeroText';
import ImageAttribution from '../../components/common/ImageAttribution';
import { ASSET_URLS } from './webSwap.constants';
import { useWebSwapController } from './useWebSwapController'; // For prop types
import { kit } from '../../services/stellarKit';
import { useWalletAuth } from '../../context/WalletAuthContext';

type LayoutProps = ReturnType<typeof useWebSwapController>;

const MobileLayout: React.FC<LayoutProps> = (props) => {
  const { view, swapData, initialAmounts, address, handleSwapContinue, handleBackToSwap, handleTransactionComplete, handleAmountsChange } = props;
  const { authenticateWithWallet } = useWalletAuth();

  // Page-level background crossfade state (below-the-fold marketing section)
  const BRL_BG_URL = 'https://storage.googleapis.com/cdn-abroad/bg/6193481566_1a304e3aa3_o.jpg';
  const currentBgUrl = props.targetCurrency === 'BRL' ? BRL_BG_URL : ASSET_URLS.BACKGROUND_IMAGE;
  const [baseBgUrl, setBaseBgUrl] = React.useState<string>(currentBgUrl);
  const [overlayBgUrl, setOverlayBgUrl] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (currentBgUrl === baseBgUrl) return;
    let canceled = false;
    const img = new Image();
    img.src = currentBgUrl;
    const startOverlay = () => {
      if (!canceled) setOverlayBgUrl(currentBgUrl);
    };
    if (img.complete) {
      startOverlay();
    } else {
      img.onload = startOverlay;
      img.onerror = () => {
        if (!canceled) {
          setBaseBgUrl(currentBgUrl);
          setOverlayBgUrl(null);
        }
      };
    }
    return () => {
      canceled = true;
    };
  }, [currentBgUrl, baseBgUrl]);

  const handleOverlayEnd = () => {
    if (overlayBgUrl) {
      setBaseBgUrl(overlayBgUrl);
      setOverlayBgUrl(null);
    }
  };

  // Direct wallet connection handler
  const handleDirectWalletConnect = () => {
    kit.openModal({
      onWalletSelected: async (option) => {
        authenticateWithWallet(option.id);
      },
    });
  };

  return (
    <div className="md:hidden flex flex-col w-full min-h-screen">
      {/* Above the fold: Swap Interface */}
      <div className="h-[calc(100vh-80px)] bg-green-50 flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          {view === 'swap' && (
             <Swap
              onContinue={(quote_id, srcAmount, tgtAmount, targetCurrency) => {
                console.log('MobileLayout onContinue called with:', { quote_id, srcAmount, tgtAmount, targetCurrency });
                handleSwapContinue({ quote_id, srcAmount, tgtAmount, targetCurrency });
              }}
              initialSourceAmount={initialAmounts.source}
              initialTargetAmount={initialAmounts.target}
              onAmountsChange={handleAmountsChange}
              onWalletConnect={handleDirectWalletConnect}
            />
          )}
          {view === 'bankDetails' && swapData && address && (
            <>
              {console.log('MobileLayout rendering BankDetailsRoute with swapData:', swapData)}
              <BankDetailsRoute
                onBackClick={handleBackToSwap}
                onTransactionComplete={handleTransactionComplete}
                quote_id={swapData.quote_id}
                sourceAmount={swapData.srcAmount}
                targetAmount={swapData.tgtAmount}
                userId={address}
                targetCurrency={swapData.targetCurrency}
              />
            </>
          )}
        </div>
      </div>

      <div className="relative min-h-screen flex flex-col justify-between items-center p-5 text-center overflow-hidden">
        <div
          className="absolute inset-0 -z-10 bg-cover bg-center bg-no-repeat"
          style={{ backgroundImage: `url(${baseBgUrl})`, backgroundAttachment: 'fixed' }}
        />
        {overlayBgUrl && (
          <div
            className="absolute inset-0 -z-10 bg-cover bg-center bg-no-repeat"
            style={{ backgroundImage: `url(${overlayBgUrl})`, backgroundAttachment: 'fixed', opacity: 0, animation: 'fadeInBg 0.35s ease-out forwards' }}
            onAnimationEnd={handleOverlayEnd}
          />
        )}
        <style>{`@keyframes fadeInBg{from{opacity:0}to{opacity:1}}`}</style>
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
  );
};

export default MobileLayout;
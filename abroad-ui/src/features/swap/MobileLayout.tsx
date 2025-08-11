import React from 'react';
import Swap from '../../components/Swap/Swap';
import BankDetailsRoute from '../../components/Swap/BankDetailsRoute';
import AnimatedHeroText from '../../components/common/AnimatedHeroText';
import ImageAttribution from '../../components/common/ImageAttribution';
import { ASSET_URLS, BRL_BACKGROUND_IMAGE } from './webSwap.constants';
import { useWebSwapController } from './useWebSwapController'; // For prop types
import { kit } from '../../services/stellarKit';
import { useWalletAuth } from '../../context/WalletAuthContext';
import BackgroundCrossfade from '../../components/common/BackgroundCrossfade';

type LayoutProps = ReturnType<typeof useWebSwapController>;

const MobileLayout: React.FC<LayoutProps> = (props) => {
  const { view, swapData, initialAmounts, address, handleSwapContinue, handleBackToSwap, handleTransactionComplete, handleAmountsChange } = props;
  const { authenticateWithWallet } = useWalletAuth();

  // Determine desired marketing section background URL based on currency
  const currentBgUrl = props.targetCurrency === 'BRL' ? BRL_BACKGROUND_IMAGE : ASSET_URLS.BACKGROUND_IMAGE;

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
  );
};

export default MobileLayout;
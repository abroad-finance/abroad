import React from 'react';
import Swap from '../../components/Swap/swap';
import BankDetailsRoute from '../../components/Swap/bankDetailsRoute';
import AnimatedHeroText from '../../components/common/AnimatedHeroText';
import ImageAttribution from '../../components/common/ImageAttribution';
import { ASSET_URLS } from './webSwap.constants';
import { useWebSwapController } from './useWebSwapController'; // For prop types

type LayoutProps = ReturnType<typeof useWebSwapController>;

const DesktopLayout: React.FC<LayoutProps> = (props) => {
  const { view, swapData, address, initialAmounts, handleSwapContinue, handleBackToSwap, handleTransactionComplete, handleAmountsChange, handleWalletConnectOpen } = props;

  return (
    <div className="hidden md:flex flex-row w-full h-full">
      {/* Left Column - Marketing */}
      <div className="w-1/2 flex flex-col justify-center relative px-4 py-10 sm:px-6 lg:px-8">
        <div className="text-6xl max-w-xl">
          <AnimatedHeroText />
        </div>
        <ImageAttribution className="absolute bottom-5 left-5" />
      </div>
      
      {/* Right Column - Swap Interface */}
      <div className="w-1/2 flex flex-col justify-center items-center p-10 relative">
        <div className="w-full max-w-md">
          {view === 'swap' && (
            <Swap
              onContinue={(quote_id, srcAmount, tgtAmount) => handleSwapContinue({ quote_id, srcAmount, tgtAmount })}
              initialSourceAmount={initialAmounts.source}
              initialTargetAmount={initialAmounts.target}
              onAmountsChange={handleAmountsChange}
              onWalletConnect={handleWalletConnectOpen}
              textColor="white"
            />
          )}
          {view === 'bankDetails' && swapData && address && (
            <BankDetailsRoute
              onBackClick={handleBackToSwap}
              onTransactionComplete={handleTransactionComplete}
              quote_id={swapData.quote_id}
              sourceAmount={swapData.srcAmount}
              targetAmount={swapData.tgtAmount}
              userId={address}
              textColor="white"
            />
          )}
        </div>
        <div className="absolute bottom-5 right-5 flex items-center gap-3 text-white font-sans text-base">
          <span>powered by</span>
          <img src={ASSET_URLS.STELLAR_LOGO} alt="Stellar" className="h-9 w-auto" />
        </div>
      </div>
    </div>
  );
};

export default DesktopLayout;
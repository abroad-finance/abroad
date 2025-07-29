import React from 'react';
import Swap from '../../components/Swap/Swap';
import BankDetailsRoute from '../../components/Swap/BankDetailsRoute';
import AnimatedHeroText from '../../components/common/AnimatedHeroText';
import ImageAttribution from '../../components/common/ImageAttribution';
import { ASSET_URLS } from './webSwap.constants';
import { useWebSwapController } from './useWebSwapController'; // For prop types

type LayoutProps = ReturnType<typeof useWebSwapController>;

const MobileLayout: React.FC<LayoutProps> = (props) => {
  const { view, swapData, initialAmounts, address, handleSwapContinue, handleBackToSwap, handleTransactionComplete, handleAmountsChange } = props;

  return (
    <div className="md:hidden flex flex-col w-full min-h-screen">
      {/* Above the fold: Swap Interface */}
      <div className="h-[calc(100vh-80px)] bg-green-50 flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          {view === 'swap' && (
             <Swap
              onContinue={(quote_id, srcAmount, tgtAmount) => handleSwapContinue({ quote_id, srcAmount, tgtAmount })}
              initialSourceAmount={initialAmounts.source}
              initialTargetAmount={initialAmounts.target}
              onAmountsChange={handleAmountsChange}
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
            />
          )}
        </div>
      </div>

      {/* Below the fold: Marketing Content */}
      <div
        className="min-h-screen flex flex-col justify-between items-center p-5 text-center"
        style={{ backgroundImage: `url(${ASSET_URLS.BACKGROUND_IMAGE})`, backgroundSize: 'cover', backgroundAttachment: 'fixed' }}
      >
        <ImageAttribution />
        <div className="text-3xl">
            <AnimatedHeroText />
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
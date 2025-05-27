import { useState } from 'react';
import Swap from '../../components/Swap/Swap';
import BankDetailsRoute from '../../components/Swap/BankDetailsRoute';
import TxStatus from '../../components/Swap/TxStatus';

export default function Anchor() {
  const [currentView, setCurrentView] = useState<'swap' | 'bankDetails' | 'txStatus'>('swap');
  const [quote_id, setquote_id] = useState<string>('');
  const [sourceAmount, setSourceAmount] = useState<string>('');
  const [targetAmount, setTargetAmount] = useState<string>('');

  const handleSwapContinue = (qId: string, srcAmount: string, tgtAmount: string) => {
    setquote_id(qId);
    setSourceAmount(srcAmount);
    setTargetAmount(tgtAmount);
    setCurrentView('bankDetails');
  };

  const handleBankDetailsBack = () => {
    setCurrentView('swap');
    // Optionally clear the data if needed when going back
    // setQuoteId('');
    // setSourceAmount('');
    // setTargetAmount('');
  };

  // Sync child Swap amounts with parent
  const handleAmountsChange = (srcAmount: string, tgtAmount: string) => {
    setSourceAmount(srcAmount);
    setTargetAmount(tgtAmount);
  };

  const handleNewTransaction = () => {
    setquote_id('');
    setSourceAmount('');
    setTargetAmount('');
    setCurrentView('swap');
  };

  const handleRetry = () => {
    setCurrentView('bankDetails');
  };

  return (
    <div className="min-h-screen bg-green-50 flex flex-col items-center">
      {/* Institutional logo */}
      <img
        src="https://cdn.prod.website-files.com/66d73974e0b6f2e9c06130a7/67bdb92323f0bb399db3754c_abroad-logo.svg"
        alt="Abroad Logo"
        className="h-12 mt-18 mb-6"
      />
      {/* Centered white card covering 60% of screen */}
      <div className="flex-1 flex items-center justify-center w-full flex-col">
         {currentView === 'swap' && (
           <Swap
             onContinue={handleSwapContinue}
             initialSourceAmount={sourceAmount}
             initialTargetAmount={targetAmount}
             onAmountsChange={handleAmountsChange}
           />
         )}
         {currentView === 'bankDetails' && 
           <BankDetailsRoute 
             onBackClick={handleBankDetailsBack} 
             onTransactionComplete={() => setCurrentView('txStatus')}
             quote_id={quote_id}
             sourceAmount={sourceAmount}
             targetAmount={targetAmount}
           />
         }
         {currentView === 'txStatus' && <TxStatus onNewTransaction={handleNewTransaction} onRetry={handleRetry} />}
      </div>
      {/* Social footer */}
      {/* make footer part of the normal flow so on small screens you scroll to see it */}
      <footer className="w-full flex justify-end space-x-3 py-4 pr-4">
        <a
          href="https://x.com/payabroad"
          target="_blank"
          rel="noopener noreferrer"
        >
          <img
            src="https://storage.cloud.google.com/cdn-abroad/Icons/Socials/icon-x.svg"
            alt="X"
            className="w-5 h-5 text-[#356E6A]"
            style={{ filter: 'invert(33%) sepia(14%) saturate(1833%) hue-rotate(121deg) brightness(90%) contrast(85%)' }}
          />
        </a>
        <a
          href="https://discord.gg/YqWdSxAy5B"
          target="_blank"
          rel="noopener noreferrer"
        >
          <img
            src="https://storage.cloud.google.com/cdn-abroad/Icons/Socials/icon-discord.svg"
            alt="Discord"
            className="w-5 h-5 text-[#356E6A]"
            style={{ filter: 'invert(33%) sepia(14%) saturate(1833%) hue-rotate(121deg) brightness(90%) contrast(85%)' }}
          />
        </a>
      </footer>
    </div>
  );
}
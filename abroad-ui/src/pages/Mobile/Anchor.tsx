import { useState, useEffect, useCallback } from 'react';
import Swap from '../../components/Swap/Swap';
import BankDetailsRoute from '../../components/Swap/BankDetailsRoute';
import TxStatus from '../../components/Swap/TxStatus';
import { useLanguage } from '../../contexts/LanguageContext';
import jwt from 'jsonwebtoken';

export default function Anchor() {
  const { setLanguage } = useLanguage();

  const [currentView, setCurrentView] = useState<'swap' | 'bankDetails' | 'txStatus'>('swap');
  const [quote_id, setquote_id] = useState<string>('');
  const [sourceAmount, setSourceAmount] = useState<string>('');
  const [targetAmount, setTargetAmount] = useState<string>('');
  const [userId, setUserId] = useState<string>('');
  const [sepTransactionId, setSepTransactionId] = useState<string>('');

  // State for query parameters
  const [callbackUrl, setCallbackUrl] = useState<string | null>(null);

  useEffect(() => {
    const queryParams = new URLSearchParams(window.location.search);
    setSepTransactionId(queryParams.get('transaction_id') || '');
    setCallbackUrl(queryParams.get('callback'));
    console.log('Callback URL from query:', queryParams.get('callback'));
    const lang = queryParams.get('lang');
    if (lang) {
      setLanguage(lang as 'en' | 'es' | 'pt' | 'zh');
    }
    setSourceAmount(queryParams.get('source_amount') || '');
    const tokenFromQuery = queryParams.get('token');
    if (tokenFromQuery) {
      console.log('Token from query:', tokenFromQuery);
      localStorage.setItem('token', tokenFromQuery);
      try {
        const decodedToken = jwt.decode(tokenFromQuery) as { sub: string } | null;
        console.log('Decoded token:', decodedToken);
        if (decodedToken && decodedToken.sub) {
          setUserId(decodedToken.sub);
          console.log('User ID from token:', decodedToken.sub);
        }
      } catch (error) {
        console.error('Error decoding token:', error);
      }
    }
  }, [setLanguage]);

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

  const handleTransactionAccepted = useCallback(async ({ memo }: { memo: string }) => {
    // make a get request
    const sepBaseUrl = import.meta.env.VITE_SEP_BASE_URL || 'http://localhost:8000';
    let url = encodeURI(`${sepBaseUrl}/sep24/transactions/withdraw/interactive/complete?amount_expected=${sourceAmount}&transaction_id=${sepTransactionId}&memo=${memo}`);
    if (callbackUrl && callbackUrl.toLowerCase() !== 'none') {
      url += `&callback=${encodeURIComponent(callbackUrl)}`;
    }
    window.location.href = url;
  }, [callbackUrl, sepTransactionId, sourceAmount]);

  return (
    <div className="min-h-screen bg-green-50 flex flex-col items-center">
      {/* Institutional logo */}
      <img
        src="https://cdn.prod.website-files.com/66d73974e0b6f2e9c06130a7/67bdb92323f0bb399db3754c_abroad-logo.svg"
        alt="Abroad Logo"
        className="h-8 md:h-12 mt-12 md:mt-18 mb-6"
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
            onTransactionComplete={handleTransactionAccepted}
            quote_id={quote_id}
            userId={userId}
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
            src="https://storage.googleapis.com/cdn-abroad/Icons/Socials/icon-x.svg"
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
            src="https://storage.googleapis.com/cdn-abroad/Icons/Socials/icon-discord.svg"
            alt="Discord"
            className="w-5 h-5 text-[#356E6A]"
            style={{ filter: 'invert(33%) sepia(14%) saturate(1833%) hue-rotate(121deg) brightness(90%) contrast(85%)' }}
          />
        </a>
      </footer>
    </div>
  );
}
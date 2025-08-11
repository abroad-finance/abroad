import { useState, useCallback, useEffect } from 'react';
import { SwapData, SwapView } from './webSwap.types';
import { _36EnumsTargetCurrency as TargetCurrency } from '../../api';
import { useWalletAuth } from '../../context/WalletAuthContext';

const PENDING_TX_KEY = 'pendingTransaction';

export const useWebSwapController = () => {
  const { address, token } = useWalletAuth();
  const [view, setView] = useState<SwapView>('swap');
  const [swapData, setSwapData] = useState<SwapData | null>(null);


  // Modal visibility state
  const [isWalletModalOpen, setIsWalletModalOpen] = useState(false);
  const [isWalletDetailsOpen, setIsWalletDetailsOpen] = useState(false);

  // Persist amounts between views
  const [sourceAmount, setSourceAmount] = useState('');
  const [targetAmount, setTargetAmount] = useState('');
  const [targetCurrency, setTargetCurrency] = useState<(typeof TargetCurrency)[keyof typeof TargetCurrency]>(TargetCurrency.COP);

  // Restore state if user returns from KYC
  useEffect(() => {
    const stored = localStorage.getItem(PENDING_TX_KEY);
    if (stored && token) {
      try {
        const parsed = JSON.parse(stored);
        setSwapData({ quote_id: parsed.quote_id, srcAmount: parsed.srcAmount, tgtAmount: parsed.tgtAmount, targetCurrency: parsed.targetCurrency || TargetCurrency.COP });
        setSourceAmount(parsed.srcAmount);
        setTargetAmount(parsed.tgtAmount);
        setTargetCurrency(parsed.targetCurrency || TargetCurrency.COP);
        setView('bankDetails');
      } catch (e) {
        console.error('Failed to restore pending transaction', e);
      }
    }
  }, [token]);

  const handleWalletConnectOpen = useCallback(() => setIsWalletModalOpen(true), []);
  const handleWalletConnectClose = useCallback(() => setIsWalletModalOpen(false), []);

  const handleWalletDetailsOpen = useCallback(() => setIsWalletDetailsOpen(true), []);
  const handleWalletDetailsClose = useCallback(() => setIsWalletDetailsOpen(false), []);

  const handleWalletSelect = useCallback((walletType: 'trust' | 'stellar') => {
    console.log('Wallet selected:', walletType);
    // Add wallet connection logic here
    setIsWalletModalOpen(false);
  }, []);

  const handleSwapContinue = useCallback((data: SwapData) => {
    console.log('handleSwapContinue called with data:', data);
    setSwapData(data);
    setTargetCurrency(data.targetCurrency || TargetCurrency.COP);
    setView('bankDetails');
  }, []);

  const handleAmountsChange = useCallback((src: string, tgt: string, currency?: (typeof TargetCurrency)[keyof typeof TargetCurrency]) => {
    setSourceAmount(src);
    setTargetAmount(tgt);
    if (currency) setTargetCurrency(currency);
  }, []);

  const handleBackToSwap = useCallback(() => {
    localStorage.removeItem(PENDING_TX_KEY);
    setView('swap');
  }, []);

  const handleTransactionComplete = useCallback(async ({ memo }: { memo: string | null }) => {
    console.log('Transaction complete with memo:', memo);
    // Ideally, navigate to a dedicated success route
    // For now, reset to the initial swap view
    localStorage.removeItem(PENDING_TX_KEY);
    setView('swap');
    setSwapData(null);
  }, []);

  return {
    // State
    view,
    swapData,
    isWalletModalOpen,
    isWalletDetailsOpen,
    initialAmounts: { source: sourceAmount, target: targetAmount },
    address,
    targetCurrency,

    // Handlers
    handleWalletConnectOpen,
    handleWalletConnectClose,
    handleWalletDetailsOpen,
    handleWalletDetailsClose,
    handleWalletSelect,
    handleSwapContinue,
    handleAmountsChange,
    handleBackToSwap,
    handleTransactionComplete,
  };
};
import { useState, useCallback } from 'react';
import { useBlux } from '@bluxcc/react';
import { SwapData, SwapView, BluxUser } from './webSwap.types';

export const useWebSwapController = () => {
  const { user } = useBlux();

  const [view, setView] = useState<SwapView>('swap');
  const [swapData, setSwapData] = useState<SwapData | null>(null);

  // Modal visibility state
  const [isWalletModalOpen, setIsWalletModalOpen] = useState(false);
  const [isWalletDetailsOpen, setIsWalletDetailsOpen] = useState(false);
  
  // Persist amounts between views
  const [sourceAmount, setSourceAmount] = useState('');
  const [targetAmount, setTargetAmount] = useState('');

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
    setSwapData(data);
    setView('bankDetails');
  }, []);
  
  const handleAmountsChange = useCallback((src: string, tgt: string) => {
    setSourceAmount(src);
    setTargetAmount(tgt);
  }, []);

  const handleBackToSwap = useCallback(() => {
    setView('swap');
  }, []);

  const handleTransactionComplete = useCallback(async ({ memo }: { memo: string }) => {
    console.log('Transaction complete with memo:', memo);
    // Ideally, navigate to a dedicated success route
    // For now, reset to the initial swap view
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
    user: user as unknown as BluxUser | null,

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
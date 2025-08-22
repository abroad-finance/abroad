import { useState, useCallback, useEffect } from 'react';
import { SwapData, SwapView } from './webSwap.types';
import { useWalletAuth } from '../../context/WalletAuthContext';
import { useSearchParams } from 'react-router-dom';
import { ASSET_URLS, BRL_BACKGROUND_IMAGE } from './webSwap.constants';
import { getQuote, _36EnumsTargetCurrency as TargetCurrency, _36EnumsPaymentMethod as PaymentMethod, _36EnumsBlockchainNetwork as BlockchainNetwork, _36EnumsCryptoCurrency as CryptoCurrency, decodeQrCodeBR } from '../../api/index';

const PENDING_TX_KEY = 'pendingTransaction';

export const useWebSwapController = () => {
  const { address, token } = useWalletAuth();
  const [view, setView] = useState<SwapView>('swap');
  const [swapData, setSwapData] = useState<SwapData | null>(null);
  const [transactionId, setTransactionId] = useState<string | null>(null);
  const [transactionReference, setTransactionReference] = useState<string | null>(null);

  // Modal visibility state
  const [isWalletModalOpen, setIsWalletModalOpen] = useState(false);
  const [isWalletDetailsOpen, setIsWalletDetailsOpen] = useState(false);

  // Persist amounts between views
  const [sourceAmount, setSourceAmount] = useState('');
  const [targetAmount, setTargetAmount] = useState('');
  const [targetCurrency, setTargetCurrency] = useState<(typeof TargetCurrency)[keyof typeof TargetCurrency]>(TargetCurrency.BRL);

  // QR scanner state and URL param handling
  const [isQrOpen, setIsQrOpen] = useState(false);
  const [isDecodingQr, setIsDecodingQr] = useState(false);
  const [searchParams] = useSearchParams();
  const [quote_id, setquote_id] = useState<string>('');
  const [pixKey, setPixKey] = useState<string>('');
  const [taxId, setTaxId] = useState<string>('');


  const targetPaymentMethod = targetCurrency === TargetCurrency.BRL ? PaymentMethod.PIX : PaymentMethod.MOVII;


  useEffect(() => {
    if (searchParams.has('qr_scanner')) {
      setIsQrOpen(true);
      setTargetCurrency(TargetCurrency.BRL);
    }
  }, [searchParams]);

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

  const handleAmountsChange = useCallback(({ src, tgt, currency }: { src?: string, tgt?: string, currency?: (typeof TargetCurrency)[keyof typeof TargetCurrency] }) => {
    if (typeof src === 'string') setSourceAmount(src || '');
    if (typeof tgt === 'string') setTargetAmount(tgt || '');
    if (typeof currency === 'string') setTargetCurrency(currency);
  }, []);

  const fetchQuote = useCallback(async (targetAmount: number) => {
    console.log('handleTargetChange called with:', { targetCurrency, targetPaymentMethod, targetAmount });
    const response = await getQuote({
      target_currency: targetCurrency,
      payment_method: targetPaymentMethod,
      network: BlockchainNetwork.STELLAR,
      crypto_currency: CryptoCurrency.USDC,
      amount: targetAmount
    });
    if (response.status === 200) {
      const src = response.data.value.toFixed(2);
      handleAmountsChange?.({ src });
      setquote_id(response.data.quote_id);
    }

  }, [targetCurrency, targetPaymentMethod, handleAmountsChange]);

  // Handle QR results (PIX) and prefill amount
  const handleQrResult = useCallback(async (text: string) => {
    setIsQrOpen(false);
    setIsDecodingQr(true);
    try {
      const responseDecoder = await decodeQrCodeBR({ qrCode: text });
      if (responseDecoder.status !== 200) {
        alert(responseDecoder.data.reason)
        return
      }
      const amount = responseDecoder.data?.decoded?.amount;
      const pixKey = responseDecoder.data.decoded?.account;
      const taxIdDecoded = responseDecoder.data.decoded?.taxId;
      if (amount) {
        handleAmountsChange({ tgt: amount });
        fetchQuote(parseFloat(amount));
      }
      if (pixKey) {
        setPixKey(pixKey)
      }
      if (taxIdDecoded) {
        setTaxId(taxIdDecoded)
      }
    } catch (e) {
      console.warn('Failed to decode PIX QR', e);
    } finally {
      setIsDecodingQr(false);
    }
  }, [fetchQuote, handleAmountsChange]);

  const handleBackToSwap = useCallback(() => {
    localStorage.removeItem(PENDING_TX_KEY);
    setView('swap');
  }, []);

  const handleTransactionComplete = useCallback(async ({ memo }: { memo: string | null }) => {
    console.log('Transaction complete with memo:', memo);
    localStorage.removeItem(PENDING_TX_KEY);
    // If we're already showing status screen, keep it so user can see final state.
    setSwapData(null);
    setSourceAmount('');
    setTargetAmount('');
    setTransactionReference(null);
  }, []);

  // Show TxStatus screen right after signing
  const showTxStatus = useCallback((id: string | null, reference: string | null) => {
    if (id) setTransactionId(id);
    if (reference) setTransactionReference(reference);
    setView('txStatus');
  }, []);

  // Reset from TxStatus to start a fresh transaction
  const resetForNewTransaction = useCallback(() => {
    setSwapData(null);
    setSourceAmount('');
    setTargetAmount('');
    setTransactionId(null);
    setTransactionReference(null);
    setView('swap');
  }, []);

  // Determine desired desktop background URL based on currency
  const currentBgUrl = targetCurrency === 'BRL' ? BRL_BACKGROUND_IMAGE : ASSET_URLS.BACKGROUND_IMAGE;



  const onOpenQr = useCallback(() => {
    setIsQrOpen(true);
    setTargetCurrency(TargetCurrency.BRL);
  }, []);

  useEffect(() => {
    console.log("view", view);
  }, [view]);

  return {
    // State
    view,
    swapData,
    isWalletModalOpen,
    isWalletDetailsOpen,
    sourceAmount,
    targetAmount,
    targetCurrency,
    address,
    isQrOpen,
    currentBgUrl,
    isDecodingQr,
    transactionId,
    transactionReference,

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
    showTxStatus,
    resetForNewTransaction,
    handleQrResult,
    openQr: onOpenQr,
    closeQr: () => setIsQrOpen(false),
    handleTargetChange: fetchQuote,
    quoteId: quote_id,
    setQuoteId: setquote_id,
    pixKey,
    setPixKey,
    taxId,
    setTaxId
  };
};
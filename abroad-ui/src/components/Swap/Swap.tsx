import React, { useState, useEffect, useRef } from 'react';
import { Button } from "../Button";
import { ChevronsDown, Loader, CircleDollarSign, Landmark, Timer, Wallet } from 'lucide-react';
import { TokenBadge } from './TokenBadge';
import { lazy, Suspense } from 'react';
const IconAnimated = lazy(() => import('../IconAnimated').then(m => ({ default: m.IconAnimated })));
import { getReverseQuote, _36EnumsTargetCurrency as TargetCurrency, _36EnumsPaymentMethod as PaymentMethod, _36EnumsBlockchainNetwork as BlockchainNetwork, _36EnumsCryptoCurrency as CryptoCurrency } from '../../api/index';
import { useWalletAuth } from '../../context/WalletAuthContext';
import { kit } from '../../services/stellarKit';

// Define props for Swap component
interface SwapProps {
  onContinue: (
    quote_id: string,
    srcAmount: string,
    tgtAmount: string,
    targetCurrency: (typeof TargetCurrency)[keyof typeof TargetCurrency]
  ) => void;
  initialSourceAmount?: string;
  initialTargetAmount?: string;
  onAmountsChange?: (params: {
    src?: string;
    tgt?: string;
    currency?: (typeof TargetCurrency)[keyof typeof TargetCurrency];
  }) => void;
  textColor?: string;
  onWalletConnect?: () => void;
  sourceAmount: string;
  targetAmount: string;
  targetCurrency: (typeof TargetCurrency)[keyof typeof TargetCurrency];
  onTargetChange: (amount: number) => Promise<void>;
  quoteId: string;
  setQuoteId: (id: string) => void;
}

const COP_TRANSFER_FEE = 0.0;
const BRL_TRANSFER_FEE = 0.0;

export default function Swap({
  sourceAmount,
  targetAmount,
  targetCurrency,
  onContinue,
  onAmountsChange,
  textColor = '#356E6A',
  onTargetChange,
  quoteId,
  setQuoteId
}: SwapProps) {
  const { token, authenticateWithWallet } = useWalletAuth();
  const [loadingSource, setLoadingSource] = useState(false);
  const [loadingTarget, setLoadingTarget] = useState(false);
  const [displayedTRM, setDisplayedTRM] = useState(0.000);
  const sourceDebounceRef = useRef<NodeJS.Timeout | null>(null);
  const targetDebounceRef = useRef<NodeJS.Timeout | null>(null);
  // New: selected target currency (COP | BRL)
  // Dropdown state for currency selection
  const [currencyMenuOpen, setCurrencyMenuOpen] = useState(false);
  const currencyMenuRef = useRef<HTMLDivElement | null>(null);

  // Derived formatting and payment method by target currency
  const targetLocale = targetCurrency === TargetCurrency.BRL ? 'pt-BR' : 'es-CO';
  const targetSymbol = targetCurrency === TargetCurrency.BRL ? 'R$' : '$';
  const targetPaymentMethod = targetCurrency === TargetCurrency.BRL ? PaymentMethod.PIX : PaymentMethod.MOVII;
  // Dynamic transfer fee: BRL = 0, COP = 1354
  const transferFee = targetCurrency === TargetCurrency.BRL ? BRL_TRANSFER_FEE : COP_TRANSFER_FEE;

  // Close currency dropdown on outside click
  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (currencyMenuRef.current && !currencyMenuRef.current.contains(e.target as Node)) {
        setCurrencyMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);



  // Reset values when switching target currency to avoid stale quotes
  useEffect(() => {
    setQuoteId('');
    setDisplayedTRM(0);
    onAmountsChange?.({ src: '', tgt: '', currency: targetCurrency });
    // clear any pending debounce
    if (sourceDebounceRef.current) clearTimeout(sourceDebounceRef.current);
    if (targetDebounceRef.current) clearTimeout(targetDebounceRef.current);
  }, [onAmountsChange, setQuoteId, targetCurrency])

  const isButtonDisabled = () => {
    const numericSource = parseFloat(String(sourceAmount));
    // Clean targetAmount: remove thousands separators (.), change decimal separator (,) to .
    const cleanedTarget = String(targetAmount).replace(/\./g, '').replace(/,/g, '.');
    const numericTarget = parseFloat(cleanedTarget);
    return !(numericSource > 0 && numericTarget > 0);
  };

  const formatTargetNumber = (value: number) => new Intl.NumberFormat(targetLocale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);

  const handleSourceChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.target.value.replace(/[^0-9.]/g, '');
    // clear any pending debounce
    if (sourceDebounceRef.current) clearTimeout(sourceDebounceRef.current);
    // update state and notify parent
    onAmountsChange?.({ src: input });
    const num = parseFloat(input);
    if (isNaN(num)) {
      onAmountsChange?.({ src: '' });
      return;
    }
    setLoadingTarget(true);
    // debounce reverse quote API call
    console.log('Setting sourceDebounceRef');
    sourceDebounceRef.current = setTimeout(async () => {
      try {
        console.log('Fetching reverse quote for source amount:', num);
        const response = await getReverseQuote({
          target_currency: targetCurrency,
          source_amount: num,
          payment_method: targetPaymentMethod,
          network: BlockchainNetwork.STELLAR,
          crypto_currency: CryptoCurrency.USDC,
        });
        if (response.status === 200) {
          const formatted = formatTargetNumber(response.data.value);
          setQuoteId(response.data.quote_id); // Add this line
          onAmountsChange?.({ src: input, tgt: formatted });
        }
      } catch (error: unknown) {
        console.error('Reverse quote error', error);
      } finally {
        setLoadingTarget(false);
      }
    }, 300);
  };

  const handleSourceFocus = () => {
    // strip any formatting to show raw numbers
    onAmountsChange?.({ src: sourceAmount.replace(/[^0-9.]/g, '') });
  };

  const handleSourceBlur = () => {
    const num = parseFloat(sourceAmount);
    if (isNaN(num)) {
      onAmountsChange?.({ src: '' });
    } else {
      onAmountsChange?.({ src: num.toFixed(2) });
    }
  };

  const handleTargetChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    // allow digits, dots and commas; normalize commas to dots for parse
    const raw = e.target.value.replace(/[^0-9.,]/g, '');
    const normalized = raw.replace(/\./g, '').replace(/,/g, '.');
    const num = parseFloat(normalized);
    // clear any pending debounce
    if (targetDebounceRef.current) clearTimeout(targetDebounceRef.current);
    onAmountsChange?.({ tgt: raw });
    console.log('Setting targetDebounceRef', raw);
    if (isNaN(num)) {
      onAmountsChange?.({ src: '' });
      return;
    }
    setLoadingSource(true);
    // debounce quote API call
    targetDebounceRef.current = setTimeout(async () => {
      try {
        await onTargetChange(num);
      } catch (error: unknown) {
        console.error('Quote error', error);
      } finally {
        setLoadingSource(false);
      }
    }, 300);
  };

  const handleTargetBlur = () => {
    const clean = targetAmount.replace(/[^0-9.,]/g, '');
    const normalized = clean.replace(/\./g, '').replace(/,/g, '.');
    const num = parseFloat(normalized);
    if (isNaN(num)) {
      onAmountsChange?.({ tgt: '' });
    } else {
      // final numeric format with separators
      onAmountsChange?.({ tgt: formatTargetNumber(num) });
    }
  };

  useEffect(() => {
    if (!loadingSource && !loadingTarget) {
      const numericSource = parseFloat(sourceAmount);
      // Normalize targetAmount (which might have formatting) to a standard number string for parsing
      const cleanedTarget = targetAmount.replace(/\./g, '').replace(/,/g, '.');
      const numericTarget = parseFloat(cleanedTarget);

      if (numericSource > 0 && !isNaN(numericTarget) && numericTarget >= 0) {
        setDisplayedTRM((numericTarget + transferFee) / numericSource);
      } else {
        setDisplayedTRM(0.000);
      }
    }
    // If loadingSource or loadingTarget is true, displayedTRM remains unchanged.
  }, [sourceAmount, targetAmount, loadingSource, loadingTarget, transferFee]); // TransferFee is a module-level const

  // Direct wallet connection handler
  const handleDirectWalletConnect = () => {
    kit.openModal({
      onWalletSelected: async (option) => {
        authenticateWithWallet(option.id);
      },
    });
  };

  return (
    <div className="flex-1 flex items-center justify-center w-full flex flex-col">
      <div id="background-container"
        className="w-[90%] max-w-md min-h-[60vh] bg-[#356E6A]/5 backdrop-blur-xl rounded-4xl p-4 md:p-6 flex flex-col items-center justify-center space-y-1 lg:space-y-4"
      >
        {/* Title */}
        <div className="flex-1 flex items-center justify-center">
          <div id="Title" className="text-xl md:text-2xl font-bold text-center" style={{ color: textColor }}>
            ¿Cuánto deseas cambiar?
          </div>
  </div>

        {/* SOURCE */}
        <div
          id="source-amount"
          className="w-full bg-white/60 backdrop-blur-xl rounded-2xl p-4 md:py-6 md:px-6 flex items-center justify-between"
        >
          <div className="flex-1 flex items-center gap-2 min-w-0">
            <span className="text-xl md:text-2xl font-bold shrink-0" style={{ color: textColor }}>$</span>
            {loadingSource ? (
              <Loader className="animate-spin w-6 h-6" style={{ color: textColor }} />
            ) : (
              <input
                type="text"
                inputMode="decimal"
                pattern="[0-9.]*"
                value={sourceAmount}
                onChange={handleSourceChange}
                onFocus={handleSourceFocus}
                onBlur={handleSourceBlur}
                placeholder="0.00"
                className="w-full bg-transparent font-bold focus:outline-none text-xl md:text-2xl"
                style={{ color: textColor }}
              />
            )}
          </div>
          <TokenBadge
            iconSrc="https://storage.googleapis.com/cdn-abroad/Icons/Tokens/USDC%20Token.svg"
            alt="USDC Token Logo"
            symbol="USDC"
          />
        </div>

        {/* TARGET */}
        {token ? (
          <div
            id="target-amount"
            className="relative w-full bg-white/60 backdrop-blur-xl rounded-2xl p-4 md:py-6 md:px-6 flex items-center justify-between"
          >
            {/* chevrons */}
            <div className="absolute -top-4 left-1/2 -translate-x-1/2 w-8 h-8 bg-[#356E6A]/5 rounded-full grid place-items-center">
              <ChevronsDown color="#356E6A" className="w-4 h-4" />
            </div>

            {/* input */}
            <div className="flex-1 flex items-center gap-2 min-w-0">
              <span className="text-xl md:text-2xl font-bold shrink-0" style={{ color: textColor }}>
                {targetSymbol}
              </span>
              {loadingTarget ? (
                <Loader className="animate-spin w-6 h-6" style={{ color: textColor }} />
              ) : (
                <input
                  type="text"
                  inputMode="decimal"
                  pattern="[0-9.,]*"
                  value={targetAmount}
                  onChange={handleTargetChange}
                  onBlur={handleTargetBlur}
                  placeholder="0,00"
                  className="w-full bg-transparent font-bold focus:outline-none text-xl md:text-2xl"
                  style={{ color: textColor }}
                />
              )}
            </div>

            {/* selector de moneda */}
            <div className="relative ml-2 shrink-0" ref={currencyMenuRef}>
              <button
                type="button"
                onClick={() => setCurrencyMenuOpen(v => !v)}
                className="focus:outline-none"
                aria-haspopup="listbox"
                aria-expanded={currencyMenuOpen}
              >
                <TokenBadge
                  iconSrc={
                    targetCurrency === TargetCurrency.BRL
                      ? 'https://hatscripts.github.io/circle-flags/flags/br.svg'
                      : 'https://hatscripts.github.io/circle-flags/flags/co.svg'
                  }
                  alt={`${targetCurrency} Flag`}
                  symbol={targetCurrency}
                />
              </button>

              {currencyMenuOpen && (
                <div
                  className="absolute left-0 top-[calc(100%+8px)] z-50 bg-white/95 backdrop-blur-xl rounded-xl shadow-lg p-2 space-y-1 min-w-[100px]"
                  role="listbox"
                >
                  <button
                    type="button"
                    onClick={() => {
                      setCurrencyMenuOpen(false);
                      // Notify parent about currency change to update global state (e.g., background)
                      onAmountsChange?.({ src: sourceAmount, tgt: targetAmount, currency: TargetCurrency.COP });
                    }}
                    className="w-full text-left hover:bg-black/5 rounded-lg px-1 py-1"
                    role="option"
                    aria-selected={targetCurrency === TargetCurrency.COP}
                  >
                    <TokenBadge
                      iconSrc="https://hatscripts.github.io/circle-flags/flags/co.svg"
                      alt="Colombia flag"
                      symbol="COP"
                    />
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setCurrencyMenuOpen(false);
                      // Notify parent about currency change to update global state (e.g., background)
                      onAmountsChange?.({ src: sourceAmount, tgt: targetAmount, currency: TargetCurrency.BRL });
                    }}
                    className="w-full text-left hover:bg-black/5 rounded-lg px-1 py-1"
                    role="option"
                    aria-selected={targetCurrency === TargetCurrency.BRL}
                  >
                    <TokenBadge
                      iconSrc="https://hatscripts.github.io/circle-flags/flags/br.svg"
                      alt="Brazil flag"
                      symbol="BRL"
                    />
                  </button>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="w-full bg-white/60 backdrop-blur-xl rounded-2xl p-4 md:py-6 md:px-6 flex items-center justify-center gap-4">
            <div className="flex-shrink-0">
              <Suspense fallback={null}>
                <IconAnimated icon="Denied" size={40} trigger="once" />
              </Suspense>
            </div>
            <div className="flex flex-col space-y-1">
              <span className="text-lg font-semibold" style={{ color: textColor }}>
                Conecta tu billetera para poder cotizar
              </span>
            </div>
          </div>
        )}


        <div className="flex-1 flex items-center justify-center w-full">
          <div id="tx-info" className="w-full" style={{ color: textColor }}>
            <div className="flex flex-col space-y-2">
              <div id="trm" className="flex items-center space-x-2">
                <CircleDollarSign className="w-5 h-5" />
                <span>Tasa de Cambio: <b>{displayedTRM === 0 ? '-' : `${targetSymbol}${formatTargetNumber(displayedTRM)}`}</b></span>
              </div>
              <div id="transfer-fee" className="flex items-center space-x-2">
                <Landmark className="w-5 h-5" />
                <span>Costo de Transferencia: <b>{targetSymbol}{formatTargetNumber(transferFee)}</b></span>
              </div>
              <div id="time" className="flex items-center space-x-2">
                <Timer className="w-5 h-5" />
                <span>Tiempo: <b>10 - 30 segundos</b></span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <Button
        className="mt-4 w-[90%] max-w-md py-4"
        onClick={() => {
          if (!token) {
            // Always use direct wallet connection - prioritize the internal handler
            handleDirectWalletConnect();
          } else {
            console.log('Continue clicked with quote_id:', quoteId);
            if (!quoteId) {
              alert('Please wait for the quote to load before continuing');
              return;
            }
            onContinue(quoteId, sourceAmount, targetAmount, targetCurrency);
          }
        }}
        disabled={!!token && (isButtonDisabled() || !quoteId)}
      >
        {!token ? (
          <div className="flex items-center justify-center space-x-2">
            <Wallet className="w-5 h-5" />
            <span>Conectar Billetera</span>
          </div>
        ) : (
          'Continuar'
        )}
      </Button>
    </div>
  );
}
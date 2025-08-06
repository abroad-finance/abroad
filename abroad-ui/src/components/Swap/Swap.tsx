import React, { useState, useEffect, useRef } from 'react';
import { Button } from "../Button";
import { ChevronsDown, Loader, CircleDollarSign, Landmark, Timer, Wallet } from 'lucide-react';
import { TokenBadge } from './TokenBadge';
import { IconAnimated } from '../IconAnimated';
import { getQuote, getReverseQuote, _36EnumsTargetCurrency as TargetCurrency, _36EnumsPaymentMethod as PaymentMethod, _36EnumsBlockchainNetwork as BlockchainNetwork, _36EnumsCryptoCurrency as CryptoCurrency } from '../../api/index';
import { useWalletAuth } from '../../context/WalletAuthContext';
import { kit } from '../../services/stellarKit';

// Define props for Swap component
interface SwapProps {
  onContinue: (quote_id: string, srcAmount: string, tgtAmount: string) => void;
  initialSourceAmount?: string;
  initialTargetAmount?: string;
  onAmountsChange?: (srcAmount: string, tgtAmount: string) => void;
  textColor?: string;
  onWalletConnect?: () => void;
}

const TransferFee = 1354;

export default function Swap({ onContinue, initialSourceAmount = '', initialTargetAmount = '', onAmountsChange, textColor = '#356E6A', onWalletConnect }: SwapProps) {
    const { token, authenticateWithWallet } = useWalletAuth();
    const [sourceAmount, setSourceAmount] = useState(initialSourceAmount);
    const [targetAmount, setTargetAmount] = useState(initialTargetAmount || '');
    const [quote_id, setquote_id] = useState<string>('');
    const [loadingSource, setLoadingSource] = useState(false);
    const [loadingTarget, setLoadingTarget] = useState(false);
    const [displayedTRM, setDisplayedTRM] = useState(0.000);
    const sourceDebounceRef = useRef<NodeJS.Timeout | null>(null);
    const targetDebounceRef = useRef<NodeJS.Timeout | null>(null);

    const isButtonDisabled = () => {
      const numericSource = parseFloat(String(sourceAmount));
      // Clean targetAmount: remove thousands separators (.), change decimal separator (,) to .
      const cleanedTarget = String(targetAmount).replace(/\\./g, '').replace(/,/g, '.');
      const numericTarget = parseFloat(cleanedTarget);
      return !(numericSource > 0 && numericTarget > 0);
    };

    const formatCOPNumber = (value: number) => new Intl.NumberFormat('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);

    const handleSourceChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const input = e.target.value.replace(/[^0-9.]/g, '');
      // clear any pending debounce
      if (sourceDebounceRef.current) clearTimeout(sourceDebounceRef.current);
      // update state and notify parent
      setSourceAmount(input);
      onAmountsChange?.(input, targetAmount);
      const num = parseFloat(input);
      if (isNaN(num)) {
        setTargetAmount('');
        return;
      }
      setLoadingTarget(true);
      // debounce reverse quote API call
      sourceDebounceRef.current = setTimeout(async () => {
        try {
          const response = await getReverseQuote({
            target_currency: TargetCurrency.COP,
            source_amount: num,
            payment_method: PaymentMethod.MOVII,
            network: BlockchainNetwork.STELLAR,
            crypto_currency: CryptoCurrency.USDC,
          });
          if (response.status === 200) {
            const formatted = formatCOPNumber(response.data.value);
            setTargetAmount(formatted);
            setquote_id(response.data.quote_id); // Add this line
            onAmountsChange?.(input, formatted);
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
      setSourceAmount(prev => prev.replace(/[^0-9.]/g, ''));
    };

    const handleSourceBlur = () => {
      const num = parseFloat(sourceAmount);
      if (isNaN(num)) {
        setSourceAmount('');
      } else {
        // store only numeric string; dollar prefix is static
        setSourceAmount(num.toFixed(2));
      }
    };

    const handleTargetChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      // allow digits, dots and commas; normalize commas to dots for parse
      const raw = e.target.value.replace(/[^0-9.,]/g, '');
      const normalized = raw.replace(/\./g, '').replace(/,/g, '.');
      const num = parseFloat(normalized);
      // clear any pending debounce
      if (targetDebounceRef.current) clearTimeout(targetDebounceRef.current);
      setTargetAmount(raw);
      onAmountsChange?.(sourceAmount, raw);
      if (isNaN(num)) {
        setSourceAmount('');
        return;
      }
      setLoadingSource(true);
      // debounce quote API call
      targetDebounceRef.current = setTimeout(async () => {
        try {
          const response = await getQuote({
            target_currency: TargetCurrency.COP,
            payment_method: PaymentMethod.MOVII,
            network: BlockchainNetwork.STELLAR,
            crypto_currency: CryptoCurrency.USDC,
            amount: num,
          });
          if (response.status === 200) {
            const src = response.data.value.toFixed(2);
            setSourceAmount(src);
            setquote_id(response.data.quote_id);
            onAmountsChange?.(src, raw);
          }
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
        setTargetAmount('');
      } else {
        // final numeric format with separators
        setTargetAmount(formatCOPNumber(num));
      }
    };

    useEffect(() => {
      if (!loadingSource && !loadingTarget) {
        const numericSource = parseFloat(sourceAmount);
        // Normalize targetAmount (which might have COP formatting) to a standard number string for parsing
        const cleanedTarget = targetAmount.replace(/\./g, '').replace(/,/g, '.');
        const numericTarget = parseFloat(cleanedTarget);

        if (numericSource > 0 && !isNaN(numericTarget) && numericTarget >= 0) {
          setDisplayedTRM((numericTarget + TransferFee) / numericSource);
        } else {
          setDisplayedTRM(0.000);
        }
      }
      // If loadingSource or loadingTarget is true, displayedTRM remains unchanged.
    }, [sourceAmount, targetAmount, loadingSource, loadingTarget]); // TransferFee is a module-level const

    // Reset state when user gets authenticated
    useEffect(() => {
    }, [token]);

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
        <div id="background-container" className="w-[90%] max-w-md min-h-[60vh] h-auto bg-[#356E6A]/5 backdrop-blur-xl rounded-4xl p-4 md:p-6 flex flex-col items-center justify-center space-y-1 lg:space-y-4">
          {/* Here starts Swap as a component */}
          <div className="flex-1 flex items-center justify-center">
            <div id="Title" className="text-xl md:text-2xl font-bold text-center" style={{ color: textColor }}>¿Cuanto deseas Cambiar?</div>
          </div>
          <div id="source-amount" className="w-full bg-white/60 backdrop-blur-xl rounded-2xl p-4 md:p-6 lg:py-6 xl:py-6 min-h-[800px]:py-16 flex items-center justify-start">
            {/* number input area: always show $ prefix, then spinner or input */}
            <div className="w-3/4 h-full flex items-center space-x-2">
              <span className="text-xl md:text-2xl font-bold" style={{ color: textColor }}>$</span>
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
                  className="w-full h-full bg-transparent font-bold focus:outline-none text-xl md:text-2xl text-left"
                  style={{ color: textColor }}
                />
              )}
            </div>
            <TokenBadge iconSrc="https://storage.googleapis.com/cdn-abroad/Icons/Tokens/USDC%20Token.svg" alt="USDC Token Logo" symbol="USDC"/>
          </div>
          
          {token ? (
            <div id="target-amount" className="relative w-full bg-white/60 backdrop-blur-xl rounded-2xl p-4 md:p-6 lg:py-6 xl:py-6 min-h-[800px]:py-16 flex items-center justify-start">
              {/* circular cutout effect matching bg-container-1 */}
              <div className="absolute -top-4 left-1/2 transform -translate-x-1/2 w-8 h-8 bg-[#356E6A]/5 rounded-full flex items-center justify-center">
                <ChevronsDown color="#356E6A" className="w-4 h-4" />
              </div>
              {/* number input area: loader or input, centered */}
              <div className="w-3/4 h-full flex items-center space-x-2">
                <span className="text-xl md:text-2xl font-bold" style={{ color: textColor }}>$</span>
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
                    className="w-full h-full bg-transparent font-bold focus:outline-none text-xl md:text-2xl text-left"
                    style={{ color: textColor }}
                  />
                )}
              </div>
              <TokenBadge iconSrc="https://storage.googleapis.com/cdn-abroad/Icons/Tokens/COP-Token.svg" alt="COP Token Logo" symbol="COP" />
            </div>
          ) : (
            <div className="w-full bg-white/60 backdrop-blur-xl rounded-2xl p-4 md:p-6 lg:py-6 xl:py-6 min-h-[800px]:py-16 flex items-center justify-center space-x-4">
              <div className="flex-shrink-0">
                <IconAnimated icon='Denied' size={40} trigger='once'/>
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
                  <span>Tasa de Cambio: <b>${displayedTRM === 0 ? '-' : formatCOPNumber(displayedTRM)}</b></span>
                </div>  
                <div id="transfer-fee" className="flex items-center space-x-2">
                  <Landmark className="w-5 h-5" />
                  <span>Costo de Transferencia: <b>${formatCOPNumber(TransferFee)}</b></span>
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
              console.log('Continue clicked with quote_id:', quote_id);
              if (!quote_id) {
                alert('Please wait for the quote to load before continuing');
                return;
              }
              onContinue(quote_id, sourceAmount, targetAmount);
            }
          }}
          disabled={!!token && (isButtonDisabled() || !quote_id)}
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
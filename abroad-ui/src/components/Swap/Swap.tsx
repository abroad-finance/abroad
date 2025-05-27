import React, { useState, useEffect, useRef } from 'react';
// Define props for Swap component
interface SwapProps {
  onContinue: (quote_id: string, srcAmount: string, tgtAmount: string) => void;
  initialSourceAmount?: string;
  initialTargetAmount?: string;
  onAmountsChange?: (srcAmount: string, tgtAmount: string) => void;
}

import { Button } from "../../components/button";
import { ChevronsDown, Loader, CircleDollarSign, Landmark, Timer } from 'lucide-react';
import { TokenBadge } from './TokenBadge';
import { getQuote, getReverseQuote, _36EnumsTargetCurrency, _36EnumsPaymentMethod, _36EnumsBlockchainNetwork, _36EnumsCryptoCurrency } from '../../api/index';

const TransferFee = 1354;

export default function Swap({ onContinue, initialSourceAmount = '', initialTargetAmount = '', onAmountsChange }: SwapProps) {
    // state for source (USD) and target (COP) amounts
    const [sourceAmount, setSourceAmount] = useState(initialSourceAmount);
    const [targetAmount, setTargetAmount] = useState(initialTargetAmount || '');
    const [quote_id, setquote_id] = useState<string>('');
    // loading state for source quote
    const [loadingSource, setLoadingSource] = useState(false);
    // loading state for reverse quote
    const [loadingTarget, setLoadingTarget] = useState(false);
    const [displayedTRM, setDisplayedTRM] = useState(0.000);
    // debounce refs for delaying API calls
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

   // handlers managing raw numeric input then formatting on blur
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
           target_currency: _36EnumsTargetCurrency.COP,
           source_amount: num,
           payment_method: _36EnumsPaymentMethod.MOVII,
           network: _36EnumsBlockchainNetwork.STELLAR,
           crypto_currency: _36EnumsCryptoCurrency.USDC,
         });
         if (response.status === 200) {
           const formatted = formatCOPNumber(response.data.value);
           setTargetAmount(formatted);
           setquote_id(response.data.quote_id); // Add this line
           onAmountsChange?.(input, formatted);
         }
       } catch (error) {
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
           target_currency: _36EnumsTargetCurrency.COP,
           payment_method: _36EnumsPaymentMethod.MOVII,
           network: _36EnumsBlockchainNetwork.STELLAR,
           crypto_currency: _36EnumsCryptoCurrency.USDC,
           amount: num,
         });
         if (response.status === 200) {
           const src = response.data.value.toFixed(2);
           setSourceAmount(src);
           setquote_id(response.data.quote_id);
           onAmountsChange?.(src, raw);
         }
       } catch (error) {
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

   return (
     // Removed the outermost div and institutional logo
     // Centered white card covering 60% of screen
     <div className="flex-1 flex items-center justify-center w-full flex flex-col">
       <div id="background-container" className="w-[90%] max-w-[50vh] h-[60vh] bg-[#356E6A]/5 backdrop-blur-xl rounded-4xl p-6 flex flex-col items-center justify-center space-y-1">
         {/* Here starts Swap as a component */}
         <div id="Title" className="text-2xl font-bold mb-8 text-[#356E6A]">¿Cuanto deseas Retirar?</div>
         <div id="source-amount" className="w-full h-[60vh] bg-white/60 backdrop-blur-xl rounded-4xl p-6 flex items-center justify-start">
           {/* number input area: always show $ prefix, then spinner or input */}
           <div className="w-3/4 h-full flex items-center space-x-2">
             <span className="text-2xl text-[#356E6A] font-bold">$</span>
             {loadingSource ? (
               <Loader className="animate-spin w-6 h-6 text-[#356E6A]" />
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
                 className="w-full h-full bg-transparent font-bold focus:outline-none text-2xl text-[#356E6A] text-left"
               />
             )}
           </div>
           <TokenBadge iconSrc="https://storage.cloud.google.com/cdn-abroad/Icons/Tokens/USDC%20Token.svg" alt="USDC Token Logo" symbol="USDC"/>
         </div>
         <div id="target-amount" className="relative w-full h-[60vh] bg-white/60 backdrop-blur-xl rounded-4xl p-6 flex items-center justify-start">
           {/* circular cutout effect matching bg-container-1 */}
           <div className="absolute -top-4 left-1/2 transform -translate-x-1/2 w-8 h-8 bg-[#356E6A]/5 rounded-full flex items-center justify-center">
             <ChevronsDown color="#356E6A" className="w-4 h-4" />
           </div>
           {/* number input area: loader or input, centered */}
           <div className="w-3/4 h-full flex items-center space-x-2">
             <span className="text-2xl text-[#356E6A] font-bold">$</span>
             {loadingTarget ? (
               <Loader className="animate-spin w-6 h-6 text-[#356E6A]" />
             ) : (
               <input
                 type="text"
                 inputMode="decimal"
                 pattern="[0-9.,]*"
                 value={targetAmount}
                 onChange={handleTargetChange}
                 onBlur={handleTargetBlur}
                 placeholder="0,00"
                 className="w-full h-full bg-transparent font-bold focus:outline-none text-2xl text-[#356E6A] text-left"
               />
             )}
           </div>
           <TokenBadge iconSrc="https://storage.cloud.google.com/cdn-abroad/Icons/Tokens/COP-Token.svg" alt="COP Token Logo" symbol="COP" />
         </div>

         <div id="tx-info" className="relative w-full h-[60vh] text-[#356E6A] pt-6 pl-4 flex items-center justify-start">
           <div className="h-full flex-col items-center space-x-2">
           <div  id="trm" className="flex items-center space-x-2 pb-2">
               <CircleDollarSign className="w-5 h-5" />
               <span>Tasa de Cambio: <b>${displayedTRM === 0 ? '-' : formatCOPNumber(displayedTRM)}</b> </span>
             </div>  
             <div id="transfer-fee" className="flex items-center space-x-2 pb-2">
               <Landmark className="w-5 h-5" />
               <span>Costo de Transferencia: <b>${formatCOPNumber(TransferFee)}</b></span>
             </div>  
           <div id="time" className="flex items-center space-x-2 pb-2">
               <Timer className="w-5 h-5" />
               <span>Tiempo: <b>1 - 3 minutos</b></span>
             </div>
           </div>
         </div>
       </div>
       <Button
         className="mt-4 w-[90%] max-w-[50vh] py-4"
         onClick={() => onContinue(quote_id, sourceAmount, targetAmount)}
         disabled={isButtonDisabled()}
       >
         Continuar
       </Button>
     </div> // This div closes the "flex-1" container
     // Removed the "Continue" Button from here
   );
}
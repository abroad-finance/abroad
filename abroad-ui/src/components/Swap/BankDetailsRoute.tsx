import React, { useState, useEffect } from 'react';
import { Button } from "../Button";
import { Loader, Landmark, Hash, ArrowLeft, Rotate3d} from 'lucide-react';
import { getBanks, Bank, getBanksResponse200 } from '../../api';

interface BankDetailsRouteProps {
  onBackClick: () => void;
  onTransactionComplete: () => void;
  quote_id: string;
  sourceAmount: string;
  targetAmount: string;
}


export default function BankDetailsRoute({ onBackClick, quote_id, targetAmount, onTransactionComplete }: BankDetailsRouteProps): React.JSX.Element {
  const [account_number, setaccount_number] = useState('');
  const [bank_code, setbank_code] = useState<string>('');
  const [loadingSubmit, setLoadingSubmit] = useState(false);

  const [apiBanks, setApiBanks] = useState<Bank[]>([]);
  const [loadingBanks, setLoadingBanks] = useState<boolean>(false);
  const [errorBanks, setErrorBanks] = useState<string | null>(null);

  useEffect(() => {
    const fetchBanks = async () => {
      setLoadingBanks(true);
      setErrorBanks(null);
      try {
        const response = await getBanks();
        if (response.status === 200 && (response as getBanksResponse200).data?.banks) {
          setApiBanks((response as getBanksResponse200).data.banks);
        } else {
          const errorResponseMessage = response.status === 400 ? 'Bad request to bank API.' : `Failed to fetch banks. Status: ${response.status}`;
          setErrorBanks(errorResponseMessage);
          console.error('Error fetching banks:', response);
        }
      } catch (err) {
        setErrorBanks(err instanceof Error ? err.message : 'An unknown error occurred while fetching banks.');
        console.error(err);
      } finally {
        setLoadingBanks(false);
      }
    };

    fetchBanks();
  }, []);

  const handleaccount_numberChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.target.value.replace(/[^\d]/g, '').slice(0, 10); // MODIFIED: Limit to 10 digits
    setaccount_number(input);
  };

  const handleBankChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setbank_code(e.target.value);
  };

  const handleSubmit = () => {
    setLoadingSubmit(true);
    console.log('Bank Details:', { bank_code, account_number, quote_id });
    setTimeout(() => {
      setLoadingSubmit(false);
      onTransactionComplete();
    }, 1500);
  };
  


  return (
    <div className="flex-1 flex items-center justify-center w-full flex-col">
      <div 
        id="bg-container" 
        className="relative w-[90%] max-w-[50vh] h-[60vh] bg-[#356E6A]/5 backdrop-blur-xl rounded-4xl p-6 flex flex-col items-center justify-between space-y-4" // MODIFIED: Changed justify-start to justify-between
      >
        {/* Header Row: Back button and Title */}
        <div className="w-full flex items-center space-x-3 mb-4">
          <button 
            onClick={onBackClick} 
            className="text-[#356E6A] hover:text-[#2a5956] transition-colors"
            aria-label="Go back"
          >
            <ArrowLeft className="w-6 h-6" />
          </button>

          <div id="Tittle" className="text-2xl font-bold text-[#356E6A] flex-grow text-center">Datos de Transacción</div> 
        </div>
        
        {/* Centered Content Wrapper */}
        <div className="flex-grow flex flex-col items-center justify-center w-full space-y-4">
          {/* Bank Account Number Input */}
          <div id="bank-account-input" className="w-full bg-white/60 backdrop-blur-xl rounded-2xl p-4 flex items-center space-x-3">
            <Hash className="w-6 h-6 text-[#356E6A]" />
            <input 
              type="text" 
              inputMode="numeric" 
              pattern="[0-9]*"  
              placeholder="Número Transfiya"
              value={account_number}
              onChange={handleaccount_numberChange}
              className="w-full bg-transparent font-semibold focus:outline-none text-lg text-[#356E6A] placeholder-[#356E6A]/70"
            />
          </div>

          {/* Bank Selector Dropdown */}
          <div id="bank-selector" className="w-full bg-white/60 backdrop-blur-xl rounded-2xl p-4 flex items-center space-x-3">
            <Landmark className="w-6 h-6 text-[#356E6A]" />
            {loadingBanks && <Loader className="animate-spin w-5 h-5 text-[#356E6A]" />}
            {errorBanks && <p className="text-red-500 text-sm">{errorBanks}</p>}
            {!loadingBanks && !errorBanks && apiBanks.length === 0 && <p className="text-[#356E6A]/70">No hay bancos disponibles.</p>}
            {!loadingBanks && !errorBanks && apiBanks.length > 0 && (
              <select
                value={bank_code}
                onChange={handleBankChange}
                className="w-full bg-transparent font-semibold focus:outline-none text-lg text-[#356E6A] appearance-none"
              >
                <option value="" disabled className="text-[#356E6A]/70">Selecciona un banco</option>
                {apiBanks.map((bank: Bank) => (
                  <option key={bank.bankCode} value={String(bank.bankCode)} className="text-[#356E6A]">
                    {bank.bankName}
                  </option>
                ))}
              </select>
            )}
          </div>
          {/* Transaction Info */}
          <div id="tx-info" className="relative font-medium w-full text-[#356E6A] flex items-center justify-start space-x-1"> {/* MODIFIED: items-center, justify-start, space-x-1 */}
            Monto a recibir: <img className='w-5 h-5' src="https://storage.cloud.google.com/cdn-abroad/Icons/Tokens/COP-Token.svg" alt="COP_Token" /> <b> ${targetAmount}</b>
          </div>
        </div>

        {/* Transfer Disclaimer */}      
        <div id="transfer-disclaimer" className="relative w-full text-[#356E6A] bg-[#356E6A]/10 backdrop-blur-xl rounded-2xl p-4 flex flex-col items-start space-y-2 justify-start">
          <div className="flex items-center space-x-2"> 
            <Rotate3d className="w-5 h-5 text-[#356E6A]" />
            <span className="font-medium text-sm text-[#356E6A]">Red:</span>
            <div 
              id="transfer-network-badge" 
              className="bg-white/70 backdrop-blur-md rounded-lg px-2 py-1 flex items-center"
            >
              <img 
                src="https://vectorseek.com/wp-content/uploads/2023/11/Transfiya-Logo-Vector.svg-.png" 
                alt="Transfiya Logo" 
                className="h-4 w-auto"
              />
            </div> 
          </div>
          <span id='transfer-disclaimer-text' className="font-medium text-xs text-[#356E6A]/90 pl-1">Tu transacción será procesada de inmediato y llegará instantáneamente. Ten presente que el receptor debe tener activado Transfiya en el banco indicado.</span>         
        </div>
      </div>
      <Button 
        className="mt-4 w-[90%] max-w-[50vh] py-4"
        onClick={handleSubmit}
        disabled={loadingSubmit || !bank_code || account_number.length !== 10 || loadingBanks} // MODIFIED: Added check for 10 digits
      >
        {loadingSubmit ? <Loader className="animate-spin w-5 h-5" /> : 'Continuar'}
      </Button>
    </div>
  );
}
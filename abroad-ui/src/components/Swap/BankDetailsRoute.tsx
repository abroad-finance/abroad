import React, { useState, useEffect, useCallback } from 'react';
import { Button } from "../Button";
import { Loader, Hash, ArrowLeft, Rotate3d} from 'lucide-react';
import { getBanks, Bank, getBanksResponse200, acceptTransaction } from '../../api';
import { DropSelector, Option } from '../DropSelector';

interface BankDetailsRouteProps {
  onBackClick: () => void;
  onTransactionComplete: ({ memo }: { memo: string }) => Promise<void>;
  quote_id: string;
  sourceAmount: string;
  targetAmount: string;
  userId: string;
  textColor?: string;
}


export default function BankDetailsRoute({ userId, onBackClick, quote_id, targetAmount, onTransactionComplete, textColor = '#356E6A' }: BankDetailsRouteProps): React.JSX.Element {
  const [account_number, setaccount_number] = useState('');
  const [bank_code, setbank_code] = useState<string>('');
  const [loadingSubmit, setLoadingSubmit] = useState(false);
  const [bankOpen, setBankOpen] = useState(false);
  const [selectedBank, setSelectedBank] = useState<Option | null>(null);

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

  const handleBankSelect = (option: Option) => {
    setSelectedBank(option);
    setbank_code(option.value);
  };

  // Bank configuration mapping
  const bankConfig: Record<string, { iconUrl: string; displayLabel?: string }> = {
    'NEQUI': {
      iconUrl: 'https://storage.googleapis.com/cdn-abroad/Icons/Banks/Nequi_Badge.webp',
      displayLabel: 'Nequi'
    },
    'MOVII': {
      iconUrl: 'https://storage.googleapis.com/cdn-abroad/Icons/Banks/movii_badge.png'
    },
    'DAVIPLATA': {
      iconUrl: 'https://storage.googleapis.com/cdn-abroad/Icons/Banks/Daviplata_Badge.png',
      displayLabel: 'Daviplata'
    },
    'DAVIVIENDA': {
      iconUrl: 'https://storage.googleapis.com/cdn-abroad/Icons/Banks/Davivienda_Badge.png',
      displayLabel: 'Davivienda'
    },
    'BANCOLOMBIA': {
      iconUrl: 'https://storage.googleapis.com/cdn-abroad/Icons/Banks/Bancolombia_Badge.png'
    },
    'SUPERDIGITAL': {
      iconUrl: 'https://storage.googleapis.com/cdn-abroad/Icons/Banks/Superdigital_Badge.png'
    },
    'BANCO ITAU': {
      iconUrl: 'https://storage.googleapis.com/cdn-abroad/Icons/Banks/Itau_Badge.png',
      displayLabel: 'Itau'
    },
    'BANCO FALABELLA': {
      iconUrl: 'https://storage.googleapis.com/cdn-abroad/Icons/Banks/Falabella_Badge.png'
    },
    'BANCO COOPERATIVO COOPCENTRAL DIGITAL': {
      iconUrl: 'https://storage.googleapis.com/cdn-abroad/Icons/Banks/Bcc_Badge.jpg',
      displayLabel: 'Coopcentral'
    },
    'BANCO SERFINANZA': {
      iconUrl: 'https://storage.googleapis.com/cdn-abroad/Icons/Banks/Bancoserfinanza_badge.jpg',
      displayLabel: 'Serfinanza'
    },
    'BANCOBBVA': {
      iconUrl: 'https://storage.googleapis.com/cdn-abroad/Icons/Banks/BBVA_Badge.jpg',
      displayLabel: 'BBVA'
    },
    'BANCO POWWI': {
      iconUrl: 'https://storage.googleapis.com/cdn-abroad/Icons/Banks/Powwico_Badge.jpg',
      displayLabel: 'Powwi'
    },
    'BANCO CAJA SOCIAL': {
      iconUrl: 'https://storage.googleapis.com/cdn-abroad/Icons/Banks/CajaSocial_Badge.webp',
      displayLabel: 'Banco Caja Social'
    },
    'BANCO AGRARIO DE COLOMBIA': {
      iconUrl: 'https://storage.googleapis.com/cdn-abroad/Icons/Banks/BancoAgrario_Badge.jpg',
      displayLabel: 'Banco Agrario'
    },
    'BANCO DE LAS MICROFINANZAS BANCAMIA SA': {
      iconUrl: 'https://storage.googleapis.com/cdn-abroad/Icons/Banks/Bancamia_Badge.jpg',
      displayLabel: 'Bancamia'
    },
    'BANCO CREZCAMOS': {
      iconUrl: 'https://storage.googleapis.com/cdn-abroad/Icons/Banks/BancoCrezcamos_Badge.png',
      displayLabel: 'Banco Crezcamos'
    },
    'BANCO FINANDINA': {
      iconUrl: 'https://storage.googleapis.com/cdn-abroad/Icons/Banks/BancoFinandina_Badge.png',
      displayLabel: 'Banco Finandina'
    }
  };

  // Banks to exclude from the list
  const excludedBanks = ['CFA COOPERATIVA FINANCIERA', 'CONFIAR COOPERATIVA FINANCIERA', 'BANCOCOOPCENTRAL'];

  // Convert API banks to DropSelector options
  const bankOptions: Option[] = apiBanks
    .filter((bank: Bank) => !excludedBanks.includes(bank.bankName.toUpperCase()))
    .map((bank: Bank) => {
      const bankNameUpper = bank.bankName.toUpperCase();
      const config = bankConfig[bankNameUpper];
      
      return {
        value: String(bank.bankCode),
        label: config?.displayLabel || bank.bankName,
        iconUrl: config?.iconUrl,
      };
    }).sort((a, b) => a.label.localeCompare(b.label));

  const handleSubmit = useCallback(async () => {
    setLoadingSubmit(true);

    // // KYC
    // const responseKYC = await checkKyc({user_id: userId});

    // if (responseKYC.status !== 200) {
    //   console.error('Error checking KYC:', responseKYC);
    //   alert(`Error: ${responseKYC.data.reason}`);
    //   setLoadingSubmit(false);
    //   return;
    // }

    // if (responseKYC.data.kyc_status !== 'APPROVED') {
    //   // open KYC link in a new tab
    //   window.open(responseKYC.data.kyc_link, '_blank');
    //   alert('Por favor completa el proceso de KYC antes de continuar.');
    //   setLoadingSubmit(false);
    //   return;
    // }


    console.log('Bank Details:', { bank_code, account_number, quote_id });
    const response = await acceptTransaction({ account_number, bank_code, quote_id, user_id: userId });
    if (response.status === 200) {
      console.log('Transaction accepted successfully:', response.data);
      await onTransactionComplete({ memo: response.data.transaction_reference });
    } else {
      console.error('Error accepting transaction:', response);
      alert(`Error: ${response.data.reason}`);
    }
    setLoadingSubmit(false);
  }, [account_number, bank_code, quote_id, userId, onTransactionComplete]);



  return (
    <div className="flex-1 flex items-center justify-center w-full flex-col">
      <div
        id="bg-container"
        className="relative w-[90%] max-w-md min-h-[60vh] h-auto bg-[#356E6A]/5 backdrop-blur-xl rounded-4xl p-4 md:p-6 flex flex-col items-center space-y-4"
      >
        {/* Header Row: Back button and Title */}
        <div className="w-full flex items-center space-x-3 mb-2 flex-shrink-0">
          <button
            onClick={onBackClick}
            className="hover:text-opacity-80 transition-colors"
            style={{ color: textColor }}
            aria-label="Go back"
          >
            <ArrowLeft className="w-6 h-6" />
          </button>

          <div id="Tittle" className="text-xl sm:text-2xl font-bold flex-grow text-center" style={{ color: textColor }}>Datos de Transacción</div>
        </div>

        {/* Centered Content Wrapper */}
        <div className="flex-1 flex flex-col items-center justify-center w-full space-y-3 py-2">
          {/* Bank Account Number Input */}
          <div id="bank-account-input" className="w-full bg-white/60 backdrop-blur-xl rounded-2xl p-4 md:p-6 lg:py-6 xl:py-6 min-h-[800px]:py-16 flex items-center space-x-3 flex-shrink-0">
            <Hash className="w-5 h-5 sm:w-6 sm:h-6" style={{ color: textColor }} />
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              placeholder="Número Transfiya"
              value={account_number}
              onChange={handleaccount_numberChange}
              className="w-full bg-transparent font-semibold focus:outline-none text-base sm:text-lg"
              style={{ color: textColor }}
            />
          </div>

          {/* Bank Selector Dropdown */}
          <div id="bank-selector" className="w-full bg-white/60 backdrop-blur-xl rounded-2xl flex-shrink-0 relative z-50">
            {loadingBanks && (
              <div className="p-6 flex items-center space-x-3">
                <Loader className="animate-spin w-4 h-4 sm:w-5 sm:h-5" style={{ color: textColor }} />
              </div>
            )}
            {errorBanks && (
              <div className="p-6 flex items-center space-x-3">
                <p className="text-red-500 text-xs sm:text-sm">{errorBanks}</p>
              </div>
            )}
            {!loadingBanks && !errorBanks && apiBanks.length === 0 && (
              <div className="p-6 flex items-center space-x-3">
                <p className="text-[#356E6A]/70 text-xs sm:text-sm">No hay bancos disponibles.</p>
              </div>
            )}
            {!loadingBanks && !errorBanks && apiBanks.length > 0 && (
              <div className="p-6 flex items-center space-x-3 w-full">
                <div className="flex-1">
                  <DropSelector
                    options={bankOptions}
                    selectedOption={selectedBank}
                    onSelectOption={handleBankSelect}
                    isOpen={bankOpen}
                    setIsOpen={setBankOpen}
                    placeholder="Banco"
                    disabled={loadingBanks || errorBanks !== null}
                    textColor={textColor}
                    placeholderIcons={[
                      'https://storage.googleapis.com/cdn-abroad/Icons/Banks/Nequi_Badge.webp',
                      'https://storage.googleapis.com/cdn-abroad/Icons/Banks/Daviplata_Badge.png',
                      'https://storage.googleapis.com/cdn-abroad/Icons/Banks/Bancolombia_Badge.png'
                    ]}
                  />
                </div>
              </div>
            )}
          </div>
          {/* Transaction Info */}
          <div id="tx-info" className="relative font-medium w-full flex items-center justify-start space-x-1 flex-shrink-0" style={{ color: textColor }}>
            <span className="text-sm sm:text-base">Monto a recibir:</span> <img className='w-4 h-4 sm:w-5 sm:h-5' src="https://storage.googleapis.com/cdn-abroad/Icons/Tokens/COP-Token.svg" alt="COP_Token" /> <b className="text-sm sm:text-base"> ${targetAmount}</b>
          </div>
        </div>

        {/* Transfer Disclaimer */}
        <div id="transfer-disclaimer" className="relative w-full bg-white/10 backdrop-blur-xl rounded-2xl p-3 sm:p-4 flex flex-col items-start space-y-2 justify-start flex-shrink-0" style={{ color: textColor }}>
          <div className="flex items-center space-x-2">
            <Rotate3d className="w-4 h-4 sm:w-5 sm:h-5" />
            <span className="font-medium text-xs sm:text-sm">Red:</span>
            <div
              id="transfer-network-badge"
              className="bg-white/70 backdrop-blur-md rounded-lg px-2 py-1 flex items-center"
            >
              <img
                src="https://vectorseek.com/wp-content/uploads/2023/11/Transfiya-Logo-Vector.svg-.png"
                alt="Transfiya Logo"
                className="h-3 sm:h-4 w-auto"
              />
            </div>
          </div>
          <span id='transfer-disclaimer-text' className="font-medium text-xs text-opacity-90 pl-1" style={{ color: textColor }}>Tu transacción será procesada de inmediato y llegará instantáneamente. Ten presente que el receptor debe tener activado Transfiya en el banco indicado.</span>
        </div>
      </div>
      <Button
        className="mt-4 w-[90%] max-w-md py-4"
        onClick={handleSubmit}
        disabled={loadingSubmit || !bank_code || account_number.length !== 10 || loadingBanks}
      >
        {loadingSubmit ? <Loader className="animate-spin w-4 h-4 sm:w-5 sm:h-5" /> : 'Continuar'}
      </Button>
    </div>
  );
}
import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { X } from 'lucide-react';
import { Button } from '../Button';
import { DropSelector, Option } from '../DropSelector';
import { useLanguage } from '../../contexts/LanguageContext';

const translations = {
  en: {
    addLiquidity: "Add Liquidity",
    accountName: "Account Name",
    accountId: "Account ID",
    currency: "Currency",
    bankExchange: "Bank/Exchange",
    selectCurrency: "Select Currency",
    selectBankExchange: "Select Bank/Exchange",
    accountNamePlaceholder: "e.g., My Savings",
    accountIdPlaceholder: "e.g., 123-4567-890"
  },
  es: {
    addLiquidity: "Agregar Liquidez",
    accountName: "Nombre de Cuenta",
    accountId: "ID de Cuenta",
    currency: "Moneda",
    bankExchange: "Banco/Exchange",
    selectCurrency: "Seleccionar Moneda",
    selectBankExchange: "Seleccionar Banco/Exchange",
    accountNamePlaceholder: "ej., Mis Ahorros",
    accountIdPlaceholder: "ej., 123-4567-890"
  },
  pt: {
    addLiquidity: "Adicionar Liquidez",
    accountName: "Nome da Conta",
    accountId: "ID da Conta",
    currency: "Moeda",
    bankExchange: "Banco/Exchange",
    selectCurrency: "Selecionar Moeda",
    selectBankExchange: "Selecionar Banco/Exchange",
    accountNamePlaceholder: "ex., Minhas Economias",
    accountIdPlaceholder: "ex., 123-4567-890"
  },
  zh: {
    addLiquidity: "添加流动性",
    accountName: "账户名称",
    accountId: "账户ID",
    currency: "货币",
    bankExchange: "银行/交易所",
    selectCurrency: "选择货币",
    selectBankExchange: "选择银行/交易所",
    accountNamePlaceholder: "例如，我的储蓄",
    accountIdPlaceholder: "例如，123-4567-890"
  }
};

interface AddLiquidityProps {
  isOpen: boolean;
  onClose: () => void;
  onAdd: (data: { accountName: string; accountId: string; currency: Option; bank: Option; value: number }) => void;
}

const currencyOptions: Option[] = [
  { value: 'COP', label: 'Colombian Peso', iconUrl: "https://hatscripts.github.io/circle-flags/flags/co.svg" },
  { value: 'BRL', label: 'Brazilian Real', iconUrl: "https://hatscripts.github.io/circle-flags/flags/br.svg" },
  { value: 'ARS', label: 'Argentinian Peso', iconUrl: "https://hatscripts.github.io/circle-flags/flags/ar.svg" },
  { value: 'USDC', label: 'USDC', iconUrl: "https://storage.googleapis.com/cdn-abroad/Icons/Tokens/USDC%20Token.svg" },
  { value: 'USDT', label: 'USDT', iconUrl: "https://storage.googleapis.com/cdn-abroad/Icons/Tokens/USDT-token.svg" },
];

const bankOptions: Option[] = [
  { value: 'Coink', label: 'Coink', iconUrl: "https://storage.googleapis.com/cdn-abroad/Icons/Banks/coink_badge.png" },
  { value: 'Iris', label: 'Iris', iconUrl: "https://storage.googleapis.com/cdn-abroad/Icons/Banks/iris_badge.webp" },
  { value: 'Mono', label: 'Mono', iconUrl: "https://storage.googleapis.com/cdn-abroad/Icons/Banks/mono_badge.jpg" },
  { value: 'Movii', label: 'Movii', iconUrl: "https://storage.googleapis.com/cdn-abroad/Icons/Banks/movii_badge.png" },
  { value: 'Binance', label: 'Binance', iconUrl: "https://storage.googleapis.com/cdn-abroad/Icons/Banks/Binance_Black_Icon.svg" },
  { value: 'TrustWallet', label: 'TrustWallet', iconUrl: "https://storage.googleapis.com/cdn-abroad/Icons/Banks/Trust_Wallet_Shield.svg" },
  { value: 'SqualaPay', label: 'SqualaPay', iconUrl: "https://storage.googleapis.com/cdn-abroad/Icons/Banks/sqalatech_badge.jpeg" },
  { value: 'Transfero', label: 'Transfero', iconUrl: "https://storage.googleapis.com/cdn-abroad/Icons/Banks/transfero_badge.jpeg" },
  // Add other bank options as needed, ensuring they use iconUrl
];

export function AddLiquidity({ isOpen, onClose, onAdd }: AddLiquidityProps) {
  const { language } = useLanguage();
  const t = translations[language as keyof typeof translations] || translations.en;

  const [accountName, setAccountName] = useState('');
  const [accountId, setAccountId] = useState('');
  const [currencyOpen, setCurrencyOpen] = useState(false);
  const [bankOpen, setBankOpen] = useState(false);
  const [selectedCurrency, setSelectedCurrency] = useState<Option | null>(null);
  const [selectedBank, setSelectedBank] = useState<Option | null>(null);
  const modalContentRef = useRef<HTMLDivElement>(null);

  const resetForm = useCallback(() => {
    setAccountName('');
    setAccountId('');
    setSelectedCurrency(null);
    setSelectedBank(null);
    setCurrencyOpen(false);
    setBankOpen(false);
  }, []);

  const internalHandleClose = useCallback(() => {
    resetForm();
    onClose();
  }, [onClose, resetForm]);

  const handleCurrencyOpen = (openState: boolean) => {
    setCurrencyOpen(openState);
    if (openState) {
      setBankOpen(false);
    }
  };

  const handleBankOpen = (openState: boolean) => {
    setBankOpen(openState);
    if (openState) {
      setCurrencyOpen(false);
    }
  };

  const currentBankOptions = useMemo(() => {
    if (selectedCurrency?.value === 'COP') {
      return bankOptions.filter(b => ['Coink', 'Iris', 'Mono', 'Movii'].includes(b.value));
    }
    if (selectedCurrency?.value === 'USDC' || selectedCurrency?.value === 'USDT') {
      return bankOptions.filter(b => ['Binance', 'TrustWallet'].includes(b.value));
    }
    if (selectedCurrency?.value === 'BRL') {
      return bankOptions.filter(b => ['SqualaPay', 'Transfero'].includes(b.value));
    }
    if (selectedCurrency?.value === 'ARS') {
      return bankOptions; // Show all options for ARS or add specific filtering if needed
    }
    return bankOptions;
  }, [selectedCurrency]);

  useEffect(() => {
    if (selectedCurrency) {
      setSelectedBank(null); // Reset bank when currency changes
    }
  }, [selectedCurrency]);

  useEffect(() => {
    if (selectedBank && selectedCurrency) {
      // Reset bank if it's not compatible with the selected currency
      const compatibleBanks = currentBankOptions.map(b => b.value);
      if (!compatibleBanks.includes(selectedBank.value)) {
        setSelectedBank(null);
      }
    }
  }, [selectedBank, selectedCurrency, currentBankOptions]);

  const handleAddClick = () => {
    console.log('handleAddClick called with:', {
      accountName,
      accountId,
      selectedCurrency,
      selectedBank
    });
    if (selectedCurrency && selectedBank && accountName && accountId) {
      console.log('Calling onAdd with data');
      
      // Generate different value ranges based on currency type
      let randomValue: number;
      if (selectedCurrency.value === 'USDC' || selectedCurrency.value === 'USDT') {
        // For USDC/USDT: between 5,000 and 98,000
        randomValue = Math.floor(Math.random() * (98000 - 5000) + 5000);
      } else {
        // For other currencies: between 20,000,000 and 100,000,000
        randomValue = Math.floor(Math.random() * (100000000 - 20000000) + 20000000);
      }
      
      onAdd({
        accountName,
        accountId,
        currency: selectedCurrency,
        bank: selectedBank,
        value: randomValue,
      });
      resetForm(); 
      // If the modal should close after adding, call internalHandleClose() or onClose() directly.
      // Based on the prompt "when the user close the component", adding liquidity itself doesn't trigger this specific close+reset logic.
      // So, only resetting the form here is fine, and the parent can decide to call onClose if needed.
    }
    else {
      console.log('Validation failed - missing required fields');
    }
  };

  const handleAccountIdChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    // Allow numbers and special characters like @, -, *, etc., but not letters
    if (/^[\d@\-*.,;:!#$%&()+={}[\]|\\/?<>~`^_]*$/.test(value)) {
      setAccountId(value);
    }
  };

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (modalContentRef.current && !modalContentRef.current.contains(event.target as Node)) {
        internalHandleClose();
      }
    };

    const handleEscapeKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        internalHandleClose();
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleEscapeKey);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscapeKey);
    };
  }, [isOpen, internalHandleClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 backdrop-blur-xs flex items-center justify-center p-4 z-50" style={{ backgroundColor: 'rgba(110, 110, 110, 0.4)' }}>
      <div ref={modalContentRef} className="bg-white rounded-2xl shadow-xl p-9 w-full max-w-2xl relative"> 
        <button onClick={internalHandleClose} className="absolute top-6 right-6 text-gray-500 hover:text-gray-700"> 
          <X size={36} /> 
        </button>
        <h2 className="text-3xl font-semibold mb-6">{t.addLiquidity}</h2> 

        <div className="grid grid-cols-2 gap-6 mb-6"> 
          <div>
            <label htmlFor="accountName" className="block text-lg font-medium text-gray-700 mb-2">{t.accountName}</label> 
            <input
              type="text"
              id="accountName"
              value={accountName}
              onChange={(e) => setAccountName(e.target.value)}
              className="w-full p-3 text-lg border border-gray-300 rounded-md focus:ring-0 focus:border-gray-300" 
              placeholder={t.accountNamePlaceholder}
            />
          </div>
          <div>
            <label htmlFor="accountId" className="block text-lg font-medium text-gray-700 mb-2">{t.accountId}</label> 
            <input
              type="text"
              id="accountId"
              value={accountId}
              onChange={handleAccountIdChange}
              className="w-full p-3 text-lg border border-gray-300 rounded-md focus:ring-0 focus:border-gray-300" 
              placeholder={t.accountIdPlaceholder}
            />
          </div>
        </div>
        
        <div className="grid grid-cols-2 gap-6 mb-6">
          <div>
            <label className="block text-lg font-medium text-gray-700 mb-2">{t.currency}</label>
            <DropSelector
              options={currencyOptions}
              selectedOption={selectedCurrency}
              onSelectOption={setSelectedCurrency}
              isOpen={currencyOpen}
              setIsOpen={handleCurrencyOpen}
              placeholder={t.selectCurrency}
            />
          </div>
          <div>
            <label className="block text-lg font-medium text-gray-700 mb-2">{t.bankExchange}</label>
            <DropSelector
              options={currentBankOptions}
              selectedOption={selectedBank}
              onSelectOption={setSelectedBank}
              isOpen={bankOpen}
              setIsOpen={handleBankOpen}
              placeholder={t.selectBankExchange}
              disabled={!selectedCurrency}
            />
          </div>
        </div>

        <Button
          onClick={handleAddClick}
          className="w-full text-white text-xl py-3 px-5" 
          disabled={!selectedCurrency || !selectedBank || !accountName || !accountId}
        >
          {t.addLiquidity}
        </Button>
      </div>
    </div>
  );
}
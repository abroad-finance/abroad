import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { X } from 'lucide-react';
import { Button } from '../Button';
import { DropSelector, Option } from '../DropSelector'; // Import Option from DropSelector

interface AddLiquidityProps {
  isOpen: boolean;
  onClose: () => void;
  onAdd: (data: { accountName: string; accountId: string; currency: Option; bank: Option }) => void;
}

const currencyOptions: Option[] = [
  { value: 'COP', label: 'Colombian Peso', icon: <img src="https://hatscripts.github.io/circle-flags/flags/co.svg" alt="COP" className="w-6 h-6 mr-3 inline" /> },
  { value: 'BRL', label: 'Brazilian Real', icon: <img src="https://hatscripts.github.io/circle-flags/flags/br.svg" alt="BRL" className="w-6 h-6 mr-3 inline" /> },
  { value: 'ARS', label: 'Argentinian Peso', icon: <img src="https://hatscripts.github.io/circle-flags/flags/ar.svg" alt="ARS" className="w-6 h-6 mr-3 inline" /> },
];

const bankOptions: Option[] = [
  { value: 'Coink', label: 'Coink', icon: <img src="https://storage.googleapis.com/cdn-abroad/Icons/Banks/coink_badge.png" alt="Coink" className="w-6 h-6 mr-3 inline" /> },
  { value: 'Iris', label: 'Iris', icon: <img src="https://storage.googleapis.com/cdn-abroad/Icons/Banks/iris_badge.webp" alt="Iris" className="w-6 h-6 mr-3 inline" /> },
  { value: 'Mono', label: 'Mono', icon: <img src="https://storage.googleapis.com/cdn-abroad/Icons/Banks/mono_badge.jpg" alt="Mono" className="w-6 h-6 mr-3 inline" /> },
  { value: 'Movii', label: 'Movii', icon: <img src="https://storage.googleapis.com/cdn-abroad/Icons/Banks/movii_badge.png" alt="Movii" className="w-6 h-6 mr-3 inline" /> },
];

export function AddLiquidity({ isOpen, onClose, onAdd }: AddLiquidityProps) {
  const [liquidityType, setLiquidityType] = useState<'cash' | 'crypto' | 'mobile' | null>(null);
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
    setLiquidityType(null);
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
      return bankOptions.filter(b => b.value !== 'Bitso' && b.value !== 'Binance');
    }
    if (selectedCurrency?.value === 'USD') {
      return bankOptions.filter(b => b.value !== 'Nequi' && b.value !== 'DaviPlata');
    }
    return bankOptions;
  }, [selectedCurrency]);

  useEffect(() => {
    if (selectedCurrency) {
      setSelectedBank(null); // Reset bank when currency changes
    }
  }, [selectedCurrency]);

  useEffect(() => {
    if (selectedBank) {
      // If a bank is selected, ensure the currency is compatible or reset currency
      if (selectedBank.value === 'Bitso' || selectedBank.value === 'Binance') {
        if (selectedCurrency?.value === 'COP') setSelectedCurrency(null);
      } else if (selectedBank.value === 'Nequi' || selectedBank.value === 'DaviPlata') {
        if (selectedCurrency?.value === 'USD') setSelectedCurrency(null);
      }
    }
  }, [selectedBank, selectedCurrency]);

  const handleAddClick = () => {
    if (selectedCurrency && selectedBank && accountName && accountId) {
      onAdd({
        accountName,
        accountId,
        currency: selectedCurrency,
        bank: selectedBank,
      });
      resetForm(); 
      // If the modal should close after adding, call internalHandleClose() or onClose() directly.
      // Based on the prompt "when the user close the component", adding liquidity itself doesn't trigger this specific close+reset logic.
      // So, only resetting the form here is fine, and the parent can decide to call onClose if needed.
    }
  };

  const handleAccountIdChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    // Allow only numbers
    if (/^\d*$/.test(value)) {
      setAccountId(value);
    }
  };

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (modalContentRef.current && !modalContentRef.current.contains(event.target as Node)) {
        internalHandleClose();
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen, internalHandleClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 backdrop-blur-xs flex items-center justify-center p-4 z-50" style={{ backgroundColor: 'rgba(110, 110, 110, 0.4)' }}>
      <div ref={modalContentRef} className="bg-white rounded-2xl shadow-xl p-9 w-full max-w-2xl relative"> 
        <button onClick={internalHandleClose} className="absolute top-6 right-6 text-gray-500 hover:text-gray-700"> 
          <X size={36} /> 
        </button>
        <h2 className="text-3xl font-semibold mb-6">Add Liquidity</h2> 

        <div className="mb-6"> 
          <label className="block text-lg font-medium text-gray-700 mb-2">Liquidity Type</label> 
          <div className="flex space-x-3"> 
            {/* ... Liquidity type buttons ... (These would also need scaling if implemented) */}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-6 mb-6"> 
          <div>
            <label htmlFor="accountName" className="block text-lg font-medium text-gray-700 mb-2">Account Name</label> 
            <input
              type="text"
              id="accountName"
              value={accountName}
              onChange={(e) => setAccountName(e.target.value)}
              className="w-full p-3 text-lg border border-gray-300 rounded-md focus:ring-0 focus:border-gray-300" 
              placeholder="e.g., My Savings"
            />
          </div>
          <div>
            <label htmlFor="accountId" className="block text-lg font-medium text-gray-700 mb-2">Account ID</label> 
            <input
              type="text" // Keep as text to allow regex, but pattern enforces numeric
              id="accountId"
              value={accountId}
              onChange={handleAccountIdChange}
              className="w-full p-3 text-lg border border-gray-300 rounded-md focus:ring-0 focus:border-gray-300" 
              placeholder="e.g., 1234567890"
            />
          </div>
        </div>
        
<div className="grid grid-cols-2 gap-6 mb-6"> {/* New row for Currency and Bank/Exchange */}
          <div>
            <label className="block text-lg font-medium text-gray-700 mb-2">Currency</label>
            <DropSelector
              options={currencyOptions}
              selectedOption={selectedCurrency}
              onSelectOption={setSelectedCurrency}
              isOpen={currencyOpen}
              setIsOpen={handleCurrencyOpen}
              placeholder="Select Currency"
            />
          </div>
          <div>
            <label className="block text-lg font-medium text-gray-700 mb-2">Bank/Exchange</label>
            <DropSelector
              options={currentBankOptions}
              selectedOption={selectedBank}
              onSelectOption={setSelectedBank}
              isOpen={bankOpen}
              setIsOpen={handleBankOpen}
              placeholder="Select Bank/Exchange"
              disabled={!selectedCurrency} // Disable if no currency is selected
            />
          </div>
        </div>

        <Button
          onClick={handleAddClick}
          className="w-full text-white text-xl py-3 px-5" 
          disabled={!selectedCurrency || !selectedBank || !accountName || !accountId}
        >
          Add Liquidity
        </Button>
      </div>
    </div>
  );
}
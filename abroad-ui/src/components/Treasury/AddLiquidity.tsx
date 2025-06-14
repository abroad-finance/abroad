import React, { useState, useEffect, useMemo } from 'react';
import { X } from 'lucide-react';
import { Button } from '../ui/button';
import { DropSelector } from '../DropSelector';

// Export the Option interface
export interface Option {
  value: string;
  label: string;
  icon?: React.ReactNode;
  disabled?: boolean;
}

interface AddLiquidityProps {
  isOpen: boolean;
  onClose: () => void;
  onAdd: (data: { accountName: string; accountId: string; currency: Option; bank: Option }) => void;
}

const currencyOptions: Option[] = [
  { value: 'COP', label: 'Colombian Peso', icon: <img src="https://hatscripts.github.io/circle-flags/flags/co.svg" alt="COP" className="w-4 h-4 mr-2 inline" /> },
  { value: 'USD', label: 'US Dollar', icon: <img src="https://hatscripts.github.io/circle-flags/flags/us.svg" alt="USD" className="w-4 h-4 mr-2 inline" /> },
  { value: 'EUR', label: 'Euro', icon: <img src="https://hatscripts.github.io/circle-flags/flags/eu.svg" alt="EUR" className="w-4 h-4 mr-2 inline" /> },
];

const bankOptions: Option[] = [
  { value: 'Nequi', label: 'Nequi', icon: <img src="https://upload.wikimedia.org/wikipedia/commons/thumb/4/4f/Logo_Nequi.svg/1200px-Logo_Nequi.svg.png" alt="Nequi" className="w-4 h-4 mr-2 inline" /> },
  { value: 'DaviPlata', label: 'DaviPlata', icon: <img src="https://www.davivienda.com/wps/wcm/connect/6f3e4a04-4f3f-4a2e-b57d-7e4c7e4f3a4e/logo-daviplata.png" alt="DaviPlata" className="w-4 h-4 mr-2 inline" /> },
  { value: 'Bitso', label: 'Bitso', icon: <img src="https://bitso.com/static/images/bitso-logo.svg" alt="Bitso" className="w-4 h-4 mr-2 inline" /> },
  { value: 'Binance', label: 'Binance', icon: <img src="https://upload.wikimedia.org/wikipedia/en/e/e7/Binance_logo.svg" alt="Binance" className="w-4 h-4 mr-2 inline" /> },
];

export function AddLiquidity({ isOpen, onClose, onAdd }: AddLiquidityProps) {
  const [liquidityType, setLiquidityType] = useState<'cash' | 'crypto' | 'mobile' | null>(null);
  const [accountName, setAccountName] = useState('');
  const [accountId, setAccountId] = useState('');
  const [currencyOpen, setCurrencyOpen] = useState(false);
  const [bankOpen, setBankOpen] = useState(false);
  const [selectedCurrency, setSelectedCurrency] = useState<Option | null>(null);
  const [selectedBank, setSelectedBank] = useState<Option | null>(null);

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
      // Reset form or close modal as per desired behavior after adding
      setAccountName('');
      setAccountId('');
      setSelectedCurrency(null);
      setSelectedBank(null);
      setLiquidityType(null);
      // onClose(); // Optionally call onClose here if the modal should always close
    }
  };

  const handleAccountIdChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    // Allow only numbers
    if (/^\d*$/.test(value)) {
      setAccountId(value);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-md relative">
        <button onClick={onClose} className="absolute top-4 right-4 text-gray-500 hover:text-gray-700">
          <X size={24} />
        </button>
        <h2 className="text-xl font-semibold mb-4">Add Liquidity</h2>

        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-1">Liquidity Type</label>
          <div className="flex space-x-2">
            {/* ... Liquidity type buttons ... */}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 mb-4">
          <div>
            <label htmlFor="accountName" className="block text-sm font-medium text-gray-700 mb-1">Account Name</label>
            <input
              type="text"
              id="accountName"
              value={accountName}
              onChange={(e) => setAccountName(e.target.value)}
              className="w-full p-2 border border-gray-300 rounded-md focus:ring-0 focus:border-gray-300"
              placeholder="e.g., My Savings"
            />
          </div>
          <div>
            <label htmlFor="accountId" className="block text-sm font-medium text-gray-700 mb-1">Account ID</label>
            <input
              type="text" // Keep as text to allow regex, but pattern enforces numeric
              id="accountId"
              value={accountId}
              onChange={handleAccountIdChange}
              className="w-full p-2 border border-gray-300 rounded-md focus:ring-0 focus:border-gray-300"
              placeholder="e.g., 1234567890"
            />
          </div>
        </div>

        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-1">Currency</label>
          <DropSelector
            options={currencyOptions}
            selectedOption={selectedCurrency}
            onSelectOption={setSelectedCurrency}
            isOpen={currencyOpen}
            setIsOpen={setCurrencyOpen}
            placeholder="Select Currency"
          />
        </div>

        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-700 mb-1">Bank/Exchange</label>
          <DropSelector
            options={currentBankOptions}
            selectedOption={selectedBank}
            onSelectOption={setSelectedBank}
            isOpen={bankOpen}
            setIsOpen={setBankOpen}
            placeholder="Select Bank/Exchange"
            disabled={!selectedCurrency} // Disable if no currency is selected
          />
        </div>

        <Button
          onClick={handleAddClick}
          className="w-full bg-blue-600 hover:bg-blue-700 text-white"
          disabled={!selectedCurrency || !selectedBank || !accountName || !accountId}
        >
          Add Liquidity
        </Button>
      </div>
    </div>
  );
}
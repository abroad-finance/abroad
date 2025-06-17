import React, { useState, useEffect, useRef, useCallback } from 'react';
import { X } from 'lucide-react';
import { Button } from '../Button';
import { DropSelector, Option } from '../DropSelector';
import { useLanguage } from '../../contexts/LanguageContext';
import { CardItem } from './LiquidityCards';

const translations = {
  en: {
    sendMoney: "Send Money",
    originAccount: "Origin Account",
    destinationAccount: "Destination Account",
    amount: "Amount",
    selectOriginAccount: "Select Origin Account",
    destinationPlaceholder: "e.g., recipient@bank.com",
    amountPlaceholder: "0.00",
    send: "Send"
  },
  es: {
    sendMoney: "Enviar Dinero",
    originAccount: "Cuenta Origen",
    destinationAccount: "Cuenta Destino",
    amount: "Cantidad",
    selectOriginAccount: "Seleccionar Cuenta Origen",
    destinationPlaceholder: "ej., destinatario@banco.com",
    amountPlaceholder: "0.00",
    send: "Enviar"
  },
  pt: {
    sendMoney: "Enviar Dinheiro",
    originAccount: "Conta de Origem",
    destinationAccount: "Conta de Destino",
    amount: "Quantia",
    selectOriginAccount: "Selecionar Conta de Origem",
    destinationPlaceholder: "ex., destinatario@banco.com",
    amountPlaceholder: "0.00",
    send: "Enviar"
  },
  zh: {
    sendMoney: "发送资金",
    originAccount: "源账户",
    destinationAccount: "目标账户",
    amount: "金额",
    selectOriginAccount: "选择源账户",
    destinationPlaceholder: "例如，recipient@bank.com",
    amountPlaceholder: "0.00",
    send: "发送"
  }
};

interface SendTxProps {
  isOpen: boolean;
  onClose: () => void;
  onSend: (data: { originAccount: CardItem; destinationAccount: string; amount: number }) => void;
  availableAccounts: CardItem[];
}

export function SendTx({ isOpen, onClose, onSend, availableAccounts }: SendTxProps) {
  const { language } = useLanguage();
  const t = translations[language as keyof typeof translations] || translations.en;

  const [destinationAccount, setDestinationAccount] = useState('');
  const [amount, setAmount] = useState('');
  const [originAccountOpen, setOriginAccountOpen] = useState(false);
  const [selectedOriginAccount, setSelectedOriginAccount] = useState<Option | null>(null);
  const modalContentRef = useRef<HTMLDivElement>(null);

  const resetForm = useCallback(() => {
    setDestinationAccount('');
    setAmount('');
    setSelectedOriginAccount(null);
    setOriginAccountOpen(false);
  }, []);

  const internalHandleClose = useCallback(() => {
    resetForm();
    onClose();
  }, [onClose, resetForm]);

  const handleOriginAccountOpen = (openState: boolean) => {
    setOriginAccountOpen(openState);
  };

  // Convert CardItem array to Option array for the dropdown
  const originAccountOptions: Option[] = availableAccounts.map((account, index) => ({
    value: index.toString(),
    label: `${account.accountName} (${account.currency.label})`,
    iconUrl: account.currency.iconUrl
  }));

  const handleSendClick = () => {
    console.log('handleSendClick called with:', {
      selectedOriginAccount,
      destinationAccount,
      amount
    });

    if (selectedOriginAccount && destinationAccount && amount) {
      const originAccountIndex = parseInt(selectedOriginAccount.value);
      const originAccount = availableAccounts[originAccountIndex];
      const amountNumber = parseFloat(amount);

      if (originAccount && !isNaN(amountNumber) && amountNumber > 0) {
        console.log('Calling onSend with data');
        onSend({
          originAccount,
          destinationAccount,
          amount: amountNumber
        });
        resetForm();
      } else {
        console.log('Validation failed - invalid amount or account');
      }
    } else {
      console.log('Validation failed - missing required fields');
    }
  };

  const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    // Allow numbers and decimal point
    if (/^\d*\.?\d*$/.test(value)) {
      setAmount(value);
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
        <h2 className="text-3xl font-semibold mb-6">{t.sendMoney}</h2>

        <div className="mb-6">
          <label className="block text-lg font-medium text-gray-700 mb-2">{t.originAccount}</label>
          <DropSelector
            options={originAccountOptions}
            selectedOption={selectedOriginAccount}
            onSelectOption={setSelectedOriginAccount}
            isOpen={originAccountOpen}
            setIsOpen={handleOriginAccountOpen}
            placeholder={t.selectOriginAccount}
            disabled={originAccountOptions.length === 0}
          />
          {originAccountOptions.length === 0 && (
            <p className="text-sm text-gray-500 mt-1">No accounts available. Please add liquidity first.</p>
          )}
        </div>

        <div className="grid grid-cols-2 gap-6 mb-6">
          <div>
            <label htmlFor="destinationAccount" className="block text-lg font-medium text-gray-700 mb-2">{t.destinationAccount}</label>
            <input
              type="text"
              id="destinationAccount"
              value={destinationAccount}
              onChange={(e) => setDestinationAccount(e.target.value)}
              className="w-full p-3 text-lg border border-gray-300 rounded-md focus:ring-0 focus:border-gray-300"
              placeholder={t.destinationPlaceholder}
            />
          </div>
          <div>
            <label htmlFor="amount" className="block text-lg font-medium text-gray-700 mb-2">{t.amount}</label>
            <input
              type="text"
              id="amount"
              value={amount}
              onChange={handleAmountChange}
              className="w-full p-3 text-lg border border-gray-300 rounded-md focus:ring-0 focus:border-gray-300"
              placeholder={t.amountPlaceholder}
            />
          </div>
        </div>

        <Button
          onClick={handleSendClick}
          className="w-full text-white text-xl py-3 px-5"
          disabled={!selectedOriginAccount || !destinationAccount || !amount || originAccountOptions.length === 0}
        >
          {t.send}
        </Button>
      </div>
    </div>
  );
}

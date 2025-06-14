import React, { useState } from 'react';
import { ArrowUp, ArrowDown, Plus } from 'lucide-react'; // icons for buttons
import { Button } from '../Button'; // Import the Button component
import { AddLiquidity } from './AddLiquidity'; // Import AddLiquidity component
import { useLanguage } from '../../contexts/LanguageContext';

interface BalanceProps {
  balance: number;
  onSend: () => void;
  onReceive: () => void;
}

const translations: Record<'en' | 'es' | 'pt' | 'zh', Record<string, string>> = {
  en: {
    totalBalance: 'Total Balance',
    send: 'Send',
    receive: 'Receive',
    add: 'Add',
  },
  es: {
    totalBalance: 'Saldo Total',
    send: 'Enviar',
    receive: 'Recibir',
    add: 'Agregar',
  },
  pt: {
    totalBalance: 'Saldo Total',
    send: 'Enviar',
    receive: 'Receber',
    add: 'Adicionar',
  },
  zh: {
    totalBalance: '总余额',
    send: '发送',
    receive: '接收',
    add: '添加',
  },
};

export const Balance: React.FC<BalanceProps> = ({ balance, onSend, onReceive }) => {
  const [isAddLiquidityOpen, setAddLiquidityOpen] = useState(false);
  const { language } = useLanguage();

  return (
    <div className="flex items-center justify-between p-4 rounded"> {/* Removed bg-white */}
      {/* display current balance */}
      <div>
        <h4 className="text-md text-gray-500">{translations[language].totalBalance}</h4>
        <p className="text-5xl font-bold text-gray-700">
          {balance.toLocaleString('en-US', { style: 'currency', currency: 'USD' })}
        </p>
      </div>
      {/* action buttons */}
      <div className="flex space-x-2">
        <Button
          onClick={onSend}
          className="flex items-center bg-transparent hover:shadow-md text-gray-500 hover:text-white"
        >
          <ArrowUp className="mr-2" />
          {translations[language].send}
        </Button>
        <Button
          onClick={onReceive}
          className="flex items-center bg-transparent hover:shadow-md text-gray-500 hover:text-white"
        >
          <ArrowDown className="mr-2" />
          {translations[language].receive}
        </Button>
        <Button
          onClick={() => setAddLiquidityOpen(true)}
          className="flex items-center bg-transparent hover:shadow-md text-gray-500 hover:text-white"
        >
          <Plus className="mr-2" />
          {translations[language].add}
        </Button>
      </div>
      {/* AddLiquidity component */}
      <AddLiquidity
        isOpen={isAddLiquidityOpen}
        onClose={() => setAddLiquidityOpen(false)}
        onAdd={(item) => {
          // handle the added liquidity item
          console.log('Liquidity added:', item);
          setAddLiquidityOpen(false);
        }}
      />
    </div>
  );
};
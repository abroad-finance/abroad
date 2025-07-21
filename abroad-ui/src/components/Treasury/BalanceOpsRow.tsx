import React, { useState } from 'react';
import { ArrowUp, ArrowDown, Plus } from 'lucide-react'; // icons for buttons
import { Button } from '../ButtonOutlined'; // Import the Button component
import { AddLiquidity } from './AddLiquidity'; // Import AddLiquidity component
import { SendTx } from './SendTx'; // Import SendTx component
import { useLanguage } from '../../contexts/LanguageContext';
import { Option } from '../DropSelector';

// Define card item type
export interface CardItem {
  accountName: string;
  accountId: string;
  currency: Option;
  bank: Option;
  value: number;
}

interface BalanceProps {
  balance: number;
  onSend: () => void;
  onReceive: () => void;
  onAddLiquidity?: (item: CardItem) => void; // Add callback for liquidity
  availableAccounts?: CardItem[]; // Add available accounts for sending
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

export const Balance: React.FC<BalanceProps> = ({ onSend, onReceive, onAddLiquidity, availableAccounts = [] }) => {
  const [isAddLiquidityOpen, setAddLiquidityOpen] = useState(false);
  const [isSendTxOpen, setSendTxOpen] = useState(false);
  const { language } = useLanguage();

  // Calculate total balance from all liquidity cards
  const totalBalance = availableAccounts.reduce((sum, account) => sum + account.value, 0);

  return (
    <div className="flex items-center justify-between p-4 rounded"> {/* Removed bg-white */}
      {/* display current balance */}
      <div>
        <h4 className="text-md text-gray-500">{translations[language].totalBalance}</h4>
        <p className="text-5xl font-bold text-gray-700">
          {totalBalance.toLocaleString('en-US', { style: 'currency', currency: 'USD' })}
        </p>
      </div>
      {/* action buttons */}
      <div className="flex space-x-2">
        <Button
          onClick={() => setSendTxOpen(true)}
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
          if (onAddLiquidity) {
            onAddLiquidity(item);
          }
          setAddLiquidityOpen(false);
        }}
      />
      {/* SendTx component */}
      <SendTx
        isOpen={isSendTxOpen}
        onClose={() => setSendTxOpen(false)}
        onSend={(data) => {
          // handle the send transaction
          console.log('Send transaction:', data);
          onSend(); // Call the original onSend callback
          setSendTxOpen(false);
        }}
        availableAccounts={availableAccounts}
      />
    </div>
  );
};
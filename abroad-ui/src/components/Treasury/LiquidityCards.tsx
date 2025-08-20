import { BalanceCard } from '../BalanceCard';
import { Option } from '../DropSelector';
import { lazy, Suspense } from 'react';
const IconAnimated = lazy(() => import('../IconAnimated').then(m => ({ default: m.IconAnimated })));
import { useLanguage } from '../../contexts/LanguageContext';
import { AddLiquidity } from './AddLiquidity';
import { useState } from 'react';

const translations = {
  en: {
    connectLiquidityStream: "Connect your first liquidity stream"
  },
  es: {
    connectLiquidityStream: "Conecta tu primer flujo de liquidez"
  },
  pt: {
    connectLiquidityStream: "Conectar seu primeiro fluxo de liquidez"
  },
  zh: {
    connectLiquidityStream: "连接流动性流"
  }
};

// Define card item type
export interface CardItem {
  accountName: string;
  accountId: string;
  currency: Option;
  bank: Option;
  value: number;
}

interface LiquidityCardsProps {
  customCards?: CardItem[];
  onAddLiquidity?: (item: CardItem) => void; // Add callback for when liquidity is added
}

export function LiquidityCards({ customCards = [], onAddLiquidity }: LiquidityCardsProps) {
  const { language } = useLanguage();
  const t = translations[language as keyof typeof translations] || translations.en;
  const [isAddLiquidityOpen, setAddLiquidityOpen] = useState(false);

  // Show placeholder when no cards are available
  if (customCards.length === 0) {
    return (
      <div className="w-full">
        <div 
          className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center cursor-pointer hover:border-gray-400 hover:bg-gray-50 transition-colors"
          onClick={() => setAddLiquidityOpen(true)}
        >
          <div className="flex justify-center mb-4" style={{ pointerEvents: 'none' }}>
            <div style={{ pointerEvents: 'auto' }}>
              <Suspense fallback={null}>
                <IconAnimated icon="PlusCircleHoverSwirl" size={60} trigger="hover"/>
              </Suspense>
            </div>
          </div>
          <p className="text-lg text-gray-500">{t.connectLiquidityStream}</p>
        </div>
        {/* AddLiquidity component */}
        <AddLiquidity
          isOpen={isAddLiquidityOpen}
          onClose={() => setAddLiquidityOpen(false)}
          onAdd={(item) => {
            // Handle the added liquidity item
            console.log('Liquidity added:', item);
            if (onAddLiquidity) {
              onAddLiquidity(item);
            }
            setAddLiquidityOpen(false);
          }}
        />
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {/* Dynamic cards from AddLiquidity */}
      {customCards.map((card, index) => (
        <BalanceCard
          key={`${card.accountId}-${card.currency.value}-${card.bank.value}-${index}`}
          title={card.accountName}
          subtitle={`${card.currency.label} on ${card.bank.label}`}
          value={card.value}
          imageSrc={card.currency.iconUrl}
          overlaySrc={card.bank.iconUrl}
          accountId={card.accountId}
        />
      ))}
    </div>
  );
}
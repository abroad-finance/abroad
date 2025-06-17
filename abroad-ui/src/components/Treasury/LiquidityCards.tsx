import { BalanceCard } from '../BalanceCard';
import { Option } from '../DropSelector';

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
}

export function LiquidityCards({ customCards = [] }: LiquidityCardsProps) {
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
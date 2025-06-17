import React from 'react';
import { getLiquidity } from '../../api';
import { BalanceCard } from '../BalanceCard';
import { Button } from '../Button';
import { AddLiquidity } from './AddLiquidity';
import { Option as AddLiquidityOption } from '../DropSelector';

// Define and export custom card item type
export interface CardItem { // Ensure this is exported as per summary
  accountName: string;
  accountId: string;
  currency: AddLiquidityOption;
  bank: AddLiquidityOption;
  value: number;
}

// Define props for Liquidity component
interface LiquidityProps {
  customCards?: CardItem[];
}

// Remove unused eslint disable
export function Liquidity({ customCards = [] }: LiquidityProps) {
  // state to hold Movii liquidity
  const [moviiLiquidity, setMoviiLiquidity] = React.useState<number>(0);
  // state for custom cards
  const [cards, setCards] = React.useState<CardItem[]>(customCards);
  // Debug: log when cards change
  React.useEffect(() => {
    console.log('Liquidity cards:', cards);
  }, [cards]);
  const [isAddOpen, setIsAddOpen] = React.useState(false);

  React.useEffect(() => {
    const fetchLiquidity = async () => {
      try {
        const response = await getLiquidity({ paymentMethod: 'MOVII' });
        if (response.status === 200) {
          setMoviiLiquidity(response.data.liquidity);
        }
      } catch (err) {
        console.error('Error fetching Movii liquidity:', err);
      }
    };
    fetchLiquidity();
  }, []);

  return (
    <>
      {/* Add Liquidity button and modal */}
      <div className="p-4 flex justify-end">
        <Button onClick={() => setIsAddOpen(true)}>Add Liquidity</Button>
      </div>
      <AddLiquidity
        isOpen={isAddOpen}
        onClose={() => setIsAddOpen(false)}
        onAdd={(data) => {
          console.log('AddLiquidity data received:', data);
          console.log('Current cards before update:', cards);
          setCards(prev => [...prev, data]);
          console.log('Cards after update should be:', [...cards, data]);
          setIsAddOpen(false);
        }}
      />
      <div className="p-4 space-y-4 bg-gray-50">
        <h2 style={{ color: 'green', fontSize: '24px' }}>LIQUIDITY COMPONENT RENDERED</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Simple test div */}
          <div style={{ background: 'yellow', padding: '20px', border: '2px solid red' }}>
            SIMPLE DIV TEST
          </div>
          {/* Test BalanceCard to verify component works */}
          <div style={{ background: 'orange', padding: '20px', border: '2px solid blue' }}>
            BEFORE BALANCE CARD
          </div>
          <BalanceCard
            title="TEST CARD"
            subtitle="Test Subtitle"
            value={50000000}
            imageSrc="https://hatscripts.github.io/circle-flags/flags/co.svg"
            overlaySrc="https://storage.googleapis.com/cdn-abroad/Icons/Banks/coink_badge.png"
            accountId="TEST-123"
          />
          <div style={{ background: 'purple', padding: '20px', border: '2px solid green' }}>
            AFTER BALANCE CARD
          </div>
          <BalanceCard
            title="Colombian Peso"
            subtitle="on Movii"
            value={moviiLiquidity}
            imageSrc="https://vectorflags.s3.amazonaws.com/flags/co-circle-01.png"
            overlaySrc="https://seeklogo.com/images/M/movii-logo-5A0C62B076-seeklogo.com.png"
            accountId='399-9999-027'
          />
          <BalanceCard title="USDC" subtitle='on Stellar' value={2000} imageSrc="https://payload-marketing.moonpay.com/api/media/file/mk1bgycpph-K6MWcviP8ndwcJ5yNIrpI" overlaySrc="https://s2.coinmarketcap.com/static/img/coins/200x200/512.png" accountId='HJJK..12332'/>
          <BalanceCard title="USDC" subtitle='on Solana' value={1000} imageSrc="https://payload-marketing.moonpay.com/api/media/file/mk1bgycpph-K6MWcviP8ndwcJ5yNIrpI" overlaySrc="https://www.chainalysis.com/wp-content/uploads/2022/08/shutterstock-2176242673-scaled-1-1500x970.jpg" accountId='HJJK..12332'/>
          <BalanceCard title="USDT" subtitle='on Tron' value={1000} imageSrc="https://bitcoinp2p.com.br/wp-content/uploads/2024/08/USDT.png" overlaySrc="https://s2.coinmarketcap.com/static/img/coins/200x200/1958.png" accountId='HJJK..12332'/>
          <BalanceCard title="USDT" subtitle='on Tron' value={1000} imageSrc="https://bitcoinp2p.com.br/wp-content/uploads/2024/08/USDT.png" overlaySrc="https://s2.coinmarketcap.com/static/img/coins/200x200/1958.png" accountId='HJJK..12332'/>
         {/* Render custom cards */}
         {/* Render custom cards */}
        <div style={{ color: 'red', fontSize: '20px', fontWeight: 'bold' }}>Cards count: {cards.length}</div>
        <div style={{ color: 'blue', fontSize: '16px' }}>Cards data: {JSON.stringify(cards, null, 2)}</div>
         {cards.map((card, index) => {
           console.log('Rendering card:', card, 'at index:', index);
           return (
             <BalanceCard
               key={`${card.accountId}-${card.currency.value}-${card.bank.value}-${index}`}
               title={card.accountName}
               subtitle={`${card.currency.label} on ${card.bank.label}`}
               value={Math.floor(Math.random() * (100000000 - 20000000) + 20000000)}
               imageSrc={card.currency.iconUrl}
               overlaySrc={card.bank.iconUrl}
               accountId={card.accountId}
             />
           );
         })}
        </div>
      </div>
    </>
  );
}

export default Liquidity;

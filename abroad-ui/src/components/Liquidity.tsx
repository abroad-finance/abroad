import React from 'react';
import { getLiquidity } from '../api';
import { BalanceCard } from './BalanceCard';

export function Liquidity() {
  // state to hold Movii liquidity
  const [moviiLiquidity, setMoviiLiquidity] = React.useState<number>(0);

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
      <div className="p-4 space-y-4 bg-gray-50">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <BalanceCard
            title="Colombian Peso"
            subtitle="on Movii"
            value={moviiLiquidity}
            imageSrc="https://vectorflags.s3.amazonaws.com/flags/co-circle-01.png"
            overlaySrc="https://seeklogo.com/images/M/movii-logo-5A0C62B076-seeklogo.com.png"
            accountId='399-9999-027'
          />
          <BalanceCard title="USDC" subtitle='on Stellar' value={1000} imageSrc="https://payload-marketing.moonpay.com/api/media/file/mk1bgycpph-K6MWcviP8ndwcJ5yNIrpI" overlaySrc="https://s2.coinmarketcap.com/static/img/coins/200x200/512.png" accountId='HJJK..12332'/>
          <BalanceCard title="USDC" subtitle='on Solana' value={1000} imageSrc="https://payload-marketing.moonpay.com/api/media/file/mk1bgycpph-K6MWcviP8ndwcJ5yNIrpI" overlaySrc="https://www.chainalysis.com/wp-content/uploads/2022/08/shutterstock-2176242673-scaled-1-1500x970.jpg" accountId='HJJK..12332'/>
          <BalanceCard title="USDT" subtitle='on Tron' value={1000} imageSrc="https://bitcoinp2p.com.br/wp-content/uploads/2024/08/USDT.png" overlaySrc="https://s2.coinmarketcap.com/static/img/coins/200x200/1958.png" accountId='HJJK..12332'/>
        </div>
      </div>
    );
}

export default Liquidity;

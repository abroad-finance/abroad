import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { useMemo } from 'react';
import { useLanguage } from '../../../contexts/LanguageContext';
import { lazy, Suspense } from 'react';
const IconAnimated = lazy(() => import('../../IconAnimated').then(m => ({ default: m.IconAnimated })));
import { CardItem } from '../LiquidityCards';

const translations = {
  en: {
    transactionVolumes: "Transaction Volumes",
    noTransactionData: "No transaction data available yet",
    addLiquidityToSeeChart: "Add liquidity streams to see transaction volumes",
    last30Days: "Last 30 Days",
    totalVolume: "Total Volume"
  },
  es: {
    transactionVolumes: "Volúmenes de Transacciones",
    noTransactionData: "Aún no hay datos de transacciones disponibles",
    addLiquidityToSeeChart: "Agrega flujos de liquidez para ver los volúmenes",
    last30Days: "Últimos 30 Días",
    totalVolume: "Volumen Total"
  },
  pt: {
    transactionVolumes: "Volumes de Transações",
    noTransactionData: "Nenhum dado de transação disponível",
    addLiquidityToSeeChart: "Adicione fluxos de liquidez para ver os volumes",
    last30Days: "Últimos 30 Dias",
    totalVolume: "Volume Total"
  },
  zh: {
    transactionVolumes: "交易量",
    noTransactionData: "暂无交易数据",
    addLiquidityToSeeChart: "添加流动性流以查看交易量",
    last30Days: "最近30天",
    totalVolume: "总量"
  }
};

interface TransactionalDataProps {
  liquidityCards: CardItem[];
}

// Color palette for the stacked area chart (matching AllocationData)
const COLORS = [
  '#3B82F6', // Blue
  '#10B981', // Green
  '#F59E0B', // Yellow
  '#EF4444', // Red
  '#8B5CF6', // Purple
  '#06B6D4', // Cyan
  '#F97316', // Orange
  '#84CC16', // Lime
  '#EC4899', // Pink
  '#6B7280'  // Gray
];

// Generate deterministic mock transaction data for the last 30 days
const generateMockData = (liquidityCards: CardItem[]) => {
  const data = [];
  const today = new Date();
  
  // Seed for consistent "random" values
  const seededRandom = (seed: number) => {
    const x = Math.sin(seed) * 10000;
    return x - Math.floor(x);
  };
  
  for (let i = 29; i >= 0; i--) {
    const date = new Date(today);
    date.setDate(date.getDate() - i);
    
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dayData: any = {
      date: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      fullDate: date.toISOString().split('T')[0]
    };
    
    // Generate mock transaction volumes for each liquidity card
    liquidityCards.forEach((card, cardIndex) => {
      const currency = card.currency.value;
      
      // Different base volumes for different currencies
      const baseVolume = currency === 'COP' ? 50000000 : 
                         currency === 'BRL' ? 25000000 :
                         currency === 'ARS' ? 30000000 :
                         100000; // USDC/USDT
      
      // Create attractive patterns with deterministic "randomness"
      const dayOfYear = Math.floor((date.getTime() - new Date(date.getFullYear(), 0, 0).getTime()) / 86400000);
      
      // Use card-specific seed including account ID hash for uniqueness
      const accountHash = card.accountId.split('').reduce((a, b) => {
        a = ((a << 5) - a) + b.charCodeAt(0);
        return a & a;
      }, 0);
      const bankHash = card.bank.value.split('').reduce((a, b) => {
        a = ((a << 5) - a) + b.charCodeAt(0);
        return a & a;
      }, 0);
      
      const seed = dayOfYear * 100 + cardIndex + Math.abs(accountHash) + Math.abs(bankHash);
      
      // Weekly patterns - lower on weekends
      const weekdayMultiplier = date.getDay() === 0 || date.getDay() === 6 ? 0.3 : 1;
      
      // Create wave patterns for more attractive visuals (different for each card)
      const wavePattern = 0.7 + 0.4 * Math.sin((dayOfYear + cardIndex * 15 + Math.abs(bankHash) * 0.1) * 0.15);
      
      // Add some deterministic variation
      const randomFactor = 0.6 + 0.8 * seededRandom(seed);
      
      // Create different trending patterns based on card characteristics
      const trendFactor = (cardIndex + Math.abs(accountHash)) % 3 === 0 
        ? 1 + (i * 0.015) // Strong upward trend
        : (cardIndex + Math.abs(accountHash)) % 3 === 1
        ? 1 + (i * 0.005) // Slight upward trend
        : 1 - (i * 0.008); // Slight downward trend
      
      // Create unique key for each card
      const cardKey = `${currency}_${card.bank.value}_${card.accountId}`;
      
      dayData[cardKey] = Math.floor(
        baseVolume * weekdayMultiplier * wavePattern * randomFactor * trendFactor
      );
    });
    
    data.push(dayData);
  }
  
  return data;
};

export function TransactionalData({ liquidityCards }: TransactionalDataProps) {
  const { language } = useLanguage();
  const t = translations[language as keyof typeof translations] || translations.en;

  // Generate mock transaction data only when liquidity cards change
  const chartData = useMemo(() => {
    return generateMockData(liquidityCards);
  }, [liquidityCards]); // Only regenerate when liquidity cards change
  
  // Calculate total volumes for each liquidity card
  const totalVolumes = liquidityCards.map((card, index) => {
    const cardKey = `${card.currency.value}_${card.bank.value}_${card.accountId}`;
    const total = chartData.reduce((sum, day) => sum + (day[cardKey] || 0), 0);
    return {
      cardKey,
      currency: card.currency.value,
      total,
      color: COLORS[index % COLORS.length],
      label: `${card.accountName} (${card.currency.label})`,
      bankLabel: card.bank.label
    };
  });

  const grandTotal = totalVolumes.reduce((sum, item) => sum + item.total, 0);

  // Custom tooltip formatter
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const CustomTooltip = ({ active, payload, label }: { active?: boolean; payload?: any[]; label?: string }) => {
    if (active && payload && payload.length) {
      const total = payload.reduce((sum, item) => sum + (item.value || 0), 0);
      
      return (
        <div className="bg-white p-3 border border-gray-200 rounded-lg shadow-lg">
          <p className="font-semibold mb-2">{label}</p>
          {payload.map((item, index) => {
            // Find the corresponding card for this data key
            const cardKey = item.dataKey;
            const card = liquidityCards.find(c => 
              `${c.currency.value}_${c.bank.value}_${c.accountId}` === cardKey
            );
            const displayName = card ? `${card.accountName} (${card.currency.label})` : item.dataKey;
            
            return (
              <div key={index} className="flex items-center justify-between space-x-4">
                <div className="flex items-center space-x-2">
                  <div 
                    className="w-3 h-3 rounded-full"
                    style={{ backgroundColor: item.color }}
                  />
                  <span className="text-sm">{displayName}</span>
                </div>
                <span className="text-sm font-medium">${item.value?.toLocaleString()}</span>
              </div>
            );
          })}
          <div className="border-t border-gray-200 mt-2 pt-2">
            <div className="flex justify-between items-center font-semibold">
              <span className="text-sm">Total:</span>
              <span className="text-sm">${total.toLocaleString()}</span>
            </div>
          </div>
        </div>
      );
    }
    return null;
  };

  // Show placeholder when no liquidity data is available
  if (liquidityCards.length === 0) {
    return (
      <div className="bg-white rounded-xl p-6">
        <h3 className="text-xl font-semibold text-gray-800 mb-4">{t.transactionVolumes}</h3>
        <div className="flex flex-col items-center justify-center py-12">
          <div className="mb-4">
            <Suspense fallback={null}>
              <IconAnimated icon="BarChartInReveal" size={80} trigger="once" />
            </Suspense>
          </div>
          <h4 className="text-lg font-medium text-gray-600 mb-2">{t.noTransactionData}</h4>
          <p className="text-gray-500 text-center">{t.addLiquidityToSeeChart}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl p-6">
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-xl font-semibold text-gray-800">{t.transactionVolumes}</h3>
        <span className="text-sm text-gray-500">{t.last30Days}</span>
      </div>
      
      <div className="h-80 mb-4">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis 
              dataKey="date" 
              axisLine={false}
              tickLine={false}
              tick={{ fontSize: 12, fill: '#6b7280' }}
            />
            <YAxis 
              axisLine={false}
              tickLine={false}
              tick={{ fontSize: 12, fill: '#6b7280' }}
              tickFormatter={(value) => `$${(value / 1000000).toFixed(1)}M`}
            />
            <Tooltip content={<CustomTooltip />} />
            {liquidityCards.map((card, index) => {
              const cardKey = `${card.currency.value}_${card.bank.value}_${card.accountId}`;
              return (
                <Area
                  key={cardKey}
                  type="monotone"
                  dataKey={cardKey}
                  stackId="1"
                  stroke={COLORS[index % COLORS.length]}
                  fill={COLORS[index % COLORS.length]}
                  fillOpacity={0.6}
                  strokeWidth={2}
                />
              );
            })}
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Legend and totals */}
      <div className="mt-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm mb-4">
          {totalVolumes.map((item, index) => (
            <div key={index} className="flex items-center justify-between space-x-2 p-2 bg-gray-50 rounded">
              <div className="flex items-center space-x-2">
                <div 
                  className="w-3 h-3 rounded-full flex-shrink-0"
                  style={{ backgroundColor: item.color }}
                />
                <span className="text-gray-700 font-medium">{item.label}</span>
              </div>
              <span className="text-gray-600 font-medium">
                ${item.total.toLocaleString()}
              </span>
            </div>
          ))}
        </div>
        
        <div className="pt-3 border-t border-gray-200">
          <div className="flex justify-between items-center font-semibold">
            <span>{t.totalVolume}:</span>
            <span>${grandTotal.toLocaleString()}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
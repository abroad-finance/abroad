import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import { useLanguage } from '../../../contexts/LanguageContext';
import { lazy, Suspense } from 'react';
const IconAnimated = lazy(() => import('../../IconAnimated').then(m => ({ default: m.IconAnimated })));
import { CardItem } from '../LiquidityCards';

const translations = {
  en: {
    liquidityAllocation: "Liquidity Allocation",
    noLiquidityData: "No liquidity data available yet",
    addLiquidityToSeeChart: "Add liquidity streams to see allocation chart",
    total: "Total"
  },
  es: {
    liquidityAllocation: "Asignación de Liquidez",
    noLiquidityData: "Aún hay datos de liquidez disponibles",
    addLiquidityToSeeChart: "Agrega flujos de liquidez para ver el gráfico",
    total: "Total"
  },
  pt: {
    liquidityAllocation: "Alocação de Liquidez",
    noLiquidityData: "Nenhum dado de liquidez disponível",
    addLiquidityToSeeChart: "Adicione fluxos de liquidez para ver o gráfico de alocação",
    total: "Total"
  },
  zh: {
    liquidityAllocation: "流动性分配",
    noLiquidityData: "没有可用的流动性数据",
    addLiquidityToSeeChart: "添加流动性流以查看分配图表",
    total: "总计"
  }
};

interface StreamDataProps {
  liquidityCards: CardItem[];
}

// Color palette for the pie chart
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

export function StreamData({ liquidityCards }: StreamDataProps) {
  const { language } = useLanguage();
  const t = translations[language as keyof typeof translations] || translations.en;

  // Transform liquidity cards data for the pie chart
  const chartData = liquidityCards.map((card, index) => ({
    name: `${card.currency.label} (${card.bank.label})`,
    value: card.value,
    currency: card.currency.label,
    bank: card.bank.label,
    accountName: card.accountName,
    color: COLORS[index % COLORS.length]
  }));

  const totalValue = chartData.reduce((sum, item) => sum + item.value, 0);

  // Custom tooltip formatter
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const CustomTooltip = ({ active, payload }: { active?: boolean; payload?: any[] }) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      return (
        <div className="bg-white p-3 border border-gray-200 rounded-lg shadow-lg">
          <p className="font-semibold">{data.accountName}</p>
          <p className="text-sm text-gray-600">{data.name}</p>
          <p className="text-sm font-medium">${data.value.toLocaleString()}</p>
          <p className="text-xs text-gray-500">
            {((data.value / totalValue) * 100).toFixed(1)}%
          </p>
        </div>
      );
    }
    return null;
  };

  // Custom legend component
  const CustomLegend = () => {
    return (
      <div className="mt-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
          {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
          {chartData.map((item: any, index: number) => (
            <div key={index} className="flex items-center space-x-2">
              <div 
                className="w-3 h-3 rounded-full flex-shrink-0"
                style={{ backgroundColor: item.color }}
              />
              <span className="text-gray-700 truncate">
                {item.accountName}
              </span>
              <span className="text-gray-500 ml-auto">
                ${item.value.toLocaleString()}
              </span>
            </div>
          ))}
        </div>
        <div className="mt-3 pt-3 border-t border-gray-200">
          <div className="flex justify-between items-center font-semibold">
            <span>{t.total}:</span>
            <span>${totalValue.toLocaleString()}</span>
          </div>
        </div>
      </div>
    );
  };

  // Show placeholder when no liquidity data is available
  if (liquidityCards.length === 0) {
    return (
      <div className="bg-white rounded-xl p-6">
        <h3 className="text-xl font-semibold text-gray-800 mb-4">{t.liquidityAllocation}</h3>
        <div className="flex flex-col items-center justify-center py-12">
          <div className="mb-4">
            <Suspense fallback={null}>
              <IconAnimated icon="SphereInReveal" size={80} trigger="once" />
            </Suspense>
          </div>
          <h4 className="text-lg font-medium text-gray-600 mb-2">{t.noLiquidityData}</h4>
          <p className="text-gray-500 text-center">{t.addLiquidityToSeeChart}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl p-6">
      <h3 className="text-xl font-semibold text-gray-800 mb-4">{t.liquidityAllocation}</h3>
      
      <div className="h-80">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={chartData}
              cx="50%"
              cy="50%"
              labelLine={false}
              outerRadius={80}
              fill="#8884d8"
              dataKey="value"
            >
              {chartData.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={entry.color} />
              ))}
            </Pie>
            <Tooltip content={<CustomTooltip />} />
          </PieChart>
        </ResponsiveContainer>
      </div>

      <CustomLegend />
    </div>
  );
}

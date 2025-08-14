import React from 'react';
import { useLanguage } from '../contexts/LanguageContext';
import Navbar from '../components/Navbar';
import { InfoCard } from '../components/InfoCard';

// Translation strings
const poolTranslations: Record<string, { earn: string; onAssets: string; comingSoon: string }> = {
  en: { earn: 'Earn an average of', onAssets: 'on your assets', comingSoon: 'Coming soon' },
  es: { earn: 'Gana un promedio de', onAssets: 'en tus activos', comingSoon: 'Próximamente' },
  pt: { earn: 'Ganhe em média', onAssets: 'em seus ativos', comingSoon: 'Em breve' },
  zh: { earn: '赚取平均', onAssets: '您的资产', comingSoon: '敬请期待' },
};

// InfoCard title translations
const poolInfoCardTitles: Record<string, { card1: string; card2: string; card3: string }> = {
  en: {
    card1: 'Liquidity pools designed to match institutional standards',
    card2: 'Provide liquidity and make profit',
    card3: 'Speed and safety natively integrated',
  },
  es: {
    card1: 'Pools de liquidez diseñadas para cumplir con estándares institucionales',
    card2: 'Proporciona liquidez y obtén ganancias*',
    card3: 'Velocidad y seguridad integradas nativamente',
  },
  pt: {
    card1: 'Pools de liquidez projetados para atender padrões institucionais',
    card2: 'Forneça liquidez e obtenha lucros*',
    card3: 'Velocidade e segurança integradas nativamente',
  },
  zh: {
    card1: '为符合机构标准而设计的流动性池',
    card2: '提供流动性并赚取利润*',
    card3: '原生集成的速度和安全性',
  },
};

function Pool() {
  const [activeSection, setActiveSection] = React.useState<string>('pool');
  const { language } = useLanguage();
  const t = poolTranslations[language] || poolTranslations.en;
  const infoTitles = poolInfoCardTitles[language] || poolInfoCardTitles.en;

  return (
    <div className="min-h-screen flex flex-col p-4 space-y-4 bg-gray-50">
      <Navbar activeSection={activeSection} setActiveSection={setActiveSection} />

      {/* Info cards grid */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <InfoCard
          title={infoTitles.card1}
          background='https://static.vecteezy.com/system/resources/previews/026/493/927/non_2x/abstract-gradient-dark-green-liquid-wave-background-free-vector.jpg'
          imageSrc='https://storage.cloud.google.com/cdn-abroad/Icons/Liquidity%20Dashboard/institution-3d.png'
        />
        <InfoCard
          title={infoTitles.card2}
          background='https://static.vecteezy.com/system/resources/previews/026/493/927/non_2x/abstract-gradient-dark-green-liquid-wave-background-free-vector.jpg'
          imageSrc='https://storage.cloud.google.com/cdn-abroad/Icons/Liquidity%20Dashboard/colombian-peso-token.webp'
        />
        <InfoCard
          title={infoTitles.card3}
          background='https://static.vecteezy.com/system/resources/previews/026/493/927/non_2x/abstract-gradient-dark-green-liquid-wave-background-free-vector.jpg'
          imageSrc='https://storage.cloud.google.com/cdn-abroad/Icons/Liquidity%20Dashboard/vault-3d.png'
        />
      </div>
      {/* Full-page background card */}
      <div className="flex-grow rounded-lg shadow-md relative overflow-hidden flex items-center justify-center">
        {/* Blurred background image */}
        <div
          className="absolute inset-0 bg-cover bg-center"
          style={{
            backgroundImage: `linear-gradient(rgba(0,0,0,0.5), rgba(0,0,0,0.3)), url('https://storage.cloud.google.com/cdn-abroad/pool_graphic.webp')`,
            filter: 'blur(1.8px)',
          }}
        />
        {/* Black overlay at 50% opacity */}
        <div className="absolute inset-0 bg-black opacity-50" />
        {/* Content on top of overlays */}
        <div className="relative z-10 p-6 text-white text-center">
          <p className="text-3xl font-bold">{t.earn}</p>
          <p className="text-8xl font-bold leading-none">8.12%</p>
          <p className="text-3xl font-bold">{t.onAssets}</p>
          <button className="mt-4 px-4 py-2 rounded-full border border-white text-white bg-transparent">
            {t.comingSoon}
          </button>
        </div>
      </div>
    </div>
  );
}

export default Pool;
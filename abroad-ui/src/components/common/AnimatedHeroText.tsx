import React, { useState, useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { CURRENCIES, ASSET_URLS } from '../../features/swap/webSwap.constants';

const AnimatedHeroText: React.FC = () => {
  const [currentIndex, setCurrentIndex] = useState(0);

  useEffect(() => {
    const intervalId = setInterval(() => {
      setCurrentIndex((prev) => (prev + 1) % CURRENCIES.length);
    }, 3000);
    return () => clearInterval(intervalId);
  }, []);

  const currency = CURRENCIES[currentIndex];

  return (
    <div className="font-bold text-white text-shadow-lg leading-tight">
      {/* Mobile/Tablet Layout - 4 lines (< 1200px) */}
      <div className="xl:hidden text-5xl md:text-6xl">
        <div className="mb-2">
          <span>Cambia</span>
        </div>
        <div className="flex items-center gap-4 mb-2">
          <img src={ASSET_URLS.USDC_TOKEN_ICON} alt="USDC Token" className="h-14 w-14 md:h-16 md:w-16" />
          <span>Stablecoins</span>
        </div>
        <div className="flex items-center gap-2 mb-2">
          <span>a</span>
          <AnimatePresence mode="wait">
            <motion.div
              key={currency.name}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.5, ease: 'easeInOut' }}
              className="flex items-center gap-2"
            >
              <img
                src={`https://hatscripts.github.io/circle-flags/flags/${currency.flag}.svg`}
                alt={`${currency.name} flag`}
                className="h-14 w-14 md:h-16 md:w-16 rounded-full flex-shrink-0"
              />
              <span className="whitespace-nowrap">{currency.name}</span>
            </motion.div>
          </AnimatePresence>
        </div>
        <div>
          <span>en segundos</span>
        </div>
      </div>

      {/* Desktop Layout - 2 lines (>= 1200px) */}
      <div className="hidden xl:block">
        <div className="flex items-center gap-4 mb-2">
          <span>Cambia</span>
          <img src={ASSET_URLS.USDC_TOKEN_ICON} alt="USDC Token" className="h-10 w-10 md:h-14 md:w-14" />
          <span>Stablecoins</span>
        </div>
        <div className="flex items-center gap-2">
          <span>a</span>
          <AnimatePresence mode="wait">
            <motion.div
              key={currency.name}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.5, ease: 'easeInOut' }}
              className="flex items-center gap-2"
            >
              <img
                src={`https://hatscripts.github.io/circle-flags/flags/${currency.flag}.svg`}
                alt={`${currency.name} flag`}
                className="h-10 w-10 md:h-14 md:w-14 rounded-full flex-shrink-0"
              />
              <span className="whitespace-nowrap">{currency.name}</span>
            </motion.div>
          </AnimatePresence>
          <span className="whitespace-nowrap">en segundos</span>
        </div>
      </div>
    </div>
  );
};

export default AnimatedHeroText;
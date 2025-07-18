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
      <div className="flex items-center gap-4">
        <span>From</span>
        <img src={ASSET_URLS.USDC_TOKEN_ICON} alt="USDC Token" className="h-10 w-10 md:h-14 md:w-14" />
        <span>Stablecoins</span>
      </div>
      <div className="flex items-center gap-4 mt-2">
        <span>to</span>
        <AnimatePresence mode="wait">
          <motion.div
            key={currency.name}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.5, ease: 'easeInOut' }}
            className="flex items-center gap-4"
          >
            <img
              src={`https://hatscripts.github.io/circle-flags/flags/${currency.flag}.svg`}
              alt={`${currency.name} flag`}
              className="h-10 w-10 md:h-14 md:w-14 rounded-full"
            />
            <span>{currency.name}</span>
          </motion.div>
        </AnimatePresence>
        <span>in seconds</span>
      </div>
    </div>
  );
};

export default AnimatedHeroText;
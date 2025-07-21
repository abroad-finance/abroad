import { useState, useEffect } from 'react';
import { useLanguage } from '../../contexts/LanguageContext';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '../../components/Button';

type Language = 'en' | 'es' | 'pt' | 'zh';
// Translations for slogans and terms
const translations: Record<Language, { sloganStart: string; sloganEnd: string; acceptTerms: string; acceptButton: string }> = {
  en: { sloganStart: 'Stablecoins to', sloganEnd: 'in seconds', acceptTerms: 'I accept the Terms & Conditions', acceptButton: 'Continue' },
  es: { sloganStart: 'Envía stablecoins a', sloganEnd: 'en segundos', acceptTerms: 'Acepto los Términos y Condiciones', acceptButton: 'Continuar' },
  pt: { sloganStart: 'De stablecoins para', sloganEnd: 'em segundos', acceptTerms: 'Aceito os Termos e Condições', acceptButton: 'Continuar' },
  zh: { sloganStart: '从稳定币到', sloganEnd: '几秒到账，不再等待。', acceptTerms: '我接受条款和条件', acceptButton: '继续' },
};

export default function Splash() {
  const { language } = useLanguage();
  const t = translations[language] || translations.en;
  const [accepted, setAccepted] = useState(false);
  // Animated rotating destination texts per language
  const destinationTranslations: Record<Language, string[]> = {
    en: ["Brazilian Reals", "Peruvian Soles", "Colombian Pesos"],
    es: ["🇧🇷 Reales", "🇵🇪 Soles", "🇨🇴 Pesos"],
    pt: ["🇧🇷 Reais", "🇵🇪 Soles", "🇨🇴 Pesos"],
    zh: ["🇧🇷 雷亚尔", "🇵🇪 索尔", "🇨🇴 佩索"],
  };
  const texts = destinationTranslations[language] || destinationTranslations.en;
  // Animated rotating destinations text
  const [index, setIndex] = useState(0);
  useEffect(() => {
    const iv = setInterval(() => setIndex(i => (i + 1) % texts.length), 2000);
    return () => clearInterval(iv);
  }, [texts.length]);
  const AnimatedDestinations = () => (
    <AnimatePresence mode="wait">
      <motion.span
        key={index}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -10 }}
        transition={{ duration: 0.5 }}
        className="inline-block font-semibold mx-1 whitespace-nowrap"
      >
        {texts[index]}
      </motion.span>
    </AnimatePresence>
  );

  return (
    <div className="min-h-screen flex flex-col items-center p-4 bg-green-50 relative">
      {/* Video background */}
      <video
        className="absolute inset-0 w-full h-full object-cover z-0"
        playsInline
        autoPlay
        muted
        loop
        preload="auto"
      >
        <source
          src="https://videos.pexels.com/video-files/32156428/13711041_1440_2560_50fps.mp4"
          type="video/mp4"
        />
      </video>
      {/* Content wrapper above video */}
      <div className="relative z-20 flex flex-col justify-between items-center w-full flex-1">
        {/* Logo */}
        <img
          src="https://cdn.prod.website-files.com/66d73974e0b6f2e9c06130a7/67bdb92323f0bb399db3754c_abroad-logo.svg"
          alt="Abroad Logo"
          className="h-12 mt-12 mb-6"
        />
        {/* Slogan */}
        <div className="w-full flex flex-col items-center -mt-4">
          <div className="text-5xl font-bold mb-8 text-white">
          {t.sloganStart} <AnimatedDestinations />
          <br /> {t.sloganEnd}
        </div>
        {/* Bottom group: Terms, checkbox, and button */}
          <label className="flex items-center mb-4 text-sm text-gray-400">
            <input
              type="checkbox"
              className={`form-checkbox h-5 w-5 mr-2 ${!accepted ? 'border border-gray-400 bg-transparent' : ''}`}
              checked={accepted}
              onChange={() => setAccepted(a => !a)}
            />
            {t.acceptTerms}
          </label>
          <Button
            disabled={!accepted}
            className={`w-full ${
              accepted
                ? 'bg-gradient-to-r from-[#356E6A] to-[#73B9A3] hover:from-[#2a5956] hover:to-[#5fa88d]' 
                : ''
            }`}
          >
            {t.acceptButton}
          </Button>
        </div>
      </div>
    </div>
  );
}

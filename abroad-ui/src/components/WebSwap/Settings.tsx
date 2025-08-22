import React, { useState } from 'react';
import { X } from 'lucide-react';
import { motion } from 'framer-motion';

interface SettingsProps {
  onClose?: () => void;
}

interface Language {
  code: string;
  name: string;
  flag: string;
}

const LANGUAGES: Language[] = [
  { code: 'es', name: 'Español', flag: 'es' },
  { code: 'pt', name: 'Português', flag: 'br' },
  { code: 'en', name: 'English', flag: 'us' },
  { code: 'ru', name: 'Русский', flag: 'ru' },
  { code: 'ar', name: 'العربية', flag: 'sa' },
  { code: 'zh', name: '中文', flag: 'cn' },
];

const Settings: React.FC<SettingsProps> = ({ onClose }) => {
  const [selectedLanguage, setSelectedLanguage] = useState<string>('es'); // Default to Spanish

  const handleLanguageSelect = (languageCode: string) => {
    setSelectedLanguage(languageCode);
    // TODO: Implement language change logic here
    console.log('Language selected:', languageCode);
    onClose?.();
  };

  return (
    <motion.div 
      className="w-screen md:w-auto md:mx-0 md:ml-auto md:max-w-md h-[80vh] md:h-[95vh]"
      initial={{ 
        x: typeof window !== 'undefined' && window.innerWidth >= 768 ? '100%' : 0,
        y: typeof window !== 'undefined' && window.innerWidth >= 768 ? 0 : '100%',
        opacity: 1 
      }}
      animate={{ x: 0, y: 0, opacity: 1 }}
      exit={{ 
        x: typeof window !== 'undefined' && window.innerWidth >= 768 ? '100%' : 0,
        y: typeof window !== 'undefined' && window.innerWidth >= 768 ? 0 : '100%',
        opacity: typeof window !== 'undefined' && window.innerWidth >= 768 ? 1 : 0 
      }}
      transition={{ 
        type: 'spring',
        stiffness: 300,
        damping: 30,
        mass: 0.8
      }}
    >
      <div className="bg-white rounded-t-4xl md:rounded-4xl shadow-lg border border-gray-200 p-3 relative w-full h-full md:h-full flex flex-col overflow-y-auto">
        {/* Close Button */}
        {onClose && (
          <button
            onClick={onClose}
            className="absolute top-4 right-4 p-1 rounded-full hover:bg-gray-100 transition-colors duration-200 cursor-pointer z-10"
          >
            <X className="w-5 h-5 text-gray-400 hover:text-gray-600" />
          </button>
        )}

        {/* Header */}
        <div className="mb-6 pr-8 text-center mt-2 md:mt-4">
          <h2 className="text-2xl font-semibold text-gray-900 mb-2">
            Configuración de Idioma
          </h2>
          <p className="text-md text-gray-600">
            Selecciona tu idioma preferido para la interfaz
          </p>
        </div>

        {/* Language Options */}
        <div className="flex-1">
          <div className="space-y-3">
            {LANGUAGES.map((language) => (
              <button
                key={language.code}
                onClick={() => handleLanguageSelect(language.code)}
                className={`w-full flex items-center justify-between p-4 rounded-xl border transition-all duration-200 hover:bg-gray-50 ${
                  selectedLanguage === language.code
                    ? 'border-blue-500 bg-blue-50'
                    : 'border-gray-200 bg-white'
                }`}
              >
                <div className="flex items-center space-x-4">
                  <img
                    src={`https://hatscripts.github.io/circle-flags/flags/${language.flag}.svg`}
                    alt={`${language.name} flag`}
                    className="w-6 h-6 rounded-full flex-shrink-0"
                  />
                  <span className="text-gray-800 font-medium text-lg">
                    {language.name}
                  </span>
                </div>
                
                {/* Selection indicator */}
                <div className={`w-5 h-5 rounded-full border-2 transition-all duration-200 ${
                  selectedLanguage === language.code
                    ? 'border-blue-500 bg-blue-500'
                    : 'border-gray-300'
                }`}>
                  {selectedLanguage === language.code && (
                    <div className="w-full h-full flex items-center justify-center">
                      <div className="w-2 h-2 bg-white rounded-full"></div>
                    </div>
                  )}
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="text-xs text-gray-500 leading-relaxed text-center mt-6 pt-4 border-t border-gray-200">
          Los cambios de idioma se aplicarán inmediatamente
        </div>
      </div>
    </motion.div>
  );
};

export default Settings;

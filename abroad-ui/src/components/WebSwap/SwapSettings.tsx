import React, { useState } from 'react';
import { ChevronDown, X } from 'lucide-react';

interface Language {
  code: string;
  name: string;
  flag: string;
}

const languages: Language[] = [
  { code: 'en', name: 'English', flag: 'us' },
  { code: 'es', name: 'Español', flag: 'es' },
  { code: 'pt', name: 'Português', flag: 'br' },
];

interface SwapSettingsProps {
  selectedLanguage?: string;
  onLanguageChange?: (language: string) => void;
  onClose?: () => void;
  className?: string;
}

const SwapSettings: React.FC<SwapSettingsProps> = ({ 
  selectedLanguage = 'en', 
  onLanguageChange,
  onClose,
  className = ''
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [currentLanguage, setCurrentLanguage] = useState(selectedLanguage);

  const selectedLang = languages.find(lang => lang.code === currentLanguage) || languages[0];

  const handleLanguageSelect = (languageCode: string) => {
    setCurrentLanguage(languageCode);
    onLanguageChange?.(languageCode);
    setIsOpen(false);
  };

  const handleComponentClick = (e: React.MouseEvent) => {
    // Prevent modal from closing when clicking inside the component
    e.stopPropagation();
  };

  const handleCloseClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onClose?.();
  };

  return (
    <div className={`relative ${className}`} onClick={handleComponentClick}>
      <div className="bg-white/10 backdrop-blur-md rounded-2xl p-4 border border-white/20">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-white font-semibold text-sm">Language / Idioma</h3>
          {onClose && (
            <button
              onClick={handleCloseClick}
              className="p-1 rounded-full hover:bg-white/20 transition-colors"
            >
              <X className="w-4 h-4 text-white" />
            </button>
          )}
        </div>
        
        <div className="relative">
          <button
            onClick={() => setIsOpen(!isOpen)}
            className="w-full bg-white/20 backdrop-blur-sm rounded-xl p-3 flex items-center justify-between hover:bg-white/30 transition-colors"
          >
            <div className="flex items-center space-x-3">
              <img
                src={`https://hatscripts.github.io/circle-flags/flags/${selectedLang.flag}.svg`}
                alt={`${selectedLang.name} flag`}
                className="w-6 h-6 rounded-full"
              />
              <span className="text-white font-medium">{selectedLang.name}</span>
            </div>
            <ChevronDown 
              className={`w-5 h-5 text-white transition-transform ${isOpen ? 'rotate-180' : ''}`} 
            />
          </button>

          {isOpen && (
            <div 
              data-dropdown="language-dropdown"
              className="absolute top-full left-0 right-0 mt-2 bg-white/95 backdrop-blur-md rounded-xl border border-white/20 shadow-lg z-50"
            >
              {languages.map((language) => (
                <button
                  key={language.code}
                  onClick={() => handleLanguageSelect(language.code)}
                  className={`w-full p-3 flex items-center space-x-3 hover:bg-gray-100 transition-colors first:rounded-t-xl last:rounded-b-xl ${
                    language.code === currentLanguage ? 'bg-gray-100' : ''
                  }`}
                >
                  <img
                    src={`https://hatscripts.github.io/circle-flags/flags/${language.flag}.svg`}
                    alt={`${language.name} flag`}
                    className="w-6 h-6 rounded-full"
                  />
                  <span className="text-gray-800 font-medium">{language.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Overlay to close dropdown when clicking outside */}
      {isOpen && (
        <div 
          className="fixed inset-0 z-40" 
          onClick={() => setIsOpen(false)}
        />
      )}
    </div>
  );
};

export default SwapSettings;

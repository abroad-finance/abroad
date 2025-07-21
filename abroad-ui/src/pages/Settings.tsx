import React from "react";
import { useLanguage } from "../contexts/LanguageContext";
import Navbar from "../components/Navbar";
import { Listbox } from '@headlessui/react';
import { getPartnerInfo, PartnerInfoResponse } from "../api";

export function Settings() {
  const [activeSection, setActiveSection] = React.useState<string>("settings");
  const { language, setLanguage } = useLanguage();
  const [partner, setPartner] = React.useState<PartnerInfoResponse | null>(null);

  React.useEffect(() => {
    const fetchPartner = async () => {
      try {
        const response = await getPartnerInfo();
        if (response.status === 200) {
          setPartner(response.data);
        }
      } catch (error) {
        console.error("Failed to fetch partner info:", error);
      }
    };
    fetchPartner();
  }, []);

  const languages = [
    { code: 'en', name: 'English', flag: 'gb' },
    { code: 'es', name: 'Español', flag: 'es' },
    { code: 'pt', name: 'Português', flag: 'br' },
    { code: 'zh', name: '中文',      flag: 'cn' },
  ];

  // Translations for Account page
  const pageTranslations: Record<'en'|'es'|'pt'|'zh', { languageConfig: string; unverified: string; verified: string }> = {
    en: { languageConfig: "Language configuration:", unverified: "Unverified", verified: "Verified" },
    es: { languageConfig: "Configuración de idioma:", unverified: "No verificado", verified: "Verificado" },
    pt: { languageConfig: "Configuração de idioma:", unverified: "Não verificado", verified: "Verificado" },
    zh: { languageConfig: "语言设置：", unverified: "未验证", verified: "已验证" },
  };

  if (!partner) {
    // partner data not yet loaded
    return <div>Loading...</div>;
  }

  return (
    <div className="min-h-screen p-4 space-y-4 bg-gray-50">
      <Navbar activeSection={activeSection} setActiveSection={setActiveSection} />

      <div className="p-6 bg-white rounded-lg shadow">
        <div className="flex items-center space-x-4">
          {/* profile image placeholder */}
          <div className="w-28 h-28 bg-gray-300 rounded-full" />
          <div>
            <div className="flex flex-col space-y-1">
              <h1 className="text-xl font-semibold">{partner.name}</h1>
              <span 
                className="inline-flex items-center space-x-1 px-1 py-0.5 rounded-full text-sm font-medium text-orange-800 bg-orange-100 border border-orange-800"
              >
                <svg
                  className="w-4 h-4 text-orange-800"
                  fill="currentColor"
                  viewBox="0 0 20 20"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    fillRule="evenodd"
                    d="M18 10c0 4.418-3.582 8-8 8s-8-3.582-8-8 3.582-8 8-8 8 3.582 8 8zm-8-4a1 1 0 100 2 1 1 0 000-2zm.25 4.75a.75.75 0 00-1.5 0v3a.75.75 0 001.5 0v-3z"
                    clipRule="evenodd"
                  />
                </svg>
                <span>{pageTranslations[language].unverified}</span>
              </span>
              <span 
                className="inline-flex items-center space-x-1 px-1 py-0.5 rounded-full text-sm font-medium text-green-800 bg-green-100 border border-green-800"
              >
                <svg
                  className="w-4 h-4 text-green-800"
                  fill="currentColor"
                  viewBox="0 0 20 20"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    fillRule="evenodd"
                    d="M16.707 5.707a1 1 0 010 1.414L8.414 15.414a1 1 0 01-1.414 0L3.293 11.707a1 1 0 011.414-1.414L7 12.586l8.293-8.293a1 1 0 011.414 0z"
                    clipRule="evenodd"
                  />
                </svg>
                <span>{pageTranslations[language].verified}</span>
              </span>
            </div>
            
          </div>
        </div>
      </div>

      {/* Language configuration */}
      <div className="flex items-center space-x-2 mt-4">
        <span className="text-sm">{pageTranslations[language].languageConfig}</span>
        <div className="relative w-40">
          <Listbox value={language} onChange={setLanguage}>
            <Listbox.Button className="w-full border border-gray-300 rounded-md p-2 flex items-center space-x-2 bg-white text-sm">
              <img
                src={`https://hatscripts.github.io/circle-flags/flags/${languages.find(l=>l.code===language)!.flag}.svg`}
                alt={`${languages.find(l=>l.code===language)!.name} flag`}
                className="w-5 h-5 rounded-full"
              />
              <span>{languages.find(l=>l.code===language)!.name}</span>
            </Listbox.Button>
            <Listbox.Options className="absolute z-10 w-full mt-1 border border-gray-200 rounded-md bg-white shadow-lg max-h-40 overflow-auto">
              {languages.map(l=>(
                <Listbox.Option 
                  key={l.code} 
                  value={l.code} 
                  className="cursor-pointer px-2 py-1 flex items-center space-x-2 hover:bg-gray-100"
                >
                  <img
                    src={`https://hatscripts.github.io/circle-flags/flags/${l.flag}.svg`}
                    alt={`${l.name} flag`}
                    className="w-5 h-5 rounded-full"
                  />
                  <span>{l.name}</span>
                </Listbox.Option>
              ))}
            </Listbox.Options>
          </Listbox>
        </div>
      </div>
    </div>
  );
}

import { Card, CardContent } from "../components/card";
import Navbar from "../components/Navbar";
import { useLanguage } from "../contexts/LanguageContext";

export default function Integrations() {
  const { language } = useLanguage();

  const translations: Record<'en'|'es'|'pt'|'zh', { title: string; description: string; copy: string }> = {
    en: { title: "API Integration", description: "This is the API key to use on your technical integrations.", copy: "Copy" },
    es: { title: "Integración de API", description: "Esta es la clave de API para usar en tus integraciones técnicas.", copy: "Copiar" },
    pt: { title: "Integração de API", description: "Esta é a chave de API para usar em suas integrações técnicas.", copy: "Copiar" },
    zh: { title: "API 集成", description: "这是用于技术集成的 API 密钥。", copy: "复制" },
  };

  const apiKey = "";

  const copyApiKey = () => {
    navigator.clipboard.writeText(apiKey);
  };

  return (
    <div className="min-h-screen p-4 bg-gray-50">
      <Navbar activeSection="integrations" setActiveSection={() => {}} />
      <div className="space-y-4 relative">
        <div className="mt-16">
          <Card className="rounded-xl w-full border-0 shadow-lg bg-gray-50">
            <CardContent className="space-y-4">
              <h3 className="text-xl font-semibold">{translations[language].title}</h3>
              <p className="text-sm text-gray-600">{translations[language].description}</p>
              <div className="p-4 bg-gray-50 rounded-lg break-all flex justify-between items-center">
                <p className="font-mono font-bold text-sm">{apiKey}</p>
                <button
                  onClick={copyApiKey}
                  className="ml-4 px-3 py-1 text-sm bg-gray-200 hover:bg-gray-300 rounded"
                >
                  {translations[language].copy}
                </button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

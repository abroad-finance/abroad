import { useNavigate } from "react-router-dom"; // Import useNavigate
import { useLanguage } from '../contexts/LanguageContext'; // Import useLanguage
import {
  Home as HomeIcon,
  Send as SendIcon,
  Banknote as BankIcon,
  Users as UsersIcon,
  ShieldAlert as SecurityIcon,
  // Cog as CogIcon,
  HelpCircle as HelpIcon,
  Settings as SettingsIcon  // add Settings icon
} from "lucide-react";

const navLinks = [
  { label: "Dashboard", icon: HomeIcon, section: "dashboard", path: "/dashboard" },
  { label: "Send Payment", icon: SendIcon, section: "send" },
  { label: "Transactions", icon: BankIcon, section: "transactions" },
  { label: "Recipients", icon: UsersIcon, section: "recipients", path: "/recipients" },
  { label: "Security", icon: SecurityIcon, section: "security" },
 // { label: "API & Integrations", icon: CogIcon, section: "api", path: "/integrations" },
  { label: "Help & Support", icon: HelpIcon, section: "help" },
  { label: "Settings", icon: SettingsIcon, section: "settings", path: "/settings" }
];

// Add translations for each section and language
const translations: Record<'en'|'es'|'pt'|'zh', Record<string, string>> = {
  en: {
    dashboard: "Dashboard",
    send: "Send Payment",
    transactions: "Transactions",
    recipients: "Recipients",
    security: "Security",
    api: "API & Integrations",
    help: "Help & Support",
    settings: "Settings"
  },
  es: {
    dashboard: "Dashboard",
    send: "Enviar Pago",
    transactions: "Transacciones",
    recipients: "Destinatarios",
    security: "Seguridad",
    api: "API e Integraciones",
    help: "Ayuda y Soporte",
    settings: "Configuración"
  },
  pt: {
    dashboard: "Painel",
    send: "Enviar Pagamento",
    transactions: "Transações",
    recipients: "Destinatários",
    security: "Segurança",
    api: "API e Integrações",
    help: "Ajuda e Suporte",
    settings: "Configurações"
  },
  zh: {
    dashboard: "仪表板",
    send: "发送付款",
    transactions: "交易",
    recipients: "收件人",
    security: "安全",
    api: "API和集成",
    help: "帮助与支持",
    settings: "设置"
  },
};

interface TopbarProps {
  activeSection: string;
  setActiveSection: (section: string) => void;
}

export default function Topbar({ activeSection, setActiveSection }: TopbarProps) {
  const navigate = useNavigate();
  const { language } = useLanguage();

  return (
    <header className="w-full bg-white border border-gray-200 shadow-sm rounded-xl mb-4">
      <div className="max-w-7xl mx-auto px-4">
        <div className="flex items-center justify-between h-16">
          {/* Logo on the left */}
          <div className="flex items-center">
            <div
              className="flex-shrink-0 logo-container"
              role="button"
              tabIndex={0}
              onClick={() => navigate("/dashboard")}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  navigate("/dashboard");
                }
              }}
              style={{ cursor: "pointer" }}
            >
              <img
                src="https://cdn.prod.website-files.com/66d73974e0b6f2e9c06130a7/67bdb92323f0bb399db3754c_abroad-logo.svg"
                alt="Abroad Logo"
                className="h-8"
              />
            </div>
    
          </div>

          {/* Navigation items in the center */}
          <nav className="flex items-center gap-6 flex-1 justify-center">
            {navLinks
              .filter(
                (link) =>
                  link.section !== "send" &&
                  link.section !== "transactions" &&
                  link.section !== "security"
              )
              .map((link) => {
                const Icon = link.icon;
                const label = translations[language][link.section] || link.label;

                if (link.section === "help") {
                  return (
                    <a
                      key={link.section}
                      href="https://discord.gg/YqWdSxAy5B"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 text-sm font-medium transition-colors text-gray-600 hover:text-green-700"
                    >
                      <Icon className="w-4 h-4" />
                      {label}
                    </a>
                  );
                }

                return (
                  <button
                    key={link.section}
                    onClick={() => {
                      if (link.path) {
                        navigate(link.path);
                      }
                      if (typeof setActiveSection === "function") {
                        setActiveSection(link.section);
                      }
                    }}
                    className={`flex items-center gap-1 text-sm font-medium transition-colors ${
                      activeSection === link.section
                        ? "text-green-700"
                        : "text-gray-600 hover:text-green-700"
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                    {label}
                  </button>
                );
              })}
          </nav>

          {/* Moved account section to the top‑right */}
          <div className="flex items-center gap-2">
            <div className="h-10 w-10 rounded-full bg-gray-200"></div>
            <div className="flex flex-col">
              <span className="text-sm font-medium text-gray-700">Company Name</span>
              <span className="relative group inline-flex items-center gap-1 text-xs bg-green-100 text-green-800 border border-green-200 rounded-full px-2 py-0.5 cursor-pointer">
                ✓ Verified
                <span className="absolute bottom-full left-1/2 mb-1 w-max -translate-x-1/2 whitespace-nowrap rounded bg-gray-800 px-2 py-1 text-xs text-white opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                  You have performed a KYC/AML check and your account is approved to make payments.
                </span>
              </span>
              <span className="relative group inline-flex items-center gap-1 text-xs bg-orange-100 text-orange-800 border border-orange-200 rounded-full px-2 py-0.5 cursor-pointer">
                ✓ Unverified
                <span className="absolute top-full left-1/2 mt-1 w-max max-w-xs -translate-x-1/2 whitespace-normal rounded bg-gray-800 px-2 py-1 text-xs text-white opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                  You have not performed a KYC/AML check. Therefore your maximum allowance to make payments is $100. Please perform a KYC/AML check to increase your allowance.
                </span>
              </span>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}

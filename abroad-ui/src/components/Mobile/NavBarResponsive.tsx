import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLanguage } from '../../contexts/LanguageContext';
import {
  Home as HomeIcon,
  Send as SendIcon,
  Banknote as BankIcon,
  Users as UsersIcon,
  ShieldAlert as SecurityIcon,
  HelpCircle as HelpIcon,
  Settings as SettingsIcon,
  WavesLadder as PoolIcon,
  Menu as MenuIcon,
  X as CloseIcon,
} from 'lucide-react';
import { getPartnerInfo, PartnerInfoResponse } from '../../api';

const navLinks = [
  { key: 'dashboard', icon: HomeIcon, path: '/dashboard' },
  { key: 'pool', icon: PoolIcon, path: '/pool' },
  { key: 'send', icon: SendIcon },
  { key: 'transactions', icon: BankIcon },
  { key: 'recipients', icon: UsersIcon, path: '/recipients' },
  { key: 'security', icon: SecurityIcon },
  { key: 'help', icon: HelpIcon },
  { key: 'settings', icon: SettingsIcon, path: '/settings' },
];
const translations: Record<'en'|'es'|'pt'|'zh', Record<string,string>> = {
  en: { dashboard: 'Dashboard', pool: 'Pool', send: 'Send', transactions: 'Transactions', recipients: 'Recipients', security: 'Security', help: 'Help & Support', settings: 'Settings' },
  es: { dashboard: 'Dashboard', pool: 'Pool', send: 'Enviar', transactions: 'Transacciones', recipients: 'Destinatarios', security: 'Seguridad', help: 'Ayuda', settings: 'Configuración' },
  pt: { dashboard: 'Painel', pool: 'Pool', send: 'Enviar', transactions: 'Transações', recipients: 'Destinatários', security: 'Segurança', help: 'Ajuda', settings: 'Configurações' },
  zh: { dashboard: '仪表板', pool: '池', send: '发送', transactions: '交易', recipients: '收件人', security: '安全', help: '帮助', settings: '设置' },
};

interface Props {
  activeSection: string;
  setActiveSection: (section: string) => void;
}

export const NavBarResponsive: React.FC<Props> = ({ activeSection, setActiveSection }) => {
  const navigate = useNavigate();
  const { language } = useLanguage();
  const t = translations[language] || translations.en;
  const [open, setOpen] = useState(false);
  const [partner, setPartner] = useState<PartnerInfoResponse|null>(null);

  useEffect(() => {
    getPartnerInfo().then(res => res.status===200 && setPartner(res.data)).catch(()=>{});
  }, []);
  if (!partner) return null;

  return (
    <header className="bg-white shadow rounded-lg mb-4">
      <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between md:justify-start md:space-x-6">
        <div className="flex items-center">
          <button onClick={()=>navigate('/dashboard')} className="mr-4">
            <img src="https://cdn.prod.website-files.com/66d73974e0b6f2e9c06130a7/67bdb92323f0bb399db3754c_abroad-logo.svg" alt="logo" className="h-6" />
          </button>
          <button className="md:hidden" onClick={()=>setOpen(!open)}>
            {open ? <CloseIcon className="w-6 h-6"/> : <MenuIcon className="w-6 h-6"/>}
          </button>
        </div>
        <nav className={`hidden md:flex items-center space-x-4 flex-1`}>  
          {navLinks.map(link=>{
            const Label = link.key;
            const Icon = link.icon;
            const labelText = t[link.key] || Label;
            return (
              <button key={link.key} onClick={() => { if (link.path) navigate(link.path); setActiveSection(link.key); }}
                className={`flex items-center space-x-1 px-2 py-1 text-sm font-medium ${activeSection===link.key? 'text-green-700': 'text-gray-600 hover:text-green-700'}`}>
                <Icon className="w-5 h-5"/><span>{labelText}</span>
              </button>
            );
          })}
        </nav>
        <div className="hidden md:flex items-center space-x-3">
          <div className="h-8 w-8 bg-gray-200 rounded-full flex items-center justify-center text-sm text-gray-700">
            {partner.name.charAt(0).toUpperCase()}
          </div>
          <span className="text-sm text-gray-700 font-medium">{partner.name}</span>
        </div>
      </div>
      {open && (
        <div className="md:hidden bg-white border-t border-gray-200">
          <nav className="px-4 py-2 space-y-2">
            {navLinks.map(link=>{
              const Icon = link.icon;
              const labelText = t[link.key] || link.key;
              return (
                <button key={link.key} onClick={() => { if (link.path) navigate(link.path); setActiveSection(link.key); setOpen(false); }}
                  className="w-full flex items-center space-x-2 px-3 py-2 text-left text-gray-700 hover:bg-gray-100 rounded">
                  <Icon className="w-5 h-5"/><span>{labelText}</span>
                </button>
              );
            })}
            <div className="flex items-center space-x-2 px-3 py-2">
              <div className="h-6 w-6 bg-gray-200 rounded-full flex items-center justify-center text-xs text-gray-700">
                {partner.name.charAt(0).toUpperCase()}
              </div>
              <span className="text-sm text-gray-700">{partner.name}</span>
            </div>
          </nav>
        </div>
      )}
    </header>
  );
};

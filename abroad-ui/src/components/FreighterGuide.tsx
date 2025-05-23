import React from 'react';
import { useLanguage } from '../contexts/LanguageContext'; // add language hook
import { CardContent } from "./card";

export interface CardProps {
  className?: string;
  style?: React.CSSProperties; // allow inline styles
  children?: React.ReactNode;
}

export function Card({ className, style, children }: CardProps) {
  return (
    <div className={className} style={style}>
      {children}
    </div>
  );
}

export function FreighterGuide() {
  const { language } = useLanguage(); // current language
  const translations: Record<'en'|'es'|'pt'|'zh', { title: string; description: string; link: string }> = {
    en: {
      title: "Connect with Freighter Wallet",
      description:
        "Freighter is a non-custodial Stellar wallet you can use to manage your funds seamlessly on Abroad. Just download Freighter, create a wallet, top it up with USDC, connect it to our platform and we will do the rest.",
      link: "Try Freighter"
    },
    es: {
      title: "Conéctate con Freighter Wallet",
      description:
        "Freighter es una billetera no custodia de Stellar que puedes usar para gestionar tus fondos sin problemas en Abroad. Solo descarga Freighter, crea una wallet, cárgala, conéctala a nuestra plataforma y nosotros haremos el resto.",
      link: "Probar Freighter"
    },
    pt: {
      title: "Conecte-se com a Carteira Freighter",
      description:
        "Freighter é uma carteira não custodial do Stellar que você pode usar para gerenciar seus fundos perfeitamente no Abroad. Basta baixar o Freighter, criar uma carteira, abastecê-la, conectá-la à nossa plataforma e nós cuidaremos do resto.",
      link: "Experimente o Freighter"
    },
    zh: {
      title: "连接 Freighter 钱包",
      description:
        "Freighter 是一个非托管的 Stellar 钱包，您可以使用它在 Abroad 上无缝管理您的资金。只需下载 Freighter，创建钱包，充值，将其连接到我们的平台，我们会处理剩下的一切。",
      link: "试用 Freighter"
    }
  };
  const { title, description, link } = translations[language];

  return (
    <Card
      className="rounded-xl w-full border-0 shadow-lg mb-4"
      style={{
        backgroundImage:
          "url('https://static.vecteezy.com/system/resources/previews/026/493/927/non_2x/abstract-gradient-dark-green-liquid-wave-background-free-vector.jpg')",
        backgroundSize: 'cover',
        backgroundPosition: 'center',
      }}
    >
      <CardContent className="p-6 text-center">
        <h2 className="text-2xl font-bold mb-2 text-white">{title}</h2>
        <p className="mb-4 text-white">{description}</p>
        <a
          href="https://www.freighter.app/"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center px-3 py-1 rounded-full border border-white bg-white-200 text-white text-md font-medium"
        >
          {link}
        </a>
      </CardContent>
    </Card>
  );
}
import { useLanguage } from '../../contexts/LanguageContext'; // add language hook
import { Card, CardContent } from "../card";
import { Button } from "../ButtonOutlined";

interface WalletBalanceProps {
  balance: number;
  isConnecting: boolean;
  publicKey: string | null;
  handleWalletConnection: () => void;
  getWalletMessage: () => string;
}

// button label translations
const btnTranslations: Record<'en'|'es'|'pt'|'zh', { connect: string; disconnect: string; connecting: string }> = {
  en: { connect: "Connect Freighter Wallet", disconnect: "Disconnect Wallet", connecting: "Connecting..." },
  es: { connect: "Conectar Billetera Freighter", disconnect: "Desconectar Billetera", connecting: "Conectando..." },
  pt: { connect: "Conectar Carteira Freighter", disconnect: "Desconectar Carteira", connecting: "Conectando..." },
  zh: { connect: "连接 Freighter 钱包", disconnect: "断开钱包连接", connecting: "连接中…" },
};

export function WalletBalance({
  balance,
  isConnecting,
  publicKey,
  handleWalletConnection,
  getWalletMessage
}: WalletBalanceProps) {
  const { language } = useLanguage();
  const { connect, disconnect, connecting } = btnTranslations[language];

  return (
    <Card className="rounded-xl w-full border-0 shadow-lg">
      <CardContent className="flex flex-col items-center justify-center text-center h-full">
        <img
          src="https://assets.streamlinehq.com/image/private/w_300,h_300,ar_1/f_auto/v1/icons/vectors/usdc-fpxuadmgafrjjy85bgie5.png/usdc-kksfxcrdl3f9pjx0v6jxxp.png?_a=DAJFJtWIZAAC"
          alt="USDC Logo"
          className="w-10 h-10 mb-2"
        />
        <p className="text-5xl font-bold">
          ${balance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </p>
        <p className="text-sm text-gray-600 flex items-center justify-center gap-1 mt-1">
          {getWalletMessage()}
        </p>
        <Button
          onClick={handleWalletConnection}
          className="mt-4 rounded-xl text-white bg-gradient-to-r from-[#48b395] to-[#247469] hover:opacity-90"
          disabled={isConnecting}
        >
          {isConnecting ? connecting : publicKey ? disconnect : connect}
        </Button>
      </CardContent>
    </Card>
  );
}
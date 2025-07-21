import React from 'react';
import { Card, CardContent } from "./card";
import { Button } from "./Button";
import { QuoteResponse } from "../api/apiClient";
import { useLanguage } from '../contexts/LanguageContext';

const translations = {
  en: {
    makeTransfer: "Make an Instant Transfer",
    sendUsdc: "Send USDC",
    sendCop: "Send COP",
    selectRecipient: "Select recipient",
    typeRecipient: "Type recipient name",
    loading: "Loading...",
    getQuote: "Get Quote",
    acceptTransaction: "Accept Transaction",
    quotation: "Quotation",
    exchangeRate: "Exchange Rate",
    flatRate: "flat rate"
  },
  es: {
    makeTransfer: "Hacer una Transferencia Instantánea",
    sendUsdc: "Enviar Dólares Digitales (USDC)",
    sendCop: "Enviar Pesos Colombianos",
    selectRecipient: "Seleccionar destinatario",
    typeRecipient: "Escriba el nombre del destinatario",
    loading: "Cargando...",
    getQuote: "Obtener Cotización",
    acceptTransaction: "Aceptar Transacción",
    quotation: "Cotización",
    exchangeRate: "Tasa de Cambio",
    flatRate: "tarifa plana"
  },
  pt: {
    makeTransfer: "Fazer uma Transferência Instantânea",
    sendUsdc: "Enviar USDC",
    sendCop: "Enviar COP",
    selectRecipient: "Selecionar destinatário",
    typeRecipient: "Digite o nome do destinatário",
    loading: "Carregando...",
    getQuote: "Obter Cotação",
    acceptTransaction: "Aceitar Transação",
    quotation: "Cotação",
    exchangeRate: "Taxa de Câmbio",
    flatRate: "taxa fixa"
  },
  zh: {
    makeTransfer: "即时转账",
    sendUsdc: "发送 USDC",
    sendCop: "发送 COP",
    selectRecipient: "选择收款人",
    typeRecipient: "输入收款人姓名",
    loading: "加载中...",
    getQuote: "获取报价",
    acceptTransaction: "接受交易",
    quotation: "报价",
    exchangeRate: "汇率",
    flatRate: "固定费用"
  }
} as const;

interface QuotationProps {
  loading: boolean;
  publicKey: string | null;
  selectedCurrency: 'USDC' | 'COP';
  usdcAmount: number;
  usdcInput: string;
  quote: QuoteResponse | null;
  recipientInput: string;
  showRecipientOptions: boolean;
  filteredRecipients: { id: string; userId: string; accountNumber?: string }[];
  FLAT_RATE: number;
  handleCurrencyChange: (currency: 'USDC' | 'COP') => void;
  handleAmountChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  handleGetQuote: () => void;
  handleAcceptTransaction: () => void;
  setRecipientInput: (value: string) => void;
  setShowRecipientOptions: (value: boolean) => void;
}

export function Quotation({
  loading,
  publicKey,
  selectedCurrency,
  usdcAmount,
  usdcInput,
  quote,
  recipientInput,
  showRecipientOptions,
  filteredRecipients,
  FLAT_RATE,
  handleCurrencyChange,
  handleAmountChange,
  handleGetQuote,
  handleAcceptTransaction,
  setRecipientInput,
  setShowRecipientOptions
}: QuotationProps) {
  const { language } = useLanguage();
  const t = translations[language];

  return (
    <Card className="rounded-xl w-full border-0 shadow-lg">
      <CardContent className="space-y-4">
        <h3 className="text-xl font-semibold">{t.makeTransfer}</h3>
        <div className="flex rounded-lg border border-gray-200 p-1">
          <button
            onClick={() => handleCurrencyChange('USDC')}
            className={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition-colors ${selectedCurrency === 'USDC'
              ? 'bg-[#48b395] text-white'
              : 'text-gray-500 hover:text-gray-700'
              }`}
          >
            {t.sendUsdc}
          </button>
          <button
            onClick={() => handleCurrencyChange('COP')}
            className={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition-colors ${selectedCurrency === 'COP'
              ? 'bg-[#48b395] text-white'
              : 'text-gray-500 hover:text-gray-700'
              }`}
          >
            {t.sendCop}
          </button>
        </div>

        <div className="flex items-center gap-2 border-b border-gray-300 pb-1">
          {selectedCurrency === 'USDC' ? (
            <img
              src="https://assets.streamlinehq.com/image/private/w_300,h_300,ar_1/f_auto/v1/icons/vectors/usdc-fpxuadmgafrjjy85bgie5.png/usdc-kksfxcrdl3f9pjx0v6jxxp.png?_a=DAJFJtWIZAAC"
              alt="USDC Logo"
              className="h-6 w-6"
            />
          ) : (
            <img
              src="https://vectorflags.s3.amazonaws.com/flags/co-circle-01.png"
              alt="Colombian Flag"
              className="h-6 w-6"
            />
          )}
          <div className="relative w-full">
            <span className="absolute left-0 top-1/2 -translate-y-1/2 text-2xl font-bold text-gray-700">
              $
            </span>
            <input
              inputMode="decimal"
              type="text"
              placeholder="0.00"
              value={usdcInput}
              onChange={handleAmountChange}
              className="pl-6 w-full text-5xl font-bold text-gray-900 bg-transparent focus:outline-none"
              pattern="[0-9]*[.,]?[0-9]*"
            />
          </div>
        </div>
        <div>
          <label className="block mb-1 text-sm font-medium text-gray-700">
            {t.selectRecipient}
          </label>
          <div className="relative">
            <input
              type="text"
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
              placeholder={t.typeRecipient}
              value={recipientInput}
              onChange={e => {
                setRecipientInput(e.target.value);
                setShowRecipientOptions(true);
              }}
              onFocus={() => setShowRecipientOptions(true)}
              onBlur={() => setTimeout(() => setShowRecipientOptions(false), 150)}
            />
            {showRecipientOptions && filteredRecipients.length > 0 && (
              <ul className="absolute z-10 bg-white border border-gray-200 rounded-md mt-1 w-full max-h-48 overflow-auto shadow-lg">
                {filteredRecipients.map((user, idx) => (
                  <li
                    key={user.id || idx}
                    className="px-3 py-2 cursor-pointer hover:bg-gray-100"
                    onMouseDown={() => {
                      setRecipientInput(user.userId);
                      setShowRecipientOptions(false);
                    }}
                  >
                    {user.userId} {user.accountNumber ? `(${user.accountNumber})` : ""}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
        {quote ? (
          <Button
            onClick={handleAcceptTransaction}
            className="w-full rounded-xl text-white bg-gradient-to-r from-[#48b395] to-[#247469] hover:opacity-90"
            disabled={loading || !publicKey || (selectedCurrency === 'USDC' && usdcAmount <= 0)}
          >
            {loading ? t.loading : t.acceptTransaction}
          </Button>
        ) : (
          <Button
            onClick={handleGetQuote}
            className="w-full rounded-xl text-white bg-gradient-to-r from-[#48b395] to-[#247469] hover:opacity-90"
            disabled={loading || !publicKey || (selectedCurrency === 'USDC' && usdcAmount <= 0)}
          >
            {loading ? t.loading : t.getQuote}
          </Button>
        )}
        {quote !== null && (
          <>
            <p className="mt-4 text-xl font-bold text-gray-600">
              {selectedCurrency === 'USDC'
                ? `${t.quotation}: COP $${quote.value.toLocaleString()}`
                : `${t.quotation}: USDC $${quote.value.toLocaleString()}`}
            </p>
            <p className="text-sm text-gray-500">
              {selectedCurrency === 'USDC'
                ? `${t.exchangeRate}: 1 USDC = COP $${((quote.value + FLAT_RATE) / usdcAmount).toFixed(2)} ${t.flatRate}:${FLAT_RATE} COP`
                : `${t.exchangeRate}: 1 USDC = COP $${((usdcAmount + FLAT_RATE) / (quote.value)).toFixed(2)} ${t.flatRate}:${FLAT_RATE} COP`}
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
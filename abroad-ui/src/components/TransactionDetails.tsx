import { Card, CardContent } from "./card";
import { Transaction } from "../api/apiClient";
import { useLanguage } from '../contexts/LanguageContext';
import { useEffect } from 'react';

const translations = {
  en: {
    transactionDetails: "Transaction Details",
    dateTime: "Date & Time",
    userId: "User ID",
    accountNumber: "Account Number",
    bank: "Bank",
    status: "Status",
    sourceAmount: "Source Amount",
    targetAmount: "Target Amount",
    completed: "Completed",
    pending: "Pending"
  },
  es: {
    transactionDetails: "Detalles de Transacción",
    dateTime: "Fecha y Hora",
    userId: "ID de Usuario",
    accountNumber: "Número de Cuenta",
    bank: "Banco",
    status: "Estado",
    sourceAmount: "Monto Origen",
    targetAmount: "Monto Destino",
    completed: "Completado",
    pending: "Pendiente"
  },
  pt: {
    transactionDetails: "Detalhes da Transação",
    dateTime: "Data e Hora",
    userId: "ID do Usuário",
    accountNumber: "Número da Conta",
    bank: "Banco",
    status: "Status",
    sourceAmount: "Valor de Origem",
    targetAmount: "Valor de Destino",
    completed: "Concluído",
    pending: "Pendente"
  },
  zh: {
    transactionDetails: "交易详情",
    dateTime: "日期和时间",
    userId: "用户ID",
    accountNumber: "账号",
    bank: "银行",
    status: "状态",
    sourceAmount: "源金额",
    targetAmount: "目标金额",
    completed: "已完成",
    pending: "待处理"
  }
};

// Add Quote interface if not already defined in apiClient
interface Quote {
  sourceAmount?: number;
  targetAmount?: number;
  cryptoCurrency?: string;
  targetCurrency?: string;
}

// Extend Transaction type to include quote
interface TransactionWithQuote extends Transaction {
  quote?: Quote;
}

export interface TransactionDetailsProps {
  transaction: TransactionWithQuote;
  onClose: () => void;
}

export function TransactionDetails({ transaction, onClose }: TransactionDetailsProps) {
  const { language } = useLanguage();
  const t = translations[language as keyof typeof translations] || translations.en;

  const getBankLogo = (bankCode: string) => {
    switch (bankCode) {
      case '1507':
        return 'https://storage.googleapis.com/cdn-abroad/Icons/Banks/Nequi_Logo_Full.svg';
      case '1551':
        return 'https://storage.googleapis.com/cdn-abroad/Icons/Banks/Daviplata_Full.svg';
      case '1007':
        return 'https://storage.googleapis.com/cdn-abroad/Icons/Banks/Bancolombia_Full.svg';
      default:
        return null;
    }
  };

  const formatNumber = (value?: number) => {
    if (value === undefined) return "-";
    try {
      return value.toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
    } catch {
      return value.toFixed(2);
    }
  };

  const formatDate = (date?: string) => {
    if (!date) return "-";
    try {
      return new Date(date).toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      });
    } catch {
      return new Date(date).toString();
    }
  };

  useEffect(() => {
    const handleEscapeKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', handleEscapeKey);

    return () => {
      document.removeEventListener('keydown', handleEscapeKey);
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 flex items-center justify-center backdrop-blur-sm"
      style={{ backgroundColor: 'rgba(0, 0, 0, 0.60)' }}
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') onClose();
      }}
      role="button"
      tabIndex={0}
    >
      <Card
        className="w-11/12 max-w-lg bg-white rounded-lg shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <CardContent>
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-lg font-semibold">{t.transactionDetails}</h2>
            <button onClick={onClose} className="text-gray-500 hover:text-gray-700">
              ✕
            </button>
          </div>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <dt className="font-medium">{t.dateTime}</dt>
            <dd>{formatDate(transaction.createdAt)}</dd>
            <dt className="font-medium">{t.userId}</dt>
            <dd>{transaction.partnerUserId}</dd>
            <dt className="font-medium">{t.accountNumber}</dt>
            <dd>{transaction.accountNumber}</dd>
            <dt className="font-medium">{t.bank}</dt>
            <dd>
              {getBankLogo(transaction.bankCode) ? (
                <img
                  src={getBankLogo(transaction.bankCode)!}
                  alt={`Bank ${transaction.bankCode}`}
                  className="h-6 w-auto"
                />
              ) : (
                transaction.bankCode
              )}
            </dd>
            <dt className="font-medium">{t.status}</dt>
            <dd>
              {transaction.status === 'PAYMENT_COMPLETED' ? (
                <span className="px-2 py-1 text-xs font-medium rounded-full border border-green-400 bg-green-100 text-green-800">
                  {t.completed}
                </span>
              ) : transaction.status === 'AWAITING_PAYMENT' ? (
                <span className="px-2 py-1 text-xs font-medium rounded-full border border-blue-400 bg-blue-100 text-blue-800">
                  {t.pending}
                </span>
              ) : (
                <span className="px-2 py-1 text-xs font-medium rounded-full border border-gray-300 bg-gray-100 text-gray-800">
                  {transaction.status}
                </span>
              )}
            </dd>
            <dt className="font-medium">{t.sourceAmount}</dt>
            <dd className="flex items-center space-x-1">
              <img
                src="https://storage.googleapis.com/cdn-abroad/Icons/Tokens/USDC%20Token.svg"
                alt="USDC Icon"
                className="w-4 h-4"
              />
              <span>{formatNumber(transaction.quote?.sourceAmount)} {transaction.quote?.cryptoCurrency || '-'}</span>
            </dd>
            <dt className="font-medium">{t.targetAmount}</dt>
            <dd>
              {formatNumber(transaction.quote?.targetAmount)} {transaction.quote?.targetCurrency || '-'}
            </dd>
          </dl>
        </CardContent>
      </Card>
    </div>
  );
}

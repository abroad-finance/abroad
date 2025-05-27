import { useState } from "react";
import { Card, CardContent } from "./card";
import { PaginatedTransactionList, Transaction } from "../api/apiClient";
import { TransactionDetails } from "./TransactionDetails";
import { useLanguage } from '../contexts/LanguageContext';

const translations = {
  en: {
    recentTransactions: "Recent Transactions",
    dateTime: "Date & Time",
    userId: "User ID",
    accountNumber: "Account Number",
    bank: "Bank",
    status: "Status",
    sourceAmount: "Source Amount",
    targetAmount: "Target Amount",
    noTransactions: "No transactions found.",
    completed: "Completed",
    pending: "Pending"
  },
  es: {
    recentTransactions: "Transacciones Recientes",
    dateTime: "Fecha y Hora",
    userId: "ID de Usuario",
    accountNumber: "Número de Cuenta",
    bank: "Banco",
    status: "Estado",
    sourceAmount: "Monto Origen",
    targetAmount: "Monto Destino",
    noTransactions: "No se encontraron transacciones.",
    completed: "Completado",
    pending: "Pendiente"
  },
  pt: {
    recentTransactions: "Transações Recentes",
    dateTime: "Data e Hora",
    userId: "ID do Usuário",
    accountNumber: "Número da Conta",
    bank: "Banco",
    status: "Status",
    sourceAmount: "Valor de Origem",
    targetAmount: "Valor de Destino",
    noTransactions: "Nenhuma transação encontrada.",
    completed: "Concluído",
    pending: "Pendente"
  },
  zh: {
    recentTransactions: "最近交易",
    dateTime: "日期和时间",
    userId: "用户ID",
    accountNumber: "账号",
    bank: "银行",
    status: "状态",
    sourceAmount: "源金额",
    targetAmount: "目标金额",
    noTransactions: "未找到交易。",
    completed: "已完成",
    pending: "待处理"
  }
};

export interface TransactionListProps {
  transactions: PaginatedTransactionList | null;
}

export function TransactionList({ transactions }: TransactionListProps) {
  const { language } = useLanguage();
  const t = translations[language as keyof typeof translations] || translations.en;
  const [selectedTx, setSelectedTx] = useState<Transaction | null>(null);

  return (
    <div className="grid grid-cols-1">
      <Card className="rounded-xl w-full border-0 shadow-lg">
        <CardContent>
          <h3 className="text-xl font-semibold mb-4">{t.recentTransactions}</h3>
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left py-3 px-4 text-sm font-medium text-gray-600">{t.dateTime}</th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-gray-600">{t.userId}</th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-gray-600">{t.accountNumber}</th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-gray-600">{t.bank}</th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-gray-600">{t.status}</th>
                  <th className="text-right py-3 px-4 text-sm font-medium text-gray-600">{t.sourceAmount}</th>
                  <th className="text-right py-3 px-4 text-sm font-medium text-gray-600">{t.targetAmount}</th>
                </tr>
              </thead>
              <tbody>
                {transactions && transactions.transactions.length > 0 ? (
                  transactions.transactions.map((tx, index) => (
                    <tr
                      key={tx.id || index}
                      className="border-b border-gray-100 hover:bg-gray-50 cursor-pointer"
                      onClick={() => setSelectedTx(tx)}
                    >
                      <td className="py-3 px-4 text-sm text-gray-600">
                        {tx.createdAt ? new Date(tx.createdAt).toLocaleString() : "-"}
                      </td>
                      <td className="py-3 px-4 text-sm text-gray-900">{tx.partnerUserId}</td>
                      <td className="py-3 px-4 text-sm text-gray-900">{tx.accountNumber}</td>
                      <td className="py-3 px-4 text-sm text-gray-900">{tx.bankCode}</td>
                      <td className="py-3 px-4 text-sm">
                        {tx.status === 'PAYMENT_COMPLETED' ? (
                          <span className="px-2 py-1 text-xs font-medium rounded-full border border-green-400 bg-green-100 text-green-800">
                            {t.completed}
                          </span>
                        ) : tx.status === 'AWAITING_PAYMENT' ? (
                          <span className="px-2 py-1 text-xs font-medium rounded-full border border-blue-400 bg-blue-100 text-blue-800">
                            {t.pending}
                          </span>
                        ) : (
                          <span className="px-2 py-1 text-xs font-medium rounded-full border border-gray-300 bg-gray-100 text-gray-800">
                            {tx.status}
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-sm text-gray-900 text-right">
                        {tx.quote?.sourceAmount != null && (
                          <div className="flex items-center justify-end space-x-1">
                            <img
                              src="https://payload-marketing.moonpay.com/api/media/file/mk1bgycpph-K6MWcviP8ndwcJ5yNIrpI"
                              alt="USDC Icon"
                              className="w-4 h-4"
                            />
                            <span>${tx.quote.sourceAmount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                          </div>
                        )}
                      </td>
                      <td className="py-3 px-4 text-sm text-gray-900 text-right">
                        {tx.quote?.targetAmount != null && (
                          <div className="flex items-center justify-end space-x-1">
                            <img
                              src="https://vectorflags.s3.amazonaws.com/flags/co-circle-01.png"
                              alt="Colombia Flag Icon"
                              className="w-4 h-4"
                            />
                            <span>${tx.quote.targetCurrency} ${tx.quote.targetAmount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={8} className="py-3 px-4 text-center text-gray-600">
                      {t.noTransactions}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {selectedTx && (
        <TransactionDetails
          transaction={selectedTx}
          onClose={() => setSelectedTx(null)}
        />
      )}
    </div>
  );
}
import { Card, CardContent } from "./card";
import { Transaction } from "../api/apiClient";

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

  return (
    <div
      className="fixed inset-0 flex items-center justify-center backdrop-blur-sm"
      style={{ backgroundColor: 'rgba(0, 0, 0, 0.60)' }}
      onClick={onClose}
    >
      <Card
        className="w-11/12 max-w-lg bg-white rounded-lg shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <CardContent>
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-lg font-semibold">Transaction Details</h2>
            <button onClick={onClose} className="text-gray-500 hover:text-gray-700">
              ✕
            </button>
          </div>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <dt className="font-medium">Date & Time</dt>
            <dd>{formatDate(transaction.createdAt)}</dd>
            <dt className="font-medium">User ID</dt>
            <dd>{transaction.partnerUserId}</dd>
            <dt className="font-medium">Account Number</dt>
            <dd>{transaction.accountNumber}</dd>
            <dt className="font-medium">Bank</dt>
            <dd>{transaction.bankCode}</dd>
            <dt className="font-medium">Status</dt>
            <dd>{transaction.status}</dd>
            <dt className="font-medium">Source Amount</dt>
            <dd>
              {formatNumber(transaction.quote?.sourceAmount)} {transaction.quote?.cryptoCurrency || '-'}
            </dd>
            <dt className="font-medium">Target Amount</dt>
            <dd>
              {formatNumber(transaction.quote?.targetAmount)} {transaction.quote?.targetCurrency || '-'}
            </dd>
          </dl>
        </CardContent>
      </Card>
    </div>
  );
}

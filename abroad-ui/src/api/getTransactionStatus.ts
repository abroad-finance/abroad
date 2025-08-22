import { customClient } from './customClient';
import { TransactionStatusResponse } from './index';

// Lightweight wrapper replacing deprecated apiClient version
export const getTransactionStatus = async (transactionId: string) => {
  return customClient<{ status: number; data: TransactionStatusResponse }>(`/transaction/${transactionId}`, { method: 'GET' });
};

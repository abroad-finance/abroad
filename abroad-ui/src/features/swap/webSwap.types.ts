import { _36EnumsTargetCurrency as TargetCurrency } from '../../api';

export interface SwapData {
  quote_id: string;
  srcAmount: string;
  tgtAmount: string;
  targetCurrency: typeof TargetCurrency[keyof typeof TargetCurrency];
}



// Extend views to include transaction status screen shown right after user signs the tx
export type SwapView = 'swap' | 'bankDetails' | 'txStatus' | 'kyc-needed';
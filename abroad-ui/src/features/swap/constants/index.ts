// Background used when BRL is selected
export const BRL_BACKGROUND_IMAGE = 'https://storage.googleapis.com/cdn-abroad/bg/6193481566_1a304e3aa3_o.jpg'

export interface TxDetailItem {
  accountNumber: string
  chain: string
  country: 'br' | 'co'
  date: string
  fee: string
  localAmount: string
  location?: string
  merchant: string
  partnerId?: string
  settlementTime: string
  status: 'completed' | 'expired' | 'pending'
  token: string
  transactionId?: string
  usdcAmount: string
}

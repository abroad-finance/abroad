import { TransactionStatus } from '@prisma/client'
import { z } from 'zod'

export const acceptTransactionRequestSchema = z.object({
  account_number: z.string().min(1, 'Account number is required'),
  qr_code: z.string().nullable().optional(),
  quote_id: z.string().min(1, 'Quote ID is required'),
  redirectUrl: z.string().optional(),
  tax_id: z.string().optional(),
  user_id: z.string().min(1, 'User ID is required'),
})

export interface AcceptTransactionRequest {
  account_number: string
  qr_code?: null | string
  quote_id: string
  redirectUrl?: string
  tax_id?: string
  user_id: string
}

export interface AcceptTransactionResponse {
  id: null | string
  kycLink: null | string
  transaction_reference: null | string
}

export interface TransactionStatusResponse {
  id: string
  kycLink: null | string
  on_chain_tx_hash: null | string
  status: TransactionStatus
  transaction_reference: string
  user_id: string
}

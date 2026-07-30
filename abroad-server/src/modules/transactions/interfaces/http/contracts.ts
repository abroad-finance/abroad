import { TransactionStatus } from '@prisma/client'
import { z } from 'zod'

import { PaymentContext } from '../../../payments/application/PaymentContextService'

const hasDestinationValue = (value: null | string | undefined): boolean =>
  typeof value === 'string' && value.trim().length > 0

export const acceptTransactionRequestSchema = z.object({
  account_number: z.string().optional(),
  qr_code: z.string().nullable().optional(),
  quote_id: z.string().min(1, 'Quote ID is required'),
  redirectUrl: z.string().optional(),
  tax_id: z.string().optional(),
  user_id: z.string().min(1, 'User ID is required'),
}).superRefine((request, context) => {
  if (
    !hasDestinationValue(request.account_number)
    && !hasDestinationValue(request.qr_code)
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Account number or QR code is required',
      path: ['account_number'],
    })
  }
})

export interface AcceptTransactionRequest {
  account_number?: string
  qr_code?: null | string
  quote_id: string
  redirectUrl?: string
  tax_id?: string
  user_id: string
}

export interface AcceptTransactionResponse {
  id: null | string
  kycRequired: boolean
  payment_context?: null | PaymentContext
  transaction_reference: null | string
}

export interface TransactionStatusResponse {
  id: string
  kycRequired: boolean
  on_chain_tx_hash: null | string
  status: TransactionStatus
  transaction_reference: string
  user_id: string
}

import { TransactionStatus } from '@prisma/client'
import { z } from 'zod'

import { PaymentContext } from '../../../payments/application/PaymentContextService'

const hasDestinationValue = (value: null | string | undefined): boolean =>
  typeof value === 'string' && value.trim().length > 0

export const acceptTransactionRequestSchema = z.object({
  account_number: z.string().optional(),
  // Wallet the crypto is delivered to. Required for a fiat-to-crypto quote and
  // meaningless for a payout, where the destination is a bank account.
  destination_address: z.string().optional(),
  qr_code: z.string().nullable().optional(),
  quote_id: z.string().min(1, 'Quote ID is required'),
  redirectUrl: z.string().optional(),
  tax_id: z.string().optional(),
  user_id: z.string().min(1, 'User ID is required'),
}).superRefine((request, context) => {
  if (
    !hasDestinationValue(request.account_number)
    && !hasDestinationValue(request.qr_code)
    && !hasDestinationValue(request.destination_address)
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Account number, QR code, or destination address is required',
      path: ['account_number'],
    })
  }
})

export interface AcceptTransactionRequest {
  account_number?: string
  destination_address?: string
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
  /**
   * Present only on a fiat-to-crypto transaction: what the customer pays to
   * fund it. A payout instead returns `transaction_reference` for the customer
   * to include in their on-chain memo.
   */
  payment_instructions?: null | PaymentInstructions
  transaction_reference: null | string
}

export interface PaymentInstructions {
  /** EMV copy-paste PIX payload. */
  br_code: string
  /** Epoch milliseconds, or null when the code does not expire. */
  expires_at: null | number
}

export interface TransactionStatusResponse {
  id: string
  kycRequired: boolean
  on_chain_tx_hash: null | string
  status: TransactionStatus
  transaction_reference: string
  user_id: string
}

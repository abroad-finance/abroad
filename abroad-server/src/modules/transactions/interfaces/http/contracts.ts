import { TransactionStatus } from '@prisma/client'

import { PaymentContext } from '../../../payments/application/PaymentContextService'

// The runtime schema lives in application so both this transport and the
// partner MCP tool surface can validate against the same object.
export { acceptTransactionRequestSchema } from '../../application/acceptTransactionSchema'

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

export interface TransactionStatusResponse {
  id: string
  kycRequired: boolean
  on_chain_tx_hash: null | string
  status: TransactionStatus
  transaction_reference: string
  user_id: string
}

interface PaymentInstructions {
  /** EMV copy-paste PIX payload. */
  br_code: string
  /** Epoch milliseconds, or null when the code does not expire. */
  expires_at: null | number
}

import { z } from 'zod'

const hasDestinationValue = (value: null | string | undefined): boolean =>
  typeof value === 'string' && value.trim().length > 0

/**
 * Runtime shape of an accept-transaction request.
 *
 * Lives in application rather than beside the TSOA contracts because two
 * transports validate against it: the REST controller and the partner MCP tool
 * surface. Keeping it here lets the MCP path depend on the domain instead of
 * reaching into this module's HTTP layer.
 *
 * `interfaces/http/contracts.ts` re-exports it, so the wire contract and the
 * generated spec are unchanged.
 *
 * The superRefine encodes a real business rule: a transaction needs somewhere
 * to send value, and that destination arrives as a bank account, a PIX QR, or a
 * wallet address depending on the corridor direction.
 */
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

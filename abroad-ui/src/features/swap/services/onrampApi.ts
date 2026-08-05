import { z } from 'zod'

import type { ApiResult } from '@/services/http/types'

import { httpClient } from '@/services/http/httpClient'

import type { OnrampQuoteSnapshot, PaymentInstructions } from '../model/onrampQuote'

import { quoteFeeSchema } from '../model/quote'

const onrampQuoteResponseSchema = z.object({
  expiration_time: z.number().int().positive(),
  fee: quoteFeeSchema.nullable().optional(),
  quote_id: z.string().min(1).max(128),
  // The crypto the customer receives.
  value: z.number().finite().positive(),
}).loose()

const acceptOnrampResponseSchema = z.object({
  id: z.string().min(1).max(128).nullable(),
  kycRequired: z.boolean(),
  payment_instructions: z.object({
    br_code: z.string().min(1).max(4096),
    expires_at: z.number().int().positive().nullable(),
  }).nullable().optional(),
}).loose()

export type AcceptOnrampParams = {
  destinationAddress: string
  quoteId: string
  userId: string
}

export type AcceptOnrampResult = {
  kycRequired: boolean
  paymentInstructions: null | PaymentInstructions
  transactionId: null | string
}

export type RequestOnrampQuoteParams = {
  cryptoCurrency: 'USDC' | 'USDT'
  fiatAmount: number
  network: string
  signal?: AbortSignal
}

const malformedResponse = <T>(message: string): ApiResult<T> => ({
  error: { message, type: 'parse' },
  headers: null,
  ok: false,
  status: null,
})

/**
 * Creates the transaction and returns the PIX code the customer pays.
 *
 * A response that claims success without a payable code is treated as a
 * failure: showing the customer a purchase they cannot fund is worse than an
 * error they can retry.
 */
export const acceptOnrampTransaction = async (
  params: AcceptOnrampParams,
): Promise<ApiResult<AcceptOnrampResult>> => {
  const result = await httpClient.request<unknown>('/transaction', {
    body: JSON.stringify({
      destination_address: params.destinationAddress,
      quote_id: params.quoteId,
      user_id: params.userId,
    }),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  })

  if (!result.ok) return result

  const parsed = acceptOnrampResponseSchema.safeParse(result.data)
  if (!parsed.success) {
    return malformedResponse('The transaction response was not in the expected format')
  }

  if (parsed.data.kycRequired) {
    return {
      data: { kycRequired: true, paymentInstructions: null, transactionId: null },
      headers: result.headers,
      ok: true,
      status: result.status,
    }
  }

  const instructions = parsed.data.payment_instructions
  if (!instructions) {
    return malformedResponse('The purchase was accepted without a payment code')
  }

  return {
    data: {
      kycRequired: false,
      paymentInstructions: {
        brCode: instructions.br_code,
        expiresAt: instructions.expires_at,
      },
      transactionId: parsed.data.id,
    },
    headers: result.headers,
    ok: true,
    status: result.status,
  }
}

export const requestOnrampQuote = async (
  params: RequestOnrampQuoteParams,
): Promise<ApiResult<OnrampQuoteSnapshot>> => {
  const result = await httpClient.request<unknown>('/quote/onramp', {
    body: JSON.stringify({
      crypto_currency: params.cryptoCurrency,
      fiat_amount: params.fiatAmount,
      network: params.network,
      payment_method: 'PIX',
      target_currency: 'BRL',
    }),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
    ...(params.signal ? { signal: params.signal } : {}),
  })

  if (!result.ok) return result

  const parsed = onrampQuoteResponseSchema.safeParse(result.data)
  if (!parsed.success) {
    return malformedResponse('The quote response was not in the expected format')
  }

  return {
    data: {
      corridorKey: `${params.cryptoCurrency}-${params.network}-BRL-ONRAMP`,
      expiresAt: parsed.data.expiration_time,
      fee: parsed.data.fee ?? null,
      id: parsed.data.quote_id,
      network: params.network,
      rail: 'PIX',
      sourceAmount: parsed.data.value,
      sourceCurrency: params.cryptoCurrency,
      targetAmount: params.fiatAmount,
      targetCurrency: 'BRL',
    },
    headers: result.headers,
    ok: true,
    status: result.status,
  }
}

import { CryptoCurrency, SupportedCurrency, TargetCurrency } from '@prisma/client'
import { Request as RequestExpress } from 'express'
import { inject } from 'inversify'
import {
  Body,
  Controller,
  Post,
  Request,
  Res,
  Response,
  Route,
  SuccessResponse,
  TsoaResponse,
} from 'tsoa'
import z from 'zod'

import { ILogger } from '../interfaces'
import { IDatabaseClientProvider } from '../interfaces/IDatabaseClientProvider'
import { IExchangeProviderFactory } from '../interfaces/IExchangeProviderFactory'
import { TYPES } from '../types'

interface TriggerConversionResponse {
  converted_amount?: number
  estimated_fiat_amount?: number
  message?: string
  success: boolean
}

/**
 * Manually triggers processing of pending BRL conversions.
 * It will:
 *  1. Read the `pendingConversions` row for USDC -> BRL.
 *  2. Atomically reserve (set to zero) the outstanding amount.
 *  3. Fetch an indicative exchange rate from the BRL exchange provider.
 *  4. Return the reserved amount and the estimated fiat value.
 *
 * NOTE: Transfero currently performs the actual FX upon deposit; this endpoint just
 *       clears internal pending balance and provides an indicative valuation.
 */
@Route('conversions')
export class ConversionController extends Controller {
  constructor(
        @inject(TYPES.ILogger) private logger: ILogger,
        @inject(TYPES.IDatabaseClientProvider) private dbProvider: IDatabaseClientProvider,
        @inject(TYPES.IExchangeProviderFactory) private exchangeProviderFactory: IExchangeProviderFactory,
  ) { super() }

  @Post('brl/trigger')
  @Response<400, { reason: string }>(400, 'Bad Request')
  @SuccessResponse('200', 'Conversion trigger result')
  public async triggerBrlConversions(
        @Body() body: Record<string, unknown>,
        @Request() _req: RequestExpress,
        @Res() badRequest: TsoaResponse<400, { reason: string }>,
  ): Promise<TriggerConversionResponse> {
    try {
      const schema = z.object({
        amount: z.number(),
      }).loose()

      const parsed = schema.safeParse(body)
      if (!parsed.success) {
        this.logger.warn('Invalid Transfero webhook payload', {
          errors: JSON.stringify(parsed.error.issues),
        })
        return badRequest(400, { reason: 'Invalid webhook payload' })
      }

      const { amount } = parsed.data as z.output<typeof schema>

      const db = await this.dbProvider.getClient()

      const pending = await db.pendingConversions.findUnique({
        where: { source_target: { source: SupportedCurrency.USDC, target: SupportedCurrency.BRL } },
      })

      if (!pending || pending.amount <= 0) {
        return { converted_amount: 0, estimated_fiat_amount: 0, message: 'No pending BRL conversions', success: true }
      }

      const { success } = await db.$transaction(async (tx) => {
        const row = await tx.pendingConversions.findUnique({
          where: { source_target: { source: SupportedCurrency.USDC, target: SupportedCurrency.BRL } },
        })
        if (!row || row.amount <= 0) return { success: true }

        const amountToConvert = Math.min(amount, row.amount)

        const exchangeRateProvider = this.exchangeProviderFactory.getExchangeProvider(TargetCurrency.BRL)
        const { success } = await exchangeRateProvider.createMarketOrder({
          sourceAmount: amountToConvert,
          sourceCurrency: CryptoCurrency.USDC,
          targetCurrency: TargetCurrency.BRL,
        })

        if (!success) return { success: false }

        await tx.pendingConversions.update({
          data: { amount: { decrement: amountToConvert } },
          where: { source_target: { source: SupportedCurrency.USDC, target: SupportedCurrency.BRL } },
        })
        return { success: true }
      })

      return {
        success,
      }
    }
    catch (err) {
      const reason = err instanceof Error ? err.message : 'Unknown error'
      this.logger.error('[ConversionController]: Error triggering BRL conversions', err)
      return badRequest(400, { reason })
    }
  }
}

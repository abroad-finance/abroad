import { CryptoCurrency } from '@prisma/client'
import { inject, injectable } from 'inversify'
import { ZodError } from 'zod'

import { TYPES } from '../../../../app/container/types'
import { createScopedLogger, ScopedLogger } from '../../../../core/logging/scopedLogger'
import { ILogger } from '../../../../core/logging/types'
import { buildIdempotencyKey } from '../../../../platform/http/idempotencyKey'
import { TransferoUltraClient, TransferoUltraError } from '../../../transfero/infrastructure/TransferoUltraClient'
import { transferoUltraCryptoWithdrawalResponseSchema, transferoUltraOtcConfirmationResponseSchema, transferoUltraOtcSessionResponseSchema, transferoUltraOtcTradeDetailResponseSchema } from '../../../transfero/infrastructure/transferoUltraSchemas'

const ULTRA_SETTLEMENT = 'D0'
const ULTRA_SIDE = 'BUY'
const ULTRA_QUOTE_VALIDITY_SECONDS = 10

type CryptoPurchaseResult
  = | { code: PurchaseFailureCode, reason: string, success: false }
    | { quantity: number, success: true, tradeId: string }

type CryptoWithdrawalResult
  = | { code: PurchaseFailureCode, reason: string, success: false }
    | { success: true, withdrawalId: string }

type PurchaseFailureCode = 'permanent' | 'retriable' | 'validation'

/**
 * Buys stablecoin with the BRL a batch of onramps credited, and withdraws it to
 * Abroad's own custody.
 *
 * This never touches a customer's money path — the customer was already paid
 * from hot-wallet float. Ultra settles the trade and the withdrawal as two
 * independent movements (Ultra docs §1), so each is a separate call whose id
 * the caller persists before treating it as done.
 */
@injectable()
export class TransferoCryptoPurchaseService {
  private readonly logger: ScopedLogger

  public constructor(
    @inject(TransferoUltraClient) private readonly ultraClient: TransferoUltraClient,
    @inject(TYPES.ILogger) baseLogger: ILogger,
  ) {
    this.logger = createScopedLogger(baseLogger, { scope: 'TransferoCryptoPurchase' })
  }

  /**
   * Opens a D0 BUY session and confirms it into a trade. A pre-funded partner's
   * BUY debits BRZ and settles at booking (Ultra docs §2), so a confirmed trade
   * is a settled one.
   */
  public async buyWithBrl(params: {
    asset: CryptoCurrency
    brlAmount: number
    operationId: string
  }): Promise<CryptoPurchaseResult> {
    if (!Number.isFinite(params.brlAmount) || params.brlAmount <= 0) {
      return { code: 'validation', reason: 'invalid_brl_amount', success: false }
    }

    try {
      const sessionResponse = await this.ultraClient.post(
        '/api/v1/otc/sessions',
        {
          amount: params.brlAmount,
          currency: params.asset,
          settlement: ULTRA_SETTLEMENT,
          side: ULTRA_SIDE,
          validity_seconds: ULTRA_QUOTE_VALIDITY_SECONDS,
        },
        buildIdempotencyKey(['abroad', 'buy-session'], params.operationId),
      )
      const session = transferoUltraOtcSessionResponseSchema.parse(sessionResponse)

      // The desk must have priced the side and settlement we asked for; a
      // mismatch means we would be settling something we did not request.
      if (session.side !== ULTRA_SIDE || session.settlement !== ULTRA_SETTLEMENT) {
        this.logger.error('Transfero Ultra BUY session did not match the request', {
          operationId: params.operationId,
          settlement: session.settlement,
          side: session.side,
        })
        return {
          code: 'permanent',
          reason: 'transfero_ultra_buy_session_mismatch',
          success: false,
        }
      }

      const confirmationResponse = await this.ultraClient.patch(
        `/api/v1/otc/sessions/${encodeURIComponent(session.session_id)}`,
        {
          oid: params.operationId.slice(0, 128),
          side: ULTRA_SIDE,
          source: 'api',
        },
        buildIdempotencyKey(['abroad', 'buy-confirmation'], params.operationId),
      )
      const confirmation = transferoUltraOtcConfirmationResponseSchema.parse(confirmationResponse)
      const tradeId = confirmation.trade.id

      const quantity = await this.readSettledQuantity(tradeId)
      if (quantity === null) {
        // The trade exists but its quantity is not readable yet. The caller has
        // the id, so this reconciles rather than re-buying.
        return {
          code: 'retriable',
          reason: 'transfero_ultra_buy_quantity_unreadable',
          success: false,
        }
      }

      return { quantity, success: true, tradeId }
    }
    catch (error) {
      return this.toFailure(error, 'buy')
    }
  }

  /**
   * Sends purchased crypto to one of Abroad's own whitelisted addresses. Ultra
   * rejects a non-whitelisted destination outright, which is the control that
   * keeps this path from ever reaching a customer wallet.
   */
  public async withdrawToTreasury(params: {
    address: string
    amount: number
    asset: CryptoCurrency
    network: string
    operationId: string
  }): Promise<CryptoWithdrawalResult> {
    if (!Number.isFinite(params.amount) || params.amount <= 0) {
      return { code: 'validation', reason: 'invalid_withdrawal_amount', success: false }
    }

    try {
      // Shape verified against the API's own validation errors: `amount` is a
      // decimal string, the destination field is `destinationAddress`, and this
      // endpoint requires `idempotencyKey` in the body as well as the header.
      const idempotencyKey = buildIdempotencyKey(['abroad', 'treasury-withdrawal'], params.operationId)
      const response = await this.ultraClient.post(
        '/api/v1/vault/withdrawals',
        {
          amount: params.amount.toString(),
          asset: params.asset,
          blockchain: params.network,
          destinationAddress: params.address,
          idempotencyKey,
        },
        idempotencyKey,
      )
      const parsed = transferoUltraCryptoWithdrawalResponseSchema.parse(response)

      if (parsed.status === 'FAILED' || parsed.status === 'CANCELLED') {
        return {
          code: 'permanent',
          reason: `transfero_ultra_withdrawal_${parsed.status.toLowerCase()}`,
          success: false,
        }
      }

      return { success: true, withdrawalId: parsed.transactionId }
    }
    catch (error) {
      return this.toFailure(error, 'withdrawal')
    }
  }

  private async readSettledQuantity(tradeId: string): Promise<null | number> {
    try {
      const response = await this.ultraClient.get(
        `/api/v1/otc/trades/${encodeURIComponent(tradeId)}/detail`,
      )
      const parsed = transferoUltraOtcTradeDetailResponseSchema.parse(response)
      const quantity = Number(parsed.trade.cryptoReceived)
      return Number.isFinite(quantity) && quantity > 0 ? quantity : null
    }
    catch (error) {
      this.logger.warn('Could not read the settled quantity for a booked BUY', {
        reason: error instanceof Error ? error.message : 'unknown_error',
        tradeId,
      })
      return null
    }
  }

  private toFailure(
    error: unknown,
    operation: string,
  ): { code: PurchaseFailureCode, reason: string, success: false } {
    if (error instanceof TransferoUltraError) {
      return { code: error.code, reason: error.message, success: false }
    }
    if (error instanceof ZodError) {
      this.logger.error('Transfero Ultra purchase response schema mismatch', {
        issues: error.issues,
        operation,
      })
      return {
        code: 'permanent',
        reason: `transfero_ultra_${operation}_schema_mismatch`,
        success: false,
      }
    }
    return {
      code: 'retriable',
      reason: error instanceof Error ? error.message : 'unknown_error',
      success: false,
    }
  }
}

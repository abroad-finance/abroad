import { CryptoCurrency, TargetCurrency } from '@prisma/client'
import { inject, injectable } from 'inversify'
import { createHash } from 'node:crypto'
import { ZodError } from 'zod'

import { TYPES } from '../../../../app/container/types'
import { createScopedLogger, ScopedLogger } from '../../../../core/logging/scopedLogger'
import { ILogger } from '../../../../core/logging/types'
import { ILockManager } from '../../../../platform/cacheLock/ILockManager'
import { TransferoUltraClient, TransferoUltraError } from '../../../transfero/infrastructure/TransferoUltraClient'
import {
  transferoUltraBalanceResponseSchema,
  transferoUltraHoldingsSettlementResponseSchema,
  transferoUltraOtcConfirmationResponseSchema,
  transferoUltraOtcPricesResponseSchema,
  transferoUltraOtcSessionResponseSchema,
  transferoUltraVaultAddressesResponseSchema,
} from '../../../transfero/infrastructure/transferoUltraSchemas'
import {
  ExchangeAddressResult,
  ExchangeFailureCode,
  ExchangeOperationResult,
  ExchangeProviderCapability,
  IExchangeProvider,
} from '../../application/contracts/IExchangeProvider'

const ULTRA_SETTLEMENT = 'D0'
const ULTRA_SIDE = 'SELL'
const ULTRA_QUOTE_VALIDITY_SECONDS = 10
const ULTRA_SETTLEMENT_LOCK_KEY = 'transfero-ultra:otc-sale'
const ULTRA_SETTLEMENT_LOCK_TIMEOUT_MS = 60_000
const ULTRA_PRODUCTION_POLYGON_NETWORKS = new Set([
  'MAINNET',
  'POLYGON',
  'POLYGON_MAINNET',
])

type AvailableHoldingsResult
  = | Extract<ExchangeOperationResult, { success: false }>
    | { available: number, success: true }

type UltraSaleCurrency = Extract<CryptoCurrency, 'USDC' | 'USDT'>

@injectable()
export class TransferoExchangeProvider implements IExchangeProvider {
  public readonly capability: ExchangeProviderCapability = {
    blockchain: undefined,
    targetCurrency: TargetCurrency.BRL,
  }

  public readonly exchangePercentageFee = 0
  private readonly logger: ScopedLogger

  public constructor(
    @inject(TransferoUltraClient) private readonly ultraClient: TransferoUltraClient,
    @inject(TYPES.ILockManager) private readonly lockManager: ILockManager,
    @inject(TYPES.ILogger) baseLogger: ILogger,
  ) {
    this.logger = createScopedLogger(baseLogger, { scope: 'TransferoUltraExchangeProvider' })
  }

  public async createMarketOrder(params: {
    operationId: string
    sourceAmount: number
    sourceCurrency: CryptoCurrency
    targetCurrency: TargetCurrency
  }): Promise<ExchangeOperationResult> {
    if (params.targetCurrency !== TargetCurrency.BRL) {
      return this.buildOperationFailure('validation', 'transfero_ultra_only_supports_brl_sales')
    }
    if (!Number.isFinite(params.sourceAmount) || params.sourceAmount <= 0) {
      return this.buildOperationFailure('validation', 'transfero_ultra_trade_amount_must_be_positive')
    }
    if (!params.operationId.trim()) {
      return this.buildOperationFailure('validation', 'transfero_ultra_operation_id_required')
    }
    if (
      params.sourceCurrency !== CryptoCurrency.USDC
      && params.sourceCurrency !== CryptoCurrency.USDT
    ) {
      return this.buildOperationFailure(
        'validation',
        `transfero_ultra_unsupported_sale_currency:${params.sourceCurrency}`,
      )
    }

    try {
      // Ultra holdings are shared by every flow. Keep the availability read
      // and all subsequent OTC mutations in one cross-process critical section
      // so concurrent workers cannot both spend the same available balance.
      return await this.lockManager.withLock(
        ULTRA_SETTLEMENT_LOCK_KEY,
        ULTRA_SETTLEMENT_LOCK_TIMEOUT_MS,
        () => this.createMarketOrderWithLock(params),
      )
    }
    catch (error) {
      const failure = this.toOperationFailure(error)
      this.logger.warn('Transfero Ultra OTC sale failed', {
        code: failure.code,
        providerCode: error instanceof TransferoUltraError
          ? error.providerCode
          : undefined,
        status: error instanceof TransferoUltraError ? error.status : undefined,
      })
      return failure
    }
  }

  public getDepositNetwork: NonNullable<IExchangeProvider['getDepositNetwork']> = ({
    cryptoCurrency,
  }) => {
    switch (cryptoCurrency) {
      case CryptoCurrency.USDC:
      case CryptoCurrency.USDT:
        return 'POLYGON'
      default:
        return undefined
    }
  }

  public getExchangeAddress: IExchangeProvider['getExchangeAddress'] = async ({
    blockchain,
    cryptoCurrency,
  }): Promise<ExchangeAddressResult> => {
    if (blockchain !== 'POLYGON') {
      return this.buildAddressFailure(
        'validation',
        `transfero_ultra_unsupported_blockchain:${blockchain}`,
      )
    }

    try {
      const response = await this.ultraClient.get('/api/v1/vault/addresses')
      const addresses = transferoUltraVaultAddressesResponseSchema.parse(response)
      const address = addresses.find(candidate =>
        candidate.asset.toUpperCase() === cryptoCurrency
        && candidate.blockchain.toUpperCase() === 'POLYGON'
        && this.isProductionPolygonNetwork(candidate.network))
      if (!address) {
        return this.buildAddressFailure(
          'permanent',
          `transfero_ultra_polygon_address_missing:${cryptoCurrency}`,
        )
      }

      return {
        address: address.address,
        memo: address.tag ?? undefined,
        success: true,
      }
    }
    catch (error) {
      if (error instanceof TransferoUltraError) {
        return this.buildAddressFailure(error.code, error.message)
      }
      if (error instanceof ZodError) {
        this.logger.error('Transfero Ultra vault address schema mismatch', {
          issues: error.issues,
        })
        return this.buildAddressFailure(
          'permanent',
          'transfero_ultra_vault_address_schema_mismatch',
        )
      }
      return this.buildAddressFailure(
        'retriable',
        error instanceof Error ? error.message : 'transfero_ultra_vault_address_error',
      )
    }
  }

  public getExchangeRate: IExchangeProvider['getExchangeRate'] = async ({
    sourceCurrency,
    targetCurrency,
  }): Promise<number> => {
    if (targetCurrency !== TargetCurrency.BRL) {
      throw new Error('Transfero Ultra only quotes stablecoin sales into BRL')
    }

    try {
      const response = await this.ultraClient.get('/api/v1/otc/prices', {
        side: ULTRA_SIDE,
      })
      const prices = transferoUltraOtcPricesResponseSchema.parse(response)
      const brlPerStablecoin = prices.prices[sourceCurrency]?.D0.price
      if (!brlPerStablecoin || !Number.isFinite(brlPerStablecoin)) {
        throw new Error(`Transfero Ultra D0 SELL price missing for ${sourceCurrency}`)
      }

      // QuoteUseCase consumes stablecoin-per-fiat. Ultra publishes the inverse:
      // BRL per stablecoin, so invert the all-in D0 SELL desk price once.
      return 1 / brlPerStablecoin
    }
    catch (error) {
      this.logger.error('Transfero Ultra exchange-rate request failed', {
        error: error instanceof Error ? error.message : 'unknown_error',
        sourceCurrency,
        targetCurrency,
      })
      throw new Error(
        `Failed to get Transfero Ultra exchange rate: ${
          error instanceof Error ? error.message : 'unknown_error'
        }`,
      )
    }
  }

  private buildAddressFailure(
    code: ExchangeFailureCode,
    reason: string,
  ): ExchangeAddressResult {
    return { code, reason, success: false }
  }

  private buildIdempotencyKey(operationId: string, phase: string): string {
    const candidate = `abroad:otc:${operationId}:${phase}`
    if (candidate.length <= 255) {
      return candidate
    }
    return `abroad:otc:${createHash('sha256').update(operationId).digest('hex')}:${phase}`
  }

  private buildOperationFailure(
    code: ExchangeFailureCode,
    reason: string,
  ): Extract<ExchangeOperationResult, { success: false }> {
    return { code, reason, success: false }
  }

  private coversRequestedAmount(actualAmount: number | string, requestedAmount: number): boolean {
    const actual = Number(actualAmount)
    if (!Number.isFinite(actual)) return false

    // Ultra reports fixed-point crypto strings while the flow stores a JS
    // number. One atomic-unit tolerance avoids a false partial caused only by
    // representation, without accepting an economically meaningful shortfall.
    const atomicTolerance = 1e-8
    return actual + atomicTolerance >= requestedAmount
  }

  private async createMarketOrderWithLock(params: {
    operationId: string
    sourceAmount: number
    sourceCurrency: UltraSaleCurrency
    targetCurrency: TargetCurrency
  }): Promise<ExchangeOperationResult> {
    const holdings = await this.readAvailableHoldings(params.sourceCurrency)
    if (!holdings.success) {
      return holdings
    }
    if (!this.coversRequestedAmount(holdings.available, params.sourceAmount)) {
      this.logger.info('Transfero Ultra OTC sale waiting for available holdings', {
        availableAmount: holdings.available,
        requestedAmount: params.sourceAmount,
        sourceCurrency: params.sourceCurrency,
      })
      return this.buildOperationFailure(
        'insufficient_balance',
        'transfero_ultra_insufficient_available_holdings',
      )
    }

    const sessionResponse = await this.ultraClient.post(
      '/api/v1/otc/sessions',
      {
        amount: params.sourceAmount,
        currency: params.sourceCurrency,
        settlement: ULTRA_SETTLEMENT,
        side: ULTRA_SIDE,
        validity_seconds: ULTRA_QUOTE_VALIDITY_SECONDS,
      },
      this.buildIdempotencyKey(params.operationId, 'session'),
    )
    const session = transferoUltraOtcSessionResponseSchema.parse(sessionResponse)
    const sessionMismatch = this.describeSessionMismatch(session, params)
    if (sessionMismatch) {
      this.logger.error('Transfero Ultra OTC session did not match request', {
        operationId: params.operationId,
        reason: sessionMismatch,
        sessionId: session.session_id,
      })
      return this.buildOperationFailure(
        'permanent',
        `transfero_ultra_otc_session_mismatch:${sessionMismatch}`,
      )
    }

    const confirmationResponse = await this.ultraClient.patch(
      `/api/v1/otc/sessions/${encodeURIComponent(session.session_id)}`,
      {
        oid: params.operationId.slice(0, 128),
        side: ULTRA_SIDE,
        source: 'api',
      },
      this.buildIdempotencyKey(params.operationId, 'confirmation'),
    )
    const confirmation = transferoUltraOtcConfirmationResponseSchema.parse(
      confirmationResponse,
    )

    const settlementResponse = await this.ultraClient.post(
      `/api/v1/otc/trades/${encodeURIComponent(confirmation.trade.id)}/settle-from-holdings`,
      undefined,
      this.buildIdempotencyKey(params.operationId, 'settlement'),
    )
    const settledAmount = transferoUltraHoldingsSettlementResponseSchema
      .parse(settlementResponse)
      .swept
    if (!this.coversRequestedAmount(settledAmount, params.sourceAmount)) {
      this.logger.error('Transfero Ultra trade was not fully settled from holdings', {
        requestedAmount: params.sourceAmount,
        settledAmount,
        tradeId: confirmation.trade.id,
      })
      return this.buildOperationFailure(
        'permanent',
        `transfero_ultra_partial_holdings_settlement:${settledAmount}`,
      )
    }

    this.logger.info('Transfero Ultra OTC sale settled from holdings', {
      sessionId: session.session_id,
      settledAmount,
      tradeId: confirmation.trade.id,
    })
    return { success: true }
  }

  private describeSessionMismatch(
    session: {
      amount: number
      currency: 'USDC' | 'USDT'
      settlement: 'D0' | 'D1' | 'D2'
      side: 'BUY' | 'SELL'
    },
    request: {
      sourceAmount: number
      sourceCurrency: CryptoCurrency
    },
  ): string | undefined {
    if (session.currency !== request.sourceCurrency) {
      return 'currency'
    }
    if (session.side !== ULTRA_SIDE) {
      return 'side'
    }
    if (session.settlement !== ULTRA_SETTLEMENT) {
      return 'settlement'
    }
    return Math.abs(session.amount - request.sourceAmount) > 1e-8
      ? 'amount'
      : undefined
  }

  private isProductionPolygonNetwork(network: string): boolean {
    return ULTRA_PRODUCTION_POLYGON_NETWORKS.has(network.trim().toUpperCase())
  }

  private async readAvailableHoldings(
    sourceCurrency: UltraSaleCurrency,
  ): Promise<AvailableHoldingsResult> {
    const response = await this.ultraClient.get('/api/v1/balance')
    const parsed = transferoUltraBalanceResponseSchema.safeParse(response)
    if (!parsed.success) {
      this.logger.error('Transfero Ultra balance response schema mismatch', {
        issues: parsed.error.issues,
      })
      return this.buildOperationFailure(
        'permanent',
        'transfero_ultra_balance_schema_mismatch',
      )
    }

    const row = parsed.data.find(balance =>
      balance.asset.trim().toUpperCase() === sourceCurrency)
    if (!row) {
      return this.buildOperationFailure(
        'permanent',
        `transfero_ultra_balance_asset_missing:${sourceCurrency}`,
      )
    }

    const available = Number(row.available)
    if (!Number.isFinite(available) || available < 0) {
      return this.buildOperationFailure(
        'permanent',
        `transfero_ultra_available_balance_invalid:${sourceCurrency}`,
      )
    }

    return { available, success: true }
  }

  private toOperationFailure(
    error: unknown,
  ): Extract<ExchangeOperationResult, { success: false }> {
    if (error instanceof TransferoUltraError) {
      return this.buildOperationFailure(error.code, error.message)
    }
    if (error instanceof ZodError) {
      this.logger.error('Transfero Ultra OTC response schema mismatch', {
        issues: error.issues,
      })
      return this.buildOperationFailure(
        'permanent',
        'transfero_ultra_otc_schema_mismatch',
      )
    }
    return this.buildOperationFailure(
      'retriable',
      error instanceof Error ? error.message : 'transfero_ultra_otc_unknown_error',
    )
  }
}

import { CryptoCurrency, TargetCurrency } from '@prisma/client'
import { inject, injectable } from 'inversify'
import { createHash } from 'node:crypto'
import { z, ZodError } from 'zod'

import { TYPES } from '../../../../app/container/types'
import { createScopedLogger, ScopedLogger } from '../../../../core/logging/scopedLogger'
import { ILogger } from '../../../../core/logging/types'
import { ILockManager } from '../../../../platform/cacheLock/ILockManager'
import { TransferoUltraClient, TransferoUltraError } from '../../../transfero/infrastructure/TransferoUltraClient'
import {
  transferoUltraBalanceResponseSchema,
  transferoUltraDecimalSchema,
  transferoUltraHoldingsSettlementResponseSchema,
  transferoUltraOtcConfirmationResponseSchema,
  transferoUltraOtcPricesResponseSchema,
  transferoUltraOtcSessionResponseSchema,
  transferoUltraOtcTradeDetailResponseSchema,
  transferoUltraVaultAddressesResponseSchema,
} from '../../../transfero/infrastructure/transferoUltraSchemas'
import {
  ExchangeAddressResult,
  ExchangeFailureCode,
  ExchangeOperationResult,
  ExchangeProviderCapability,
  ExchangeSettlementEconomics,
  ExchangeSettlementFactsResult,
  ExchangeSettlementReconciliation,
  IExchangeProvider,
} from '../../application/contracts/IExchangeProvider'

const ULTRA_SETTLEMENT = 'D0'
const ULTRA_SIDE = 'SELL'
const ULTRA_TRADE_ID_SCHEMA = z.string().uuid()
const ULTRA_QUOTE_VALIDITY_SECONDS = 10
const ULTRA_SETTLEMENT_LOCK_KEY = 'transfero-ultra:otc-sale'
const ULTRA_SETTLEMENT_LOCK_TIMEOUT_MS = 60_000
const ULTRA_MAX_SETTLEMENT_ATTEMPTS = 1_000_000
const ULTRA_PRODUCTION_POLYGON_NETWORKS = new Set([
  'MAINNET',
  'POLYGON',
  'POLYGON_MAINNET',
])

type AvailableHoldingsResult
  = | ExchangeOperationFailure
    | { available: number, outcome: 'succeeded' }
type ExchangeOperationFailure = Extract<ExchangeOperationResult, { outcome: 'failed' }>

type ExchangeOperationPending = Extract<ExchangeOperationResult, { outcome: 'pending' }>

type TradeSettlementReadResult
  = | { economics?: ExchangeSettlementEconomics, settledSourceAmount: string, success: true }
    | { failure: ExchangeOperationFailure, success: false }

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
    reconciliation?: ExchangeSettlementReconciliation
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
    const reconciliationMismatch = this.describeReconciliationMismatch(
      params.reconciliation,
      params.sourceAmount,
    )
    if (reconciliationMismatch) {
      return this.buildOperationFailure(
        'validation',
        `transfero_ultra_reconciliation_invalid:${reconciliationMismatch}`,
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

  public async getSettlementFacts(params: {
    providerOperationId: string
    requestedAmount: number
    sourceCurrency: CryptoCurrency
  }): Promise<ExchangeSettlementFactsResult> {
    if (
      params.sourceCurrency !== CryptoCurrency.USDC
      && params.sourceCurrency !== CryptoCurrency.USDT
    ) {
      return { reason: 'unsupported_source_currency', success: false }
    }
    try {
      const result = await this.readTradeSettlement({
        providerOperationId: params.providerOperationId,
        requestedAmount: params.requestedAmount,
        sourceCurrency: params.sourceCurrency,
      })
      if (!result.success) {
        return { reason: 'trade_not_settled', success: false }
      }
      return {
        ...(result.economics ? { economics: result.economics } : {}),
        settledSourceAmount: result.settledSourceAmount,
        success: true,
      }
    }
    catch {
      return {
        reason: 'trade_read_failed',
        success: false,
      }
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
  ): ExchangeOperationFailure {
    return { code, outcome: 'failed', reason }
  }

  private buildPendingReconciliation(params: {
    economics?: ExchangeSettlementEconomics
    nextSettlementAttempt: number
    providerOperationId: string
    settledSourceAmount: string
  }): ExchangeOperationPending {
    return {
      outcome: 'pending',
      reconciliation: {
        ...(params.economics ? { economics: params.economics } : {}),
        nextSettlementAttempt: params.nextSettlementAttempt,
        providerOperationId: params.providerOperationId,
        settledSourceAmount: params.settledSourceAmount,
      },
    }
  }

  private buildSuccessfulReconciliation(params: {
    economics?: ExchangeSettlementEconomics
    nextSettlementAttempt: number
    providerOperationId: string
    settledSourceAmount: string
  }): Extract<ExchangeOperationResult, { outcome: 'succeeded' }> {
    return {
      outcome: 'succeeded',
      reconciliation: {
        ...(params.economics ? { economics: params.economics } : {}),
        nextSettlementAttempt: params.nextSettlementAttempt,
        providerOperationId: params.providerOperationId,
        settledSourceAmount: params.settledSourceAmount,
      },
    }
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
    reconciliation?: ExchangeSettlementReconciliation
    sourceAmount: number
    sourceCurrency: UltraSaleCurrency
    targetCurrency: TargetCurrency
  }): Promise<ExchangeOperationResult> {
    if (params.reconciliation) {
      return this.reconcileBookedTrade({
        nextSettlementAttempt: params.reconciliation.nextSettlementAttempt,
        ...(params.reconciliation.economics
          ? { economics: params.reconciliation.economics }
          : {}),
        operationId: params.operationId,
        providerOperationId: params.reconciliation.providerOperationId,
        requestedAmount: params.sourceAmount,
        settledSourceAmount: params.reconciliation.settledSourceAmount,
        sourceCurrency: params.sourceCurrency,
      })
    }

    const holdings = await this.readAvailableHoldings(params.sourceCurrency)
    if (holdings.outcome === 'failed') {
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

    return this.reconcileBookedTrade({
      economics: {
        lockedRateNativePerUsd: String(session.price),
        payoutCurrency: TargetCurrency.BRL,
        providerProceedsNative: String(session.total_brl),
      },
      nextSettlementAttempt: 0,
      operationId: params.operationId,
      providerOperationId: confirmation.trade.id,
      requestedAmount: params.sourceAmount,
      settledSourceAmount: '0',
      sourceCurrency: params.sourceCurrency,
    }, {
      creditSettled: confirmation.creditSettled === true,
      sessionId: session.session_id,
    })
  }

  private describeReconciliationMismatch(
    reconciliation: ExchangeSettlementReconciliation | undefined,
    requestedAmount: number,
  ): string | undefined {
    if (!reconciliation) {
      return undefined
    }
    if (
      !Number.isSafeInteger(reconciliation.nextSettlementAttempt)
      || reconciliation.nextSettlementAttempt < 0
      || reconciliation.nextSettlementAttempt > ULTRA_MAX_SETTLEMENT_ATTEMPTS
    ) {
      return 'next_settlement_attempt'
    }
    if (!ULTRA_TRADE_ID_SCHEMA.safeParse(reconciliation.providerOperationId).success) {
      return 'provider_operation_id'
    }
    if (!transferoUltraDecimalSchema.safeParse(
      reconciliation.settledSourceAmount,
    ).success) {
      return 'settled_source_amount'
    }
    const settledSourceAmount = Number(reconciliation.settledSourceAmount)
    if (
      !Number.isFinite(settledSourceAmount)
      || settledSourceAmount < 0
      || settledSourceAmount > requestedAmount + 1e-8
    ) {
      return 'settled_source_amount'
    }
    return undefined
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

  private describeTradeDetailMismatch(
    trade: {
      amountUsd: string
      cryptoReceived: string
      currency: 'USDC' | 'USDT'
      id: string
      side: 'BUY' | 'SELL'
    },
    expected: {
      providerOperationId: string
      requestedAmount: number
      sourceCurrency: UltraSaleCurrency
    },
  ): string | undefined {
    if (trade.id !== expected.providerOperationId) {
      return 'trade_id'
    }
    if (trade.currency !== expected.sourceCurrency) {
      return 'currency'
    }
    if (trade.side !== ULTRA_SIDE) {
      return 'side'
    }
    if (Math.abs(Number(trade.amountUsd) - expected.requestedAmount) > 1e-8) {
      return 'amount'
    }
    const settledSourceAmount = Number(trade.cryptoReceived)
    if (
      !Number.isFinite(settledSourceAmount)
      || settledSourceAmount < 0
      || settledSourceAmount > expected.requestedAmount + 1e-8
    ) {
      return 'crypto_received'
    }
    return undefined
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

    return { available, outcome: 'succeeded' }
  }

  private async readTradeSettlement(params: {
    providerOperationId: string
    requestedAmount: number
    sourceCurrency: UltraSaleCurrency
  }): Promise<TradeSettlementReadResult> {
    const response = await this.ultraClient.get(
      `/api/v1/otc/trades/${encodeURIComponent(params.providerOperationId)}/detail`,
    )
    const detail = transferoUltraOtcTradeDetailResponseSchema.parse(response)
    const mismatch = this.describeTradeDetailMismatch(detail.trade, params)
    if (mismatch) {
      this.logger.error('Transfero Ultra trade detail did not match reconciliation', {
        providerOperationId: params.providerOperationId,
        reason: mismatch,
      })
      return {
        failure: this.buildOperationFailure(
          'permanent',
          `transfero_ultra_trade_reconciliation_mismatch:${mismatch}`,
        ),
        success: false,
      }
    }
    const lockedRate = this.toPositiveDecimalString(detail.trade.price)
    const providerProceeds = this.toPositiveDecimalString(
      detail.trade.totalBrl ?? detail.trade.total_brl,
    )
    return {
      ...(lockedRate && providerProceeds
        ? {
            economics: {
              lockedRateNativePerUsd: lockedRate,
              payoutCurrency: TargetCurrency.BRL,
              providerProceedsNative: providerProceeds,
            },
          }
        : {}),
      settledSourceAmount: detail.trade.cryptoReceived,
      success: true,
    }
  }

  private async reconcileBookedTrade(
    params: {
      economics?: ExchangeSettlementEconomics
      nextSettlementAttempt: number
      operationId: string
      providerOperationId: string
      requestedAmount: number
      settledSourceAmount: string
      sourceCurrency: UltraSaleCurrency
    },
    bookingContext?: {
      creditSettled: boolean
      sessionId: string
    },
  ): Promise<ExchangeOperationResult> {
    let beforeSettlement: TradeSettlementReadResult
    try {
      beforeSettlement = await this.readTradeSettlement(params)
    }
    catch (error) {
      const failure = this.toOperationFailure(error)
      this.logger.warn('Transfero Ultra booked trade reconciliation is temporarily unavailable', {
        code: failure.code,
        nextSettlementAttempt: params.nextSettlementAttempt,
        providerOperationId: params.providerOperationId,
      })
      return this.buildPendingReconciliation(params)
    }
    if (!beforeSettlement.success) {
      return beforeSettlement.failure
    }
    if (this.coversRequestedAmount(
      beforeSettlement.settledSourceAmount,
      params.requestedAmount,
    )) {
      this.logger.info('Transfero Ultra OTC sale source obligation is settled', {
        creditSettled: bookingContext?.creditSettled,
        providerOperationId: params.providerOperationId,
        sessionId: bookingContext?.sessionId,
        settledSourceAmount: beforeSettlement.settledSourceAmount,
      })
      return this.buildSuccessfulReconciliation({
        ...params,
        economics: beforeSettlement.economics ?? params.economics,
        settledSourceAmount: beforeSettlement.settledSourceAmount,
      })
    }

    const followingAttempt = params.nextSettlementAttempt + 1
    if (followingAttempt > ULTRA_MAX_SETTLEMENT_ATTEMPTS) {
      return this.buildOperationFailure(
        'permanent',
        'transfero_ultra_settlement_attempt_limit_reached',
      )
    }

    let sweptAmount: string | undefined
    try {
      const settlementResponse = await this.ultraClient.post(
        `/api/v1/otc/trades/${encodeURIComponent(params.providerOperationId)}/settle-from-holdings`,
        undefined,
        this.buildIdempotencyKey(
          params.operationId,
          `settlement:${params.nextSettlementAttempt}`,
        ),
      )
      const parsedSettlement = transferoUltraHoldingsSettlementResponseSchema.safeParse(
        settlementResponse,
      )
      if (parsedSettlement.success) {
        sweptAmount = parsedSettlement.data.swept
      }
      else {
        this.logger.error('Transfero Ultra holdings settlement response schema mismatch', {
          issues: parsedSettlement.error.issues,
          providerOperationId: params.providerOperationId,
        })
      }
    }
    catch (error) {
      const failure = this.toOperationFailure(error)
      this.logger.warn('Transfero Ultra holdings settlement attempt is ambiguous', {
        code: failure.code,
        providerOperationId: params.providerOperationId,
        settlementAttempt: params.nextSettlementAttempt,
      })
    }

    let afterSettlement: TradeSettlementReadResult
    try {
      afterSettlement = await this.readTradeSettlement(params)
    }
    catch (error) {
      const failure = this.toOperationFailure(error)
      this.logger.warn('Transfero Ultra post-settlement reconciliation is temporarily unavailable', {
        code: failure.code,
        providerOperationId: params.providerOperationId,
        settlementAttempt: params.nextSettlementAttempt,
        sweptAmount,
      })
      return this.buildPendingReconciliation({
        ...params,
        economics: beforeSettlement.economics ?? params.economics,
        nextSettlementAttempt: followingAttempt,
        settledSourceAmount: beforeSettlement.settledSourceAmount,
      })
    }
    if (!afterSettlement.success) {
      return afterSettlement.failure
    }
    if (this.coversRequestedAmount(
      afterSettlement.settledSourceAmount,
      params.requestedAmount,
    )) {
      this.logger.info('Transfero Ultra OTC sale source obligation is settled', {
        creditSettled: bookingContext?.creditSettled,
        providerOperationId: params.providerOperationId,
        sessionId: bookingContext?.sessionId,
        settledSourceAmount: afterSettlement.settledSourceAmount,
        settlementAttempt: params.nextSettlementAttempt,
        sweptAmount,
      })
      return this.buildSuccessfulReconciliation({
        ...params,
        economics: afterSettlement.economics ?? beforeSettlement.economics ?? params.economics,
        nextSettlementAttempt: followingAttempt,
        settledSourceAmount: afterSettlement.settledSourceAmount,
      })
    }

    this.logger.warn('Transfero Ultra OTC sale is waiting for source settlement', {
      providerOperationId: params.providerOperationId,
      requestedAmount: params.requestedAmount,
      settledSourceAmount: afterSettlement.settledSourceAmount,
      settlementAttempt: params.nextSettlementAttempt,
      sweptAmount,
    })
    return this.buildPendingReconciliation({
      ...params,
      economics: afterSettlement.economics ?? beforeSettlement.economics ?? params.economics,
      nextSettlementAttempt: followingAttempt,
      settledSourceAmount: afterSettlement.settledSourceAmount,
    })
  }

  private toOperationFailure(
    error: unknown,
  ): ExchangeOperationFailure {
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

  private toPositiveDecimalString(value: number | string | undefined): string | undefined {
    if (value === undefined) return undefined
    const normalized = String(value)
    const parsed = transferoUltraDecimalSchema.safeParse(normalized)
    return parsed.success && Number(normalized) > 0 ? parsed.data : undefined
  }
}

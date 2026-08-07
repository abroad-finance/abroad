import { Prisma } from '@prisma/client'
import { inject, injectable } from 'inversify'

import { TYPES } from '../../../app/container/types'
import { ApplicationError } from '../../../core/errors'
import { createScopedLogger, ScopedLogger } from '../../../core/logging/scopedLogger'
import { ILogger } from '../../../core/logging/types'
import { IDatabaseClientProvider } from '../../../platform/persistence/IDatabaseClientProvider'
import { IStablebondVenue } from './contracts/IStablebondVenue'
import { JustInTimeUnwindService, StablebondExecutionOutcome } from './JustInTimeUnwindService'
import { readStablebondConfig } from './stablebondConfig'
import { StablebondPositionService } from './StablebondPositionService'
import { YieldAccrualService } from './YieldAccrualService'

export type OpsStablebondAcquireInput = {
  /** How much of the quote asset (USDC) to spend on bond tokens. */
  spendUsdc: number
}

export type OpsStablebondResponse = {
  /** Why the position is switched off, when it is. Null when enabled. */
  disabledReason: null | string
  enabled: boolean
  /** Set when the position is enabled but currently unreadable. Never rendered as a zero. */
  error: null | string
  position: null | OpsStablebondPositionDto
  recentUnwinds: OpsStablebondUnwindDto[]
}

export type OpsStablebondTrustlineDto = {
  balance: null | number
  limit: null | number
  onChainId: null | string
  outcome: string
  reason: null | string
}

export type OpsStablebondUnwindInput = {
  /** How much USDC the unwind must raise. */
  requiredUsdc: number
}

export type OpsStablebondUnwindResultDto = {
  executionId: null | string
  onChainId: null | string
  outcome: string
  reason: null | string
  receivedAmount: null | number
  spreadBps: null | number
}

type OpsStablebondPositionDto = {
  /** Yield since the basis was registered, in the bond's currency and in USD. */
  accruedFiat: number
  accruedUsd: number
  /** Rate the issuer publishes right now, in basis points. */
  annualYieldBps: number
  assetCode: string
  /** Rate actually realised since basis, annualised. Null until an hour has passed. */
  effectiveAnnualBps: null | number
  entryNavFiat: null | number
  fiatCurrency: string
  heldTokens: number
  issuer: string
  /** Ceiling on how much payout capacity the position may be relied on to raise. */
  jitUnwindCapUsdc: number
  maxSlippageBps: number
  navFiat: number
  navObservedAt: Date
  navUsd: number
  openedAt: Date | null
  principalFiat: null | number
  status: string
  symbol: string
  /** Live: what the position could actually raise right now, inside the bound. */
  unwindable: OpsStablebondUnwindabilityDto
  valueFiat: number
  valueUsd: number
  venue: string
}

type OpsStablebondUnwindabilityDto = {
  feasible: boolean
  reason: null | string
  spreadBps: null | number
  /** The size the feasibility quote was taken at. */
  testedUsdc: number
}

type OpsStablebondUnwindDto = {
  direction: string
  failureReason: null | string
  id: string
  minReceive: number
  navUsdPerToken: number
  /** Public ledger identifier, so an operator can open the execution in an explorer. */
  onChainId: null | string
  quotedAt: Date
  quotedReceive: number
  receiveAsset: string
  receivedAmount: null | number
  sendAmount: number
  sendAsset: string
  settledAt: Date | null
  /** Executed price against NAV. Positive means the unwind sold below NAV. */
  spreadBps: null | number
  status: string
}

class OpsStablebondRefusedError extends ApplicationError {
  public constructor(reason: string) {
    super(409, 'ops_stablebond_refused', `The Stablebond operation was refused: ${reason}`)
    this.name = 'OpsStablebondRefusedError'
  }
}

class OpsStablebondValidationError extends ApplicationError {
  public constructor(message: string) {
    super(400, 'ops_stablebond_invalid', message)
    this.name = 'OpsStablebondValidationError'
  }
}

const FEASIBILITY_CACHE_TTL_MS = 30_000
const MAX_EXECUTION_REQUEST_USDC = 10_000_000
const RECENT_UNWIND_LIMIT = 20

/**
 * Read model for the ops Stablebond panel: what the position is worth, what it
 * has accrued, and — the number that matters most — what it could actually be
 * unwound for right now.
 *
 * Honest by construction. An unreadable position surfaces as an error rather
 * than as a zero position, and the recent-unwind list carries the spread each
 * execution actually paid, not just the yield it earned.
 */
@injectable()
export class OpsStablebondService {
  private feasibilityCache?: { at: number, value: OpsStablebondUnwindabilityDto }
  private readonly logger: ScopedLogger

  constructor(
    @inject(StablebondPositionService) private readonly positionService: StablebondPositionService,
    @inject(YieldAccrualService) private readonly accrualService: YieldAccrualService,
    @inject(JustInTimeUnwindService) private readonly unwindService: JustInTimeUnwindService,
    @inject(TYPES.IStablebondVenue) private readonly venue: IStablebondVenue,
    @inject(TYPES.IDatabaseClientProvider) private readonly dbProvider: IDatabaseClientProvider,
    @inject(TYPES.ILogger) baseLogger: ILogger,
  ) {
    this.logger = createScopedLogger(baseLogger, { scope: 'OpsStablebond' })
  }

  /**
   * Buys into the position with `spendUsdc` of the quote asset.
   *
   * This moves real treasury funds, bounded the same three ways the unwind is:
   * the live quote, the slippage tolerance, and the on-chain floor.
   */
  public async acquire(
    input: OpsStablebondAcquireInput,
    idempotencyKey: string,
  ): Promise<OpsStablebondUnwindResultDto> {
    this.assertAmount(input.spendUsdc, 'spendUsdc')
    this.assertIdempotencyKey(idempotencyKey)

    return this.toResultDto(await this.unwindService.acquire({
      idempotencyKey: `ops:${idempotencyKey.trim()}`,
      spendQuoteAsset: new Prisma.Decimal(String(input.spendUsdc)),
    }))
  }

  public async getOverview(): Promise<OpsStablebondResponse> {
    const configResult = readStablebondConfig()
    if (!configResult.enabled) {
      return {
        disabledReason: configResult.reason,
        enabled: false,
        error: null,
        position: null,
        recentUnwinds: [],
      }
    }

    const read = await this.positionService.read()
    if (!read.success) {
      this.logger.warn('Stablebond position is enabled but unreadable', { reason: read.reason })
      return {
        disabledReason: null,
        enabled: true,
        error: read.reason,
        position: null,
        recentUnwinds: await this.loadRecentUnwinds(),
      }
    }

    const { config, record, valuation } = read.position
    const accrual = this.accrualService.accrue(read.position)
    const unwindable = await this.probeUnwindability(config.jitUnwindCapUsdc)

    return {
      disabledReason: null,
      enabled: true,
      error: null,
      position: {
        accruedFiat: accrual.accruedFiat.toNumber(),
        accruedUsd: accrual.accruedUsd.toNumber(),
        annualYieldBps: accrual.annualYieldBps,
        assetCode: config.assetCode,
        effectiveAnnualBps: accrual.effectiveAnnualBps,
        entryNavFiat: record ? new Prisma.Decimal(record.entryNavFiat).toNumber() : null,
        fiatCurrency: config.fiatCurrency,
        heldTokens: accrual.heldTokens.toNumber(),
        issuer: config.issuer,
        jitUnwindCapUsdc: config.jitUnwindCapUsdc,
        maxSlippageBps: config.maxSlippageBps,
        navFiat: valuation.navFiat.toNumber(),
        navObservedAt: valuation.observedAt,
        navUsd: valuation.navUsd.toNumber(),
        openedAt: record?.openedAt ?? null,
        principalFiat: accrual.principalFiat?.toNumber() ?? null,
        status: record?.status ?? 'UNREGISTERED',
        symbol: config.symbol,
        unwindable,
        valueFiat: accrual.valueFiat.toNumber(),
        valueUsd: accrual.valueUsd.toNumber(),
        venue: config.venue,
      },
      recentUnwinds: await this.loadRecentUnwinds(),
    }
  }

  /**
   * Opens the trustline the position needs, if it is missing.
   *
   * Moves no value — it commits a base reserve — but it is still a signed
   * mainnet operation, so it goes through the same step-up path as everything
   * else that touches the treasury account.
   */
  public async openTrustline(): Promise<OpsStablebondTrustlineDto> {
    const result = await this.venue.ensureTrustline()
    this.feasibilityCache = undefined

    return {
      balance: result.outcome === 'present' ? result.balance.toNumber() : null,
      limit: result.outcome === 'present' ? result.limit.toNumber() : null,
      onChainId: 'onChainId' in result ? result.onChainId : null,
      outcome: result.outcome,
      reason: 'reason' in result ? result.reason : null,
    }
  }

  /**
   * Records what the currently held tokens cost, at the live NAV.
   *
   * Moves no money. It does reset the accrual baseline, which is why it is a
   * step-up mutation rather than a background job: re-basing a position silently
   * would erase yield the treasury had already earned on paper.
   */
  public async registerBasis(): Promise<OpsStablebondResponse> {
    const result = await this.positionService.registerBasis()
    if (!result.success) {
      throw new OpsStablebondRefusedError(result.reason)
    }
    // Re-read through the normal path so the caller gets the same shape the
    // panel renders, including a fresh feasibility probe.
    this.feasibilityCache = undefined
    return this.getOverview()
  }

  /**
   * Sells part of the position for USDC, right now.
   *
   * This moves real treasury funds. It is bounded three ways before anything is
   * submitted: the configured JIT cap, a live quote against the real order book,
   * and the slippage tolerance — and the tolerance is also sent on chain, so the
   * network refuses a fill past the bound even if the book moves after we quoted.
   */
  public async unwind(
    input: OpsStablebondUnwindInput,
    idempotencyKey: string,
  ): Promise<OpsStablebondUnwindResultDto> {
    this.assertAmount(input.requiredUsdc, 'requiredUsdc')
    this.assertIdempotencyKey(idempotencyKey)

    return this.toResultDto(await this.unwindService.unwind({
      // Scoped so an ops-triggered execution can never collide with a key minted
      // by another caller for a different purpose.
      idempotencyKey: `ops:${idempotencyKey.trim()}`,
      requiredUsdc: new Prisma.Decimal(String(input.requiredUsdc)),
    }))
  }

  private assertAmount(value: number, field: string): void {
    if (!Number.isFinite(value) || value <= 0) {
      throw new OpsStablebondValidationError(`${field} must be a positive number`)
    }
    if (value > MAX_EXECUTION_REQUEST_USDC) {
      throw new OpsStablebondValidationError(`${field} exceeds the maximum a single execution may request`)
    }
  }

  private assertIdempotencyKey(idempotencyKey: string): void {
    if (!idempotencyKey.trim()) {
      throw new OpsStablebondValidationError('An idempotency key is required for this operation')
    }
  }

  private async loadRecentUnwinds(): Promise<OpsStablebondUnwindDto[]> {
    const client = await this.dbProvider.getClient()
    const rows = await client.stablebondExecution.findMany({
      orderBy: { quotedAt: 'desc' },
      select: {
        direction: true,
        failureReason: true,
        id: true,
        minReceive: true,
        navUsdPerToken: true,
        onChainId: true,
        quotedAt: true,
        quotedReceive: true,
        receiveAsset: true,
        receivedAmount: true,
        sendAmount: true,
        sendAsset: true,
        settledAt: true,
        spreadBps: true,
        status: true,
      },
      take: RECENT_UNWIND_LIMIT,
    })

    return rows.map(row => ({
      direction: row.direction,
      failureReason: row.failureReason,
      id: row.id,
      minReceive: new Prisma.Decimal(row.minReceive).toNumber(),
      navUsdPerToken: new Prisma.Decimal(row.navUsdPerToken).toNumber(),
      onChainId: row.onChainId,
      quotedAt: row.quotedAt,
      quotedReceive: new Prisma.Decimal(row.quotedReceive).toNumber(),
      receiveAsset: row.receiveAsset,
      receivedAmount: row.receivedAmount === null ? null : new Prisma.Decimal(row.receivedAmount).toNumber(),
      sendAmount: new Prisma.Decimal(row.sendAmount).toNumber(),
      sendAsset: row.sendAsset,
      settledAt: row.settledAt,
      spreadBps: row.spreadBps,
      status: row.status,
    }))
  }

  /**
   * A live feasibility quote at the configured cap, briefly cached.
   *
   * Cached because the ops dashboard polls and the quote hits a public Horizon
   * instance; an uncached probe would spend the venue's rate limit on a panel
   * refresh. The same lesson the Transfero balance endpoints taught.
   */
  private async probeUnwindability(capUsdc: number): Promise<OpsStablebondUnwindabilityDto> {
    const now = Date.now()
    if (this.feasibilityCache && now - this.feasibilityCache.at < FEASIBILITY_CACHE_TTL_MS) {
      return this.feasibilityCache.value
    }

    const assessment = await this.unwindService.assessFeasibility(new Prisma.Decimal(capUsdc))
    const value: OpsStablebondUnwindabilityDto = assessment.enabled && assessment.feasible
      ? { feasible: true, reason: null, spreadBps: assessment.spreadBps, testedUsdc: capUsdc }
      : {
          feasible: false,
          reason: assessment.enabled ? assessment.reason : 'stablebond_position_disabled',
          spreadBps: null,
          testedUsdc: capUsdc,
        }
    this.feasibilityCache = { at: now, value }
    return value
  }

  private toResultDto(result: StablebondExecutionOutcome): OpsStablebondUnwindResultDto {
    this.feasibilityCache = undefined

    if (result.outcome === 'refused') {
      throw new OpsStablebondRefusedError(result.reason)
    }
    if (result.outcome === 'confirmed') {
      return {
        executionId: result.executionId,
        onChainId: result.onChainId,
        outcome: result.outcome,
        reason: null,
        receivedAmount: result.receivedAmount === null ? null : result.receivedAmount.toNumber(),
        spreadBps: result.spreadBps,
      }
    }
    // Ambiguous and failed both return 200 with the outcome named, rather than
    // an error: the operator has to see the execution id and stop, not retry.
    return {
      executionId: result.executionId,
      onChainId: result.outcome === 'ambiguous' ? result.onChainId : null,
      outcome: result.outcome,
      reason: result.reason,
      receivedAmount: null,
      spreadBps: null,
    }
  }
}

import { Prisma, StablebondExecutionDirection, StablebondExecutionStatus } from '@prisma/client'
import { inject, injectable } from 'inversify'

import { TYPES } from '../../../app/container/types'
import { createScopedLogger, ScopedLogger } from '../../../core/logging/scopedLogger'
import { ILogger } from '../../../core/logging/types'
import { ILockManager } from '../../../platform/cacheLock/ILockManager'
import { IDatabaseClientProvider } from '../../../platform/persistence/IDatabaseClientProvider'
import { IStablebondVenue, StablebondQuote } from './contracts/IStablebondVenue'
import { StablebondPositionService, ValuedStablebondPosition } from './StablebondPositionService'

export type StablebondExecutionOutcome
  = | { executionId: null | string, outcome: 'failed', reason: string }
    | { executionId: string, onChainId: string, outcome: 'ambiguous', reason: string }
    | {
      executionId: string
      onChainId: string
      outcome: 'confirmed'
      receivedAmount: null | Prisma.Decimal
      spreadBps: null | number
    }
    /** Nothing was submitted. The bound, the book or the position said no first. */
    | { outcome: 'refused', reason: string }

export type StablebondUnwindFeasibility
  = | { enabled: false }
    | { enabled: true, feasible: false, reason: string }
    | {
      enabled: true
      feasible: true
      /** Tokens the quote would consume. */
      sellTokens: Prisma.Decimal
      /** Basis points below NAV the quote would fill at. */
      spreadBps: number
    }

const BASIS_POINTS = 10_000
/**
 * The feasibility quote runs inside transaction acceptance. Acceptance already
 * bounds its external calls; an unbounded Horizon read here would let a slow
 * order-book query stall every payout.
 */
const FEASIBILITY_TIMEOUT_MS = 5_000
const POSITION_LOCK_TIMEOUT_MS = 30_000

/**
 * Moves the treasury into and out of the Stablebond position.
 *
 * The unwind is what the thesis rests on — the float is only float if it can be
 * liquidated inside a payout window — but with no issuer relationship the same
 * public venue is also the only way in, so both directions run through here and
 * share every safety property.
 *
 * Four invariants hold this together, in order:
 *
 *  1. Quote before committing, and bound the slippage. A quote that would fill
 *     worse than the configured tolerance is refused, never executed — and the
 *     bound goes on chain as `destMin`, so the network enforces it even if the
 *     book moves after we looked.
 *  2. Persist the execution before the venue is asked to act. The row exists,
 *     with its on-chain identity, before submission.
 *  3. Never re-execute an ambiguous execution. Reconcile it read-only against
 *     the venue; a second submission is a second trade.
 *  4. Hold a cross-process lock on the position across the whole critical
 *     section, so two payouts cannot both quote against the same tokens and then
 *     both sell them.
 */
@injectable()
export class JustInTimeUnwindService {
  private readonly logger: ScopedLogger

  constructor(
    @inject(StablebondPositionService) private readonly positionService: StablebondPositionService,
    @inject(TYPES.IStablebondVenue) private readonly venue: IStablebondVenue,
    @inject(TYPES.ILockManager) private readonly lockManager: ILockManager,
    @inject(TYPES.IDatabaseClientProvider) private readonly dbProvider: IDatabaseClientProvider,
    @inject(TYPES.ILogger) baseLogger: ILogger,
  ) {
    this.logger = createScopedLogger(baseLogger, { scope: 'JustInTimeUnwind' })
  }

  /**
   * Buy into the position, spending `spendQuoteAsset` of the quote asset.
   *
   * Bounded exactly as the unwind is: a quote that would pay more than the
   * slippage tolerance above NAV is refused, and the bound goes on chain.
   */
  public async acquire(params: {
    idempotencyKey: string
    spendQuoteAsset: Prisma.Decimal
  }): Promise<StablebondExecutionOutcome> {
    const config = this.positionService.getConfig()
    if (!config) return { outcome: 'refused', reason: 'stablebond_position_disabled' }
    if (params.spendQuoteAsset.lessThanOrEqualTo(0)) {
      return { outcome: 'refused', reason: 'non_positive_amount' }
    }

    return this.withPositionLock(config.symbol, config.venue, async () => {
      const existing = await this.resolveExisting(params.idempotencyKey)
      if (existing) return existing

      const read = await this.positionService.read()
      if (!read.success) return { outcome: 'refused', reason: read.reason }

      // The trustline is a prerequisite, not part of the trade. Acquiring
      // without one fails on chain after the fee has already been spent.
      const trustline = await this.venue.readTrustline()
      if (trustline.outcome === 'absent') {
        return { outcome: 'refused', reason: 'trustline_not_open' }
      }

      const quote = await this.venue.quoteBySend(
        StablebondExecutionDirection.ACQUIRE,
        params.spendQuoteAsset,
      )
      if (!quote) return { outcome: 'refused', reason: 'no_acquire_path' }

      const spreadBps = this.quoteSpreadBps(StablebondExecutionDirection.ACQUIRE, quote, read.position)
      if (spreadBps > config.maxSlippageBps) {
        this.logger.warn('Refusing acquisition: quote is past the slippage bound', {
          maxSlippageBps: config.maxSlippageBps,
          spreadBps,
        })
        return { outcome: 'refused', reason: 'slippage_bound_exceeded' }
      }

      return this.run({
        direction: StablebondExecutionDirection.ACQUIRE,
        idempotencyKey: params.idempotencyKey,
        // An acquisition has no external requirement to meet, so the floor is
        // purely the tolerance around the quote.
        minReceive: this.toleranceFloor(quote.receiveAmount, config.maxSlippageBps),
        position: read.position,
        quote,
      })
    })
  }

  /**
   * Could the position raise `requiredUsdc` right now, within the slippage bound?
   *
   * Read-only, and deliberately pessimistic: no path, an unreadable position, a
   * quote past the bound, or more tokens than we hold all answer "no". Callers
   * treat "no" as a refusal, so every uncertainty has to fall that way.
   */
  public async assessFeasibility(requiredUsdc: Prisma.Decimal): Promise<StablebondUnwindFeasibility> {
    const config = this.positionService.getConfig()
    if (!config) return { enabled: false }

    if (requiredUsdc.lessThanOrEqualTo(0)) {
      return { enabled: true, feasible: true, sellTokens: new Prisma.Decimal(0), spreadBps: 0 }
    }
    if (requiredUsdc.greaterThan(config.jitUnwindCapUsdc)) {
      return { enabled: true, feasible: false, reason: 'above_jit_unwind_cap' }
    }

    const read = await this.positionService.read()
    if (!read.success) {
      // An unreadable position is not an empty one. Refusing here is the same
      // rule the onramp applies to an unreadable hot wallet.
      return { enabled: true, feasible: false, reason: read.reason }
    }

    let quote: null | StablebondQuote
    try {
      quote = await this.withTimeout(
        this.venue.quoteByReceive(StablebondExecutionDirection.UNWIND, requiredUsdc),
      )
    }
    catch (error) {
      this.logger.warn('Stablebond unwind quote failed during feasibility check', {
        reason: error instanceof Error ? error.message.slice(0, 120) : 'unknown_error',
      })
      return { enabled: true, feasible: false, reason: 'unwind_quote_unavailable' }
    }
    if (!quote) return { enabled: true, feasible: false, reason: 'no_unwind_path' }

    if (quote.sendAmount.greaterThan(read.position.heldTokens)) {
      return { enabled: true, feasible: false, reason: 'insufficient_position' }
    }

    const spreadBps = this.quoteSpreadBps(StablebondExecutionDirection.UNWIND, quote, read.position)
    if (spreadBps > config.maxSlippageBps) {
      this.logger.warn('Refusing unwind feasibility: quote is past the slippage bound', {
        maxSlippageBps: config.maxSlippageBps,
        spreadBps,
      })
      return { enabled: true, feasible: false, reason: 'slippage_bound_exceeded' }
    }

    return { enabled: true, feasible: true, sellTokens: quote.sendAmount, spreadBps }
  }

  /** Whether the position is configured at all. Callers treat off as a no-op, never a failure. */
  public isEnabled(): boolean {
    return this.positionService.getConfig() !== null
  }

  /**
   * Raise `requiredUsdc` from the position.
   *
   * `idempotencyKey` must be derived from the business event that needs the
   * money, so a retried caller re-attaches to the execution already in flight
   * instead of selling a second time.
   */
  public async unwind(params: {
    idempotencyKey: string
    requiredUsdc: Prisma.Decimal
  }): Promise<StablebondExecutionOutcome> {
    const config = this.positionService.getConfig()
    if (!config) return { outcome: 'refused', reason: 'stablebond_position_disabled' }

    return this.withPositionLock(config.symbol, config.venue, async () => {
      const existing = await this.resolveExisting(params.idempotencyKey)
      if (existing) return existing

      const read = await this.positionService.read()
      if (!read.success) return { outcome: 'refused', reason: read.reason }

      const feasibility = await this.assessFeasibility(params.requiredUsdc)
      if (!feasibility.enabled) return { outcome: 'refused', reason: 'stablebond_position_disabled' }
      if (!feasibility.feasible) return { outcome: 'refused', reason: feasibility.reason }

      const quote = await this.venue.quoteByReceive(
        StablebondExecutionDirection.UNWIND,
        params.requiredUsdc,
      )
      if (!quote) return { outcome: 'refused', reason: 'no_unwind_path' }
      if (this.quoteSpreadBps(StablebondExecutionDirection.UNWIND, quote, read.position) > config.maxSlippageBps) {
        return { outcome: 'refused', reason: 'slippage_bound_exceeded' }
      }

      return this.run({
        direction: StablebondExecutionDirection.UNWIND,
        idempotencyKey: params.idempotencyKey,
        // The floor sent on chain. It must cover what the caller needs, and it
        // must not drift further from the quote than the tolerance allows —
        // whichever of the two binds harder wins.
        minReceive: Prisma.Decimal.max(
          params.requiredUsdc,
          this.toleranceFloor(quote.receiveAmount, config.maxSlippageBps),
        ),
        position: read.position,
        quote,
      })
    })
  }

  /**
   * Move the cost basis to match what actually settled.
   *
   * An unwind retires basis in proportion to the tokens sold. An acquisition
   * adds the tokens received at what was actually paid for them — never at the
   * quote, because the fill is the only figure that is true.
   */
  private async applyBasis(
    direction: StablebondExecutionDirection,
    positionId: string,
    quote: StablebondQuote,
    receivedAmount: null | Prisma.Decimal,
    position: ValuedStablebondPosition,
  ): Promise<void> {
    if (direction === StablebondExecutionDirection.UNWIND) {
      await this.positionService.releaseBasis({ positionId, soldTokens: quote.sendAmount })
      return
    }
    if (receivedAmount === null) {
      // The tokens landed but we could not measure them. Re-basing from a guess
      // would corrupt every accrual after it; registerBasis rebuilds it from the
      // chain's own numbers instead.
      this.logger.warn('Acquisition settled with an unmeasured fill; basis left for re-registration', {
        positionId,
      })
      return
    }
    const { navFiat, navUsd } = position.valuation
    await this.positionService.addBasis({
      // What was spent, expressed in the bond's own currency: navFiat/navUsd is
      // the issuer's own FX, so the basis and the NAV it will be marked against
      // can never disagree about the rate.
      costFiat: quote.sendAmount.times(navFiat).dividedBy(navUsd),
      positionId,
      tokens: receivedAmount,
    })
  }

  /**
   * The cost of an execution against NAV, in basis points. Positive is always
   * the cost direction — an unwind that sold below NAV, or an acquisition that
   * paid above it.
   */
  private executedSpreadBps(
    direction: StablebondExecutionDirection,
    sendAmount: Prisma.Decimal,
    receivedAmount: Prisma.Decimal,
    position: ValuedStablebondPosition,
  ): number {
    const navUsd = position.valuation.navUsd
    const isUnwind = direction === StablebondExecutionDirection.UNWIND
    // Whichever side of the trade is the bond, valued at NAV.
    const navValue = isUnwind ? sendAmount.times(navUsd) : receivedAmount.times(navUsd)
    if (navValue.lessThanOrEqualTo(0)) return 0

    const cost = isUnwind
      ? navValue.minus(receivedAmount) // sold tokens worth navValue for less
      : sendAmount.minus(navValue) // paid more than the tokens are worth

    const bps = cost
      .dividedBy(navValue)
      .times(BASIS_POINTS)
      .toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP)
    // A fill a hair better than NAV rounds to negative zero, which would surface
    // in the ops console as "-0 bps" and read as a defect.
    return bps.isZero() ? 0 : bps.toNumber()
  }

  /** The same cost measure applied to a quote, before anything is executed. */
  private quoteSpreadBps(
    direction: StablebondExecutionDirection,
    quote: StablebondQuote,
    position: ValuedStablebondPosition,
  ): number {
    return this.executedSpreadBps(direction, quote.sendAmount, quote.receiveAmount, position)
  }

  private async reconcileExisting(
    executionId: string,
    onChainId: string,
  ): Promise<StablebondExecutionOutcome> {
    const client = await this.dbProvider.getClient()
    const reconciliation = await this.venue.reconcile(onChainId)

    if (reconciliation.outcome === 'confirmed') {
      const updated = await client.stablebondExecution.update({
        data: {
          receivedAmount: reconciliation.receivedAmount,
          settledAt: new Date(),
          status: StablebondExecutionStatus.CONFIRMED,
        },
        select: { spreadBps: true },
        where: { id: executionId },
      })
      return {
        executionId,
        onChainId,
        outcome: 'confirmed',
        receivedAmount: reconciliation.receivedAmount,
        spreadBps: updated.spreadBps,
      }
    }
    if (reconciliation.outcome === 'failed') {
      await client.stablebondExecution.update({
        data: { failureReason: 'venue_rejected', status: StablebondExecutionStatus.FAILED },
        where: { id: executionId },
      })
      return { executionId, outcome: 'failed', reason: 'venue_rejected' }
    }

    // `absent` and `unavailable` both stay ambiguous. Horizon not showing the
    // transaction is not proof it will never be included.
    const reason = reconciliation.outcome === 'absent' ? 'venue_has_no_record_yet' : reconciliation.reason
    await client.stablebondExecution.update({
      data: { failureReason: reason, status: StablebondExecutionStatus.AMBIGUOUS },
      where: { id: executionId },
    })
    return { executionId, onChainId, outcome: 'ambiguous', reason }
  }

  /**
   * An execution that already exists for this key, resolved without ever asking
   * the venue to act again. Returns undefined when the key is genuinely new.
   */
  private async resolveExisting(idempotencyKey: string): Promise<StablebondExecutionOutcome | undefined> {
    const client = await this.dbProvider.getClient()
    const existing = await client.stablebondExecution.findUnique({
      select: {
        failureReason: true,
        id: true,
        onChainId: true,
        receivedAmount: true,
        spreadBps: true,
        status: true,
      },
      where: { idempotencyKey },
    })
    if (!existing) return undefined

    if (existing.status === StablebondExecutionStatus.CONFIRMED && existing.onChainId) {
      return {
        executionId: existing.id,
        onChainId: existing.onChainId,
        outcome: 'confirmed',
        receivedAmount: existing.receivedAmount === null ? null : new Prisma.Decimal(existing.receivedAmount),
        spreadBps: existing.spreadBps,
      }
    }
    if (existing.status === StablebondExecutionStatus.FAILED) {
      return { executionId: existing.id, outcome: 'failed', reason: existing.failureReason ?? 'execution_failed' }
    }
    if (!existing.onChainId) {
      // Quoted but never submitted: nothing moved, so this key is dead. Refuse
      // rather than silently starting a second quote under the same key.
      return { executionId: existing.id, outcome: 'failed', reason: 'execution_abandoned_before_submission' }
    }

    // SUBMITTED or AMBIGUOUS with an on-chain identity. The only safe action is
    // to look, never to submit.
    return this.reconcileExisting(existing.id, existing.onChainId)
  }

  /** Persist the quote, execute against it, then settle the row. */
  private async run(params: {
    direction: StablebondExecutionDirection
    idempotencyKey: string
    minReceive: Prisma.Decimal
    position: ValuedStablebondPosition
    quote: StablebondQuote
  }): Promise<StablebondExecutionOutcome> {
    const { direction, minReceive, position, quote } = params
    const record = position.record
    if (!record) return { outcome: 'refused', reason: 'position_basis_not_registered' }

    const client = await this.dbProvider.getClient()
    const execution = await client.stablebondExecution.create({
      data: {
        direction,
        idempotencyKey: params.idempotencyKey,
        minReceive,
        navFiatPerToken: position.valuation.navFiat,
        navUsdPerToken: position.valuation.navUsd,
        positionId: record.id,
        quotedReceive: quote.receiveAmount,
        receiveAsset: quote.receiveAsset,
        sendAmount: quote.sendAmount,
        sendAsset: quote.sendAsset,
        status: StablebondExecutionStatus.QUOTED,
      },
      select: { id: true },
    })

    const result = await this.venue.execute(
      { direction, minReceive, sendAmount: quote.sendAmount },
      async ({ onChainId }) => {
        await client.stablebondExecution.update({
          data: { onChainId, status: StablebondExecutionStatus.SUBMITTED },
          where: { id: execution.id },
        })
      },
    )

    if (result.outcome === 'confirmed') {
      const spreadBps = result.receivedAmount === null
        ? null
        : this.executedSpreadBps(direction, quote.sendAmount, result.receivedAmount, position)
      await client.stablebondExecution.update({
        data: {
          receivedAmount: result.receivedAmount,
          settledAt: new Date(),
          spreadBps,
          status: StablebondExecutionStatus.CONFIRMED,
        },
        where: { id: execution.id },
      })
      await this.applyBasis(direction, record.id, quote, result.receivedAmount, position)
      this.logger.info('Stablebond execution settled', {
        direction,
        executionId: execution.id,
        sendAmount: quote.sendAmount.toFixed(),
        spreadBps,
      })
      return {
        executionId: execution.id,
        onChainId: result.onChainId,
        outcome: 'confirmed',
        receivedAmount: result.receivedAmount,
        spreadBps,
      }
    }

    if (result.outcome === 'ambiguous') {
      await client.stablebondExecution.update({
        data: { failureReason: result.reason, status: StablebondExecutionStatus.AMBIGUOUS },
        where: { id: execution.id },
      })
      this.logger.error('Stablebond execution is ambiguous and must not be retried', {
        direction,
        executionId: execution.id,
        reason: result.reason,
      })
      // An ambiguous execution always has an identity: the venue contract
      // guarantees `persistPrepared` ran before anything could become uncertain.
      return {
        executionId: execution.id,
        onChainId: result.onChainId ?? '',
        outcome: 'ambiguous',
        reason: result.reason,
      }
    }

    await client.stablebondExecution.update({
      data: { failureReason: result.reason, status: StablebondExecutionStatus.FAILED },
      where: { id: execution.id },
    })
    return { executionId: execution.id, outcome: 'failed', reason: result.reason }
  }

  private toleranceFloor(receiveAmount: Prisma.Decimal, maxSlippageBps: number): Prisma.Decimal {
    return receiveAmount.times(BASIS_POINTS - maxSlippageBps).dividedBy(BASIS_POINTS)
  }

  private async withPositionLock<T>(symbol: string, venue: string, fn: () => Promise<T>): Promise<T> {
    return this.lockManager.withLock(`stablebond-unwind:${symbol}:${venue}`, POSITION_LOCK_TIMEOUT_MS, fn)
  }

  private async withTimeout<T>(promise: Promise<T>): Promise<T> {
    let timer: NodeJS.Timeout | undefined
    try {
      return await Promise.race([
        promise,
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(`Stablebond unwind quote timed out after ${FEASIBILITY_TIMEOUT_MS}ms`)),
            FEASIBILITY_TIMEOUT_MS,
          )
        }),
      ])
    }
    finally {
      if (timer) clearTimeout(timer)
    }
  }
}

import { Prisma, StablebondPositionStatus } from '@prisma/client'
import { inject, injectable, multiInject } from 'inversify'

import { TYPES } from '../../../app/container/types'
import { createScopedLogger, ScopedLogger } from '../../../core/logging/scopedLogger'
import { ILogger } from '../../../core/logging/types'
import { IDatabaseClientProvider } from '../../../platform/persistence/IDatabaseClientProvider'
import { IStablebondOracle, StablebondValuation } from './contracts/IStablebondOracle'
import { ITreasuryBalanceSource } from './contracts/ITreasuryBalanceSource'
import { readStablebondConfig, StablebondConfig } from './stablebondConfig'

export type StablebondPositionRead
  = | { position: ValuedStablebondPosition, success: true }
    | { reason: string, success: false }

export type ValuedStablebondPosition = {
  config: StablebondConfig
  /** Tokens actually held on chain right now. The authoritative quantity. */
  heldTokens: Prisma.Decimal
  /** Null until an operator registers the lot's basis; the tokens still read fine. */
  record: null | StablebondPositionRecord
  valuation: StablebondValuation
}

/** The cost basis of the lot, as recorded. Tokens held are read from the chain, not from here. */
type StablebondPositionRecord = {
  entryNavFiat: Prisma.Decimal
  id: string
  openedAt: Date
  principalFiat: Prisma.Decimal
  principalTokens: Prisma.Decimal
  status: StablebondPositionStatus
}

/**
 * Owns the Stablebond position: what we hold, what it is worth, and what it cost.
 *
 * The split matters. Token quantity is on-chain truth and is always read from the
 * chain — mirroring it in Postgres would create two answers to one question and a
 * reconciliation job to reconcile them. The database owns only what the chain
 * cannot say: the cost basis, without which yield cannot be attributed to a
 * timestamp.
 *
 * Every read is fail-closed. An unreadable balance or an unreadable NAV returns a
 * failure, never a zero — the same rule the onramp path already applies to hot
 * wallet inventory, and for the same reason: a position we cannot see is not a
 * position we can spend.
 */
@injectable()
export class StablebondPositionService {
  private readonly config: null | StablebondConfig
  private readonly logger: ScopedLogger
  private readonly source: ITreasuryBalanceSource | undefined

  constructor(
    @multiInject(TYPES.ITreasuryBalanceSource) sources: ITreasuryBalanceSource[],
    @inject(TYPES.IStablebondOracle) private readonly oracle: IStablebondOracle,
    @inject(TYPES.IDatabaseClientProvider) private readonly dbProvider: IDatabaseClientProvider,
    @inject(TYPES.ILogger) baseLogger: ILogger,
  ) {
    this.logger = createScopedLogger(baseLogger, { scope: 'StablebondPosition' })
    const configResult = readStablebondConfig()
    this.config = configResult.enabled ? configResult.config : null
    this.source = sources.find(source => source.venue === 'STABLEBOND_POSITION')
  }

  /**
   * Adds newly acquired tokens to the lot at what they actually cost.
   *
   * The lot keeps a single blended entry NAV: adding to it moves that average
   * toward the new purchase rather than restarting the accrual, so yield already
   * earned on the tokens we held is not erased by buying more. Creates the lot
   * when this is the first acquisition.
   */
  public async addBasis(params: {
    costFiat: Prisma.Decimal
    positionId: string
    tokens: Prisma.Decimal
  }): Promise<void> {
    if (params.tokens.lessThanOrEqualTo(0)) return

    const client = await this.dbProvider.getClient()
    const row = await client.stablebondPosition.findUnique({
      select: { principalFiat: true, principalTokens: true },
      where: { id: params.positionId },
    })
    if (!row) return

    const principalTokens = new Prisma.Decimal(row.principalTokens).plus(params.tokens)
    const principalFiat = new Prisma.Decimal(row.principalFiat).plus(params.costFiat)

    await client.stablebondPosition.update({
      data: {
        closedAt: null,
        entryNavFiat: principalTokens.isZero()
          ? new Prisma.Decimal(0)
          : principalFiat.dividedBy(principalTokens),
        principalFiat,
        principalTokens,
        status: StablebondPositionStatus.OPEN,
      },
      where: { id: params.positionId },
    })
  }

  public getConfig(): null | StablebondConfig {
    return this.config
  }

  /**
   * The position as it stands: tokens on chain, NAV from the issuer, basis from
   * the ledger.
   */
  public async read(): Promise<StablebondPositionRead> {
    if (!this.config) {
      return { reason: 'stablebond_position_disabled', success: false }
    }
    if (!this.source) {
      return { reason: 'no_balance_source_for_venue:STABLEBOND_POSITION', success: false }
    }
    const config = this.config

    let heldTokens: Prisma.Decimal
    try {
      const balances = await this.source.getBalances()
      const match = balances.find(balance => balance.currency === config.symbol)
      if (!match) {
        return { reason: `asset_not_held:${config.symbol}`, success: false }
      }
      heldTokens = new Prisma.Decimal(String(match.amount))
    }
    catch (error) {
      const reason = error instanceof Error ? error.message : 'unknown_error'
      this.logger.error('Stablebond position balance read failed', { reason, symbol: config.symbol })
      return { reason: 'position_balance_unreadable', success: false }
    }

    let valuation: StablebondValuation
    try {
      valuation = await this.oracle.getValuation(config.symbol)
    }
    catch (error) {
      const reason = error instanceof Error ? error.message : 'unknown_error'
      this.logger.error('Stablebond valuation read failed', { reason, symbol: config.symbol })
      return { reason: 'position_valuation_unreadable', success: false }
    }

    // A NAV quoted in a different currency than the position is configured for
    // is not a NAV for this position. Silently accepting it would value a BRL
    // bond at a USD price.
    if (valuation.fiatCurrency !== config.fiatCurrency) {
      this.logger.error('Stablebond valuation currency does not match the configured position', {
        configured: config.fiatCurrency,
        quoted: valuation.fiatCurrency,
        symbol: config.symbol,
      })
      return { reason: 'position_valuation_currency_mismatch', success: false }
    }

    const client = await this.dbProvider.getClient()
    const record = await client.stablebondPosition.findUnique({
      select: this.recordSelection(),
      where: { symbol_venue: { symbol: config.symbol, venue: config.venue } },
    })

    return { position: { config, heldTokens, record, valuation }, success: true }
  }

  /**
   * Registers the cost basis of tokens the treasury already holds.
   *
   * Basis, not purchase: this rebuilds the lot from the chain's own numbers, which
   * is what an operator reaches for after acquiring outside this system or after
   * a fill that could not be measured. Called again, it re-bases the whole lot at
   * the currently held quantity and the live NAV, which is the only correct answer
   * once the held quantity has changed underneath us.
   */
  public async registerBasis(): Promise<StablebondPositionRead> {
    const read = await this.read()
    if (!read.success) return read
    const { config, heldTokens, valuation } = read.position

    if (heldTokens.lessThanOrEqualTo(0)) {
      return { reason: 'no_tokens_held', success: false }
    }

    const client = await this.dbProvider.getClient()
    const basis = {
      entryNavFiat: valuation.navFiat,
      principalFiat: heldTokens.times(valuation.navFiat),
      principalTokens: heldTokens,
      status: StablebondPositionStatus.OPEN,
    }
    const row = await client.stablebondPosition.upsert({
      create: {
        ...basis,
        assetCode: config.assetCode,
        fiatCurrency: config.fiatCurrency,
        issuer: config.issuer,
        symbol: config.symbol,
        venue: config.venue,
      },
      select: this.recordSelection(),
      update: { ...basis, closedAt: null },
      where: { symbol_venue: { symbol: config.symbol, venue: config.venue } },
    })

    this.logger.info('Stablebond position basis registered', {
      navFiat: basis.entryNavFiat.toFixed(),
      positionId: row.id,
      principalTokens: basis.principalTokens.toFixed(),
      symbol: config.symbol,
    })

    return { position: { config, heldTokens, record: row, valuation }, success: true }
  }

  /**
   * Releases basis proportionally to the tokens an unwind sold.
   *
   * Proportional, not FIFO: one lot per bond means every token in it shares the
   * same entry NAV, so selling a fraction of the lot retires exactly that
   * fraction of the principal. Yield realised on the sold tokens therefore stays
   * out of the remaining lot's accrual instead of being counted twice.
   */
  public async releaseBasis(params: {
    client?: Prisma.TransactionClient
    positionId: string
    soldTokens: Prisma.Decimal
  }): Promise<void> {
    const client = params.client ?? await this.dbProvider.getClient()
    const row = await client.stablebondPosition.findUnique({
      select: { principalFiat: true, principalTokens: true },
      where: { id: params.positionId },
    })
    if (!row) return

    const principalTokens = new Prisma.Decimal(row.principalTokens)
    if (principalTokens.lessThanOrEqualTo(0)) return

    const sold = Prisma.Decimal.min(params.soldTokens, principalTokens)
    const remainingTokens = principalTokens.minus(sold)
    // Scale the fiat basis by the surviving token fraction so entryNav stays the
    // lot's true average even after a partial sale.
    const remainingFiat = new Prisma.Decimal(row.principalFiat)
      .times(remainingTokens)
      .dividedBy(principalTokens)

    await client.stablebondPosition.update({
      data: {
        closedAt: remainingTokens.isZero() ? new Date() : null,
        principalFiat: remainingFiat,
        principalTokens: remainingTokens,
        status: remainingTokens.isZero() ? StablebondPositionStatus.CLOSED : StablebondPositionStatus.OPEN,
      },
      where: { id: params.positionId },
    })
  }

  private recordSelection() {
    return {
      entryNavFiat: true,
      id: true,
      openedAt: true,
      principalFiat: true,
      principalTokens: true,
      status: true,
    } as const
  }
}

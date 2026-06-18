import { CryptoCurrency } from '@prisma/client'
import { inject, injectable } from 'inversify'

import { TYPES } from '../../../app/container/types'
import { createScopedLogger, ScopedLogger } from '../../../core/logging/scopedLogger'
import { ILogger } from '../../../core/logging/types'
import { IDatabaseClientProvider } from '../../../platform/persistence/IDatabaseClientProvider'

export type FloatCheck = { cap: number, deficit: number, ok: boolean }

/**
 * Admission control for the bridge float. Small CELO->BRL flows settle
 * immediately against the Transfero USDC float and only later replenish it via
 * the batched sweep, so the OUTSTANDING float deficit (USDC fronted but not yet
 * bridged back = PENDING + BATCHED legs) must never exceed the seeded float.
 * This is checked BEFORE a transaction is accepted (the recipient is paid
 * first, so the guard cannot live in the flow itself). As sweeps settle legs,
 * the deficit drops and capacity frees up automatically.
 *
 * DISABLED unless BRIDGE_FLOAT_CAP_USDC is configured — so the code can ship
 * dark and only enforce once the float-backed model is intentionally rolled out
 * (otherwise it would wrongly reject large CELO->BRL txs still on the legacy
 * per-flow-transfer corridor, which has no float).
 */
@injectable()
export class BridgeFloatService {
  private readonly capUsdc: number | undefined
  private readonly logger: ScopedLogger

  constructor(
    @inject(TYPES.IDatabaseClientProvider) private readonly dbProvider: IDatabaseClientProvider,
    @inject(TYPES.ILogger) baseLogger: ILogger,
  ) {
    this.capUsdc = this.readOptionalNumber('BRIDGE_FLOAT_CAP_USDC')
    this.logger = createScopedLogger(baseLogger, { scope: 'BridgeFloat' })
  }

  public async canSettle(params: { amount: number, asset: CryptoCurrency }): Promise<FloatCheck> {
    if (this.capUsdc === undefined) {
      // Guard not configured -> disabled (ship-dark default).
      return { cap: Number.POSITIVE_INFINITY, deficit: 0, ok: true }
    }
    const deficit = await this.getOutstandingDeficit(params.asset)
    const ok = deficit + params.amount <= this.capUsdc
    if (!ok) {
      this.logger.warn('Bridge float at capacity; rejecting settlement', { amount: params.amount, cap: this.capUsdc, deficit })
    }
    return { cap: this.capUsdc, deficit, ok }
  }

  public async getOutstandingDeficit(asset: CryptoCurrency): Promise<number> {
    const client = await this.dbProvider.getClient()
    const aggregate = await client.bridgePendingTransfer.aggregate({
      _sum: { amount: true },
      where: { asset, status: { in: ['BATCHED', 'PENDING'] } },
    })
    return Number(aggregate?._sum?.amount ?? 0) || 0
  }

  private readOptionalNumber(envKey: string): number | undefined {
    const raw = process.env[envKey]
    if (!raw) return undefined
    const parsed = Number(raw)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
  }
}

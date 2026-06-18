import { Wallet } from '@binance/wallet'
import { BlockchainNetwork, CryptoCurrency, TargetCurrency } from '@prisma/client'
import { inject, injectable } from 'inversify'

import { TYPES } from '../../../app/container/types'
import { createScopedLogger, ScopedLogger } from '../../../core/logging/scopedLogger'
import { ILogger } from '../../../core/logging/types'
import { IDatabaseClientProvider } from '../../../platform/persistence/IDatabaseClientProvider'
import { ISecretManager, Secrets } from '../../../platform/secrets/ISecretManager'
import { IExchangeProviderFactory } from '../application/contracts/IExchangeProviderFactory'
import { mapBlockchainToBinanceNetwork } from '../infrastructure/exchangeProviders/binanceNetworkMap'

export type BridgeSweepResult = {
  amount?: number
  batchId?: string
  count?: number
  reason?: string
  swept: boolean
}

// The single bridge this system operates: USDC pooled at Binance, withdrawn on
// Solana to Transfero's USDC deposit wallet (whose settlement currency is BRL).
const BRIDGE_ASSET = CryptoCurrency.USDC
const BRIDGE_DEST_NETWORK = 'SOL'
const BRIDGE_DESTINATION_CURRENCY = TargetCurrency.BRL

// Binance withdrawal status codes: 6 = Completed (sent on-chain);
// 1 = Cancelled, 3 = Rejected, 5 = Failure are terminal failures (funds
// returned to the Binance balance); 0/2/4 = in progress.
const WITHDRAW_STATUS_COMPLETED = 6
const WITHDRAW_STATUS_TERMINAL_FAIL = new Set([1, 3, 5])

type BinanceCoinInfo = {
  coin?: string
  networkList?: { network?: string, withdrawFee?: string, withdrawMin?: string }[]
}
type BridgeBatchRow = { destNetwork: string, id: string }

// A SUBMITTED batch unresolved past this age is surfaced (delivered-but-unmatched
// or a >7-day Binance withdrawHistory lookback gap), instead of silently stuck.
const STALE_SUBMITTED_MS = 60 * 60_000

/**
 * Bridges pooled small-tx USDC across Binance->Transfero (Solana). Each flow
 * already settled against the Transfero float; this drains the PENDING legs
 * into ONE withdrawal that clears the per-withdrawal minimum, so amounts that
 * could never withdraw individually settle in bulk.
 *
 * Safety invariants:
 *  - Idempotent: the Binance withdrawOrderId == batch id, so a crash/retry
 *    never double-withdraws. A non-terminal (OPEN) batch is RESUMED before any
 *    new legs are pooled, so a failed/crashed withdrawal is retried, not
 *    stranded — and legs are never blindly returned to PENDING (which could
 *    double-spend if the original withdrawal actually landed).
 *  - Fails closed: if the Binance minimum can't be resolved, nothing is
 *    withdrawn.
 *  - The withdraw amount is recomputed from the rows actually claimed into the
 *    batch, never a pre-claim snapshot.
 * Intended to run from a single sweep worker (no concurrent invocation).
 */
@injectable()
export class BridgeSweepService {
  private readonly logger: ScopedLogger

  constructor(
    @inject(TYPES.IDatabaseClientProvider) private readonly dbProvider: IDatabaseClientProvider,
    @inject(TYPES.IExchangeProviderFactory) private readonly exchangeProviderFactory: IExchangeProviderFactory,
    @inject(TYPES.ISecretManager) private readonly secretManager: ISecretManager,
    @inject(TYPES.ILogger) baseLogger: ILogger,
  ) {
    this.logger = createScopedLogger(baseLogger, { scope: 'BridgeSweep' })
  }

  /**
   * Advance SUBMITTED batches to a terminal state by checking the Binance
   * withdrawal status (by withdrawOrderId == batch id): COMPLETED -> batch
   * CREDITED + legs SETTLED (the float deficit for those legs is closed); a
   * definitive Binance failure (cancelled/rejected/failure) -> legs back to
   * PENDING + batch FAILED so the next sweep re-batches them under a fresh
   * withdrawOrderId (safe: the failed withdrawal returned the funds to Binance).
   * In-progress withdrawals are left SUBMITTED for a later tick.
   */
  public async reconcile(): Promise<{ credited: number, failed: number }> {
    const client = await this.dbProvider.getClient()
    const submitted = await client.bridgeBatch.findMany({
      where: { asset: BRIDGE_ASSET, destNetwork: BRIDGE_DEST_NETWORK, status: 'SUBMITTED' },
    })
    if (submitted.length === 0) {
      return { credited: 0, failed: 0 }
    }

    const wallet = await this.buildWallet()
    let credited = 0
    let failed = 0
    for (const batch of submitted) {
      const createdAt = batch.createdAt instanceof Date ? batch.createdAt : undefined
      const status = await this.getWithdrawStatus(wallet, batch.id, createdAt)
      if (status === WITHDRAW_STATUS_COMPLETED) {
        await client.bridgePendingTransfer.updateMany({ data: { status: 'SETTLED' }, where: { batchId: batch.id } })
        await client.bridgeBatch.update({ data: { settledAt: new Date(), status: 'CREDITED' }, where: { id: batch.id } })
        this.logger.info('Bridge batch credited at destination', { batchId: batch.id })
        credited += 1
      }
      else if (typeof status === 'number' && WITHDRAW_STATUS_TERMINAL_FAIL.has(status)) {
        await client.bridgePendingTransfer.updateMany({ data: { batchId: null, status: 'PENDING' }, where: { batchId: batch.id } })
        await client.bridgeBatch.update({ data: { status: 'FAILED' }, where: { id: batch.id } })
        this.logger.warn('Bridge batch withdrawal failed on Binance; legs returned to PENDING', { batchId: batch.id, status })
        failed += 1
      }
      else if (createdAt && Date.now() - createdAt.getTime() > STALE_SUBMITTED_MS) {
        // Unresolved well past expected settlement — surface for ops rather
        // than let it sit silently (delivered-but-unmatched / outage gap).
        this.logger.error('Bridge batch SUBMITTED and unresolved beyond threshold', { batchId: batch.id, createdAt })
      }
      // else: still in progress (sent/processing) — leave SUBMITTED.
    }
    return { credited, failed }
  }

  public async sweep(): Promise<BridgeSweepResult> {
    const client = await this.dbProvider.getClient()
    const wallet = await this.buildWallet()

    // 1. Resume a non-terminal batch first (idempotent retry of a prior failed
    //    or crashed withdrawal) before pooling new legs.
    const stale = await client.bridgeBatch.findFirst({
      where: { asset: BRIDGE_ASSET, destNetwork: BRIDGE_DEST_NETWORK, status: 'OPEN' },
    })
    if (stale) {
      return this.submitBatch(client, wallet, stale)
    }

    const pending = await client.bridgePendingTransfer.findMany({
      where: { asset: BRIDGE_ASSET, destNetwork: BRIDGE_DEST_NETWORK, status: 'PENDING' },
    })
    if (pending.length === 0) {
      return { reason: 'no_pending_legs', swept: false }
    }
    const provisional = pending.reduce((sum, leg) => sum + (Number(leg.amount) || 0), 0)

    // 2. Resolve constraints + destination BEFORE claiming. Fail closed.
    const constraints = await this.getConstraints(wallet)
    if (constraints.min === undefined) {
      return { reason: 'constraints_unavailable', swept: false }
    }
    if (provisional < constraints.min) {
      return { amount: provisional, count: pending.length, reason: 'below_minimum', swept: false }
    }
    const destination = await this.resolveDestination()
    if (!destination) {
      return { reason: 'destination_unresolved', swept: false }
    }

    // 3. Create the batch and claim the legs ATOMICALLY, so an OPEN batch can
    //    never exist without its claimed legs (which the resume path would
    //    otherwise over-withdraw against the stored grossAmount).
    const batch = await client.$transaction(async (tx) => {
      const created = await tx.bridgeBatch.create({
        data: { asset: BRIDGE_ASSET, destNetwork: BRIDGE_DEST_NETWORK, grossAmount: provisional, status: 'OPEN', withdrawFee: constraints.fee ?? null },
      })
      await tx.bridgePendingTransfer.updateMany({
        data: { batchId: created.id, status: 'BATCHED' },
        where: { id: { in: pending.map(leg => leg.id) }, status: 'PENDING' },
      })
      return created
    })

    return this.submitBatch(client, wallet, batch, destination)
  }

  private async buildWallet(): Promise<Wallet> {
    const [apiKey, apiSecret, apiUrl] = await Promise.all([
      this.secretManager.getSecret(Secrets.BINANCE_API_KEY),
      this.secretManager.getSecret(Secrets.BINANCE_API_SECRET),
      this.secretManager.getSecret(Secrets.BINANCE_API_URL),
    ])
    return new Wallet({ configurationRestAPI: { apiKey, apiSecret, basePath: apiUrl } })
  }

  private async getConstraints(wallet: Wallet): Promise<{ fee?: number, min?: number }> {
    try {
      const response = await wallet.restAPI.allCoinsInformation()
      const data = await response.data()
      const coins = Array.isArray(data) ? data as BinanceCoinInfo[] : []
      const coin = coins.find(entry => typeof entry?.coin === 'string' && entry.coin.toUpperCase() === BRIDGE_ASSET)
      const networks = Array.isArray(coin?.networkList) ? coin.networkList : []
      const entry = networks.find(item => item?.network === BRIDGE_DEST_NETWORK)
      const fee = Number(entry?.withdrawFee)
      const min = Number(entry?.withdrawMin)
      return {
        fee: Number.isFinite(fee) && fee >= 0 ? fee : undefined,
        min: Number.isFinite(min) && min >= 0 ? min : undefined,
      }
    }
    catch (error) {
      this.logger.warn('Unable to resolve Binance withdrawal constraints', { error })
      return {}
    }
  }

  private async getWithdrawStatus(wallet: Wallet, withdrawOrderId: string, since?: Date): Promise<number | undefined> {
    try {
      // Scope the lookback to the batch's age + coin so the record stays in
      // window (Binance defaults to only the last 7 days for a withdrawOrderId
      // query). startTime->now must be < 7 days; batches normally resolve in
      // minutes, and a stale-SUBMITTED alert covers the rare >7-day case.
      const params: { coin: string, startTime?: number, withdrawOrderId: string } = { coin: BRIDGE_ASSET, withdrawOrderId }
      if (since instanceof Date) {
        params.startTime = since.getTime()
      }
      const response = await wallet.restAPI.withdrawHistory(params)
      const data = await response.data()
      const items = Array.isArray(data) ? data as { status?: number, withdrawOrderId?: string }[] : []
      const match = items.find(item => item?.withdrawOrderId === withdrawOrderId) ?? items[0]
      return typeof match?.status === 'number' ? match.status : undefined
    }
    catch (error) {
      this.logger.warn('Unable to fetch Binance withdraw status', { error, withdrawOrderId })
      return undefined
    }
  }

  private isDuplicateWithdraw(error: unknown): boolean {
    const e = error as { body?: { msg?: string }, message?: string, response?: { data?: { msg?: string } } }
    const text = String(e?.message ?? e?.body?.msg ?? e?.response?.data?.msg ?? error ?? '').toLowerCase()
    return text.includes('duplicate') || text.includes('already exist')
  }

  private async resolveDestination(): Promise<undefined | { address: string, memo?: string }> {
    const provider = this.exchangeProviderFactory.getExchangeProvider(BRIDGE_DESTINATION_CURRENCY)
    const depositNetwork = provider.getDepositNetwork?.({ cryptoCurrency: BRIDGE_ASSET })
    if (!depositNetwork) {
      this.logger.error('Bridge destination has no deposit network', { asset: BRIDGE_ASSET })
      return undefined
    }
    // The provider's chain MUST map to the network the legs were pooled under.
    if (mapBlockchainToBinanceNetwork(depositNetwork) !== BRIDGE_DEST_NETWORK) {
      this.logger.error('Bridge destination network mismatch', { depositNetwork, expected: BRIDGE_DEST_NETWORK })
      return undefined
    }
    const addressResult = await provider.getExchangeAddress({ blockchain: depositNetwork as BlockchainNetwork, cryptoCurrency: BRIDGE_ASSET })
    if (!addressResult.success) {
      this.logger.error('Bridge destination address unavailable', { reason: addressResult.reason })
      return undefined
    }
    return { address: addressResult.address, memo: addressResult.memo }
  }

  private async submitBatch(
    client: Awaited<ReturnType<IDatabaseClientProvider['getClient']>>,
    wallet: Wallet,
    batch: BridgeBatchRow,
    knownDestination?: { address: string, memo?: string },
  ): Promise<BridgeSweepResult> {
    // Re-derive the withdraw amount from the legs ACTUALLY claimed into this
    // batch — never the stored grossAmount snapshot. This makes an empty/partial
    // batch (e.g. a crash between create and claim) impossible to over-withdraw:
    // an empty batch withdraws nothing and is failed; its legs stay PENDING for
    // a fresh batch.
    const members = await client.bridgePendingTransfer.findMany({ where: { batchId: batch.id, status: 'BATCHED' } })
    const total = members.reduce((sum, leg) => sum + (Number(leg.amount) || 0), 0)
    if (members.length === 0 || !(total > 0)) {
      await client.bridgeBatch.update({ data: { status: 'FAILED' }, where: { id: batch.id } })
      return { batchId: batch.id, reason: 'no_member_legs', swept: false }
    }

    const destination = knownDestination ?? await this.resolveDestination()
    if (!destination) {
      return { batchId: batch.id, reason: 'destination_unresolved', swept: false }
    }

    try {
      const response = await wallet.restAPI.withdraw({
        address: destination.address,
        addressTag: destination.memo ?? undefined,
        amount: total,
        coin: BRIDGE_ASSET,
        network: batch.destNetwork,
        withdrawOrderId: batch.id, // idempotency anchor
      })
      const data = await response.data()
      await client.bridgeBatch.update({ data: { grossAmount: total, status: 'SUBMITTED', withdrawId: data?.id ?? null }, where: { id: batch.id } })
      this.logger.info('Swept bridge batch', { amount: total, batchId: batch.id, withdrawId: data?.id ?? null })
      return { amount: total, batchId: batch.id, swept: true }
    }
    catch (error) {
      if (this.isDuplicateWithdraw(error)) {
        // The original withdrawal for this batch id already landed; do NOT
        // re-withdraw. Mark submitted so the batch leaves the OPEN retry set.
        await client.bridgeBatch.update({ data: { grossAmount: total, status: 'SUBMITTED' }, where: { id: batch.id } })
        this.logger.warn('Bridge batch withdrawal already submitted (duplicate); marking submitted', { batchId: batch.id })
        return { amount: total, batchId: batch.id, swept: true }
      }
      // Leave the batch OPEN (legs stay BATCHED) so the next tick retries the
      // SAME withdrawOrderId — never re-PENDING (would risk a double-spend).
      this.logger.error('Bridge sweep withdrawal failed; will retry batch', { batchId: batch.id, error })
      return { batchId: batch.id, reason: 'withdraw_failed', swept: false }
    }
  }
}

import { BlockchainNetwork, Prisma, StablebondExecutionDirection } from '@prisma/client'
import {
  Asset,
  Horizon,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
} from '@stellar/stellar-sdk'
import { inject, injectable } from 'inversify'
import { z } from 'zod'

import { TYPES } from '../../../../app/container/types'
import { createScopedLogger, ScopedLogger } from '../../../../core/logging/scopedLogger'
import { ILogger } from '../../../../core/logging/types'
import { ILockManager } from '../../../../platform/cacheLock/ILockManager'
import { ISecretManager, Secrets } from '../../../../platform/secrets/ISecretManager'
import { CryptoAssetConfigService } from '../../../payments/application/CryptoAssetConfigService'
import {
  IStablebondVenue,
  StablebondExecuteParams,
  StablebondExecutionResult,
  StablebondQuote,
  StablebondReconciliation,
  StablebondTrustlineResult,
} from '../../application/contracts/IStablebondVenue'
import { readStablebondConfig, StablebondConfig } from '../../application/stablebondConfig'

/** Stellar amounts carry seven decimal places; anything finer is not representable. */
const STELLAR_DECIMALS = 7
const STELLAR_TRANSACTION_TIMEOUT_SECONDS = 180
/**
 * Matches `StellarWalletHandler`. Every operation here spends the SAME source
 * account as customer withdrawals, so it must contend for the same lock — two
 * builders reading one sequence number would produce two envelopes of which only
 * one can ever be included.
 */
const STELLAR_WITHDRAWAL_LOCK_TIMEOUT_MS = 20_000
const MAX_STELLAR_FEE_STROOPS = 20_000_000

const pathRecordSchema = z.object({
  destination_amount: z.string().min(1),
  path: z.array(z.object({ asset_type: z.string() }).passthrough()),
  source_amount: z.string().min(1),
})

const pathResponseSchema = z.object({ records: z.array(pathRecordSchema) })

/**
 * A path payment operation as Horizon reports it after the fact. `amount` is what
 * the destination actually received — the measured fill, not the quote.
 */
const executedOperationSchema = z.object({
  records: z.array(z.object({
    amount: z.string().optional(),
    type: z.string(),
  }).passthrough()),
})

function errorStatus(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined
  const status = (error as { response?: { status?: unknown } }).response?.status
  return typeof status === 'number' ? status : undefined
}

function isAmbiguous(error: unknown): boolean {
  const status = errorStatus(error)
  if (status === 408 || status === 429 || status === 504) return true
  if (typeof status === 'number' && status >= 500) return true
  const message = error instanceof Error ? error.message : ''
  return /timeout|timed out|network|socket|abort/i.test(message)
}

/** Truncate toward zero: a quote must never claim more precision than it can fill. */
function toStellarAmount(value: Prisma.Decimal): string {
  return value.toDecimalPlaces(STELLAR_DECIMALS, Prisma.Decimal.ROUND_DOWN).toFixed()
}

function transactionFingerprint(hash: string): string {
  return hash.slice(-8)
}

/**
 * Moves the treasury into and out of a Stablebond position on Stellar's native
 * decentralised exchange.
 *
 * This is the permissionless route, and it is the only one on purpose. TESOURO
 * is a classic Stellar asset with `auth_required: false`, so a trustline can be
 * opened and the asset traded with no involvement from the issuer whatsoever —
 * no KYB, no API key, no counterparty who could decline. `auth_revocable` and
 * `auth_clawback_enabled` are both false too, so once the float is in the bond
 * the issuer cannot freeze it or claw it back.
 *
 * On 2026-08-06 TESOURO/USDC was a direct market: a 25,000-token strict-send
 * quoted in a single hop at 3.6 bps under NAV, filling in one ledger.
 *
 * Both directions are a path payment to our own account — the bond and the
 * proceeds live on one account, which is why the trustline must exist first.
 *
 * `destMin` is the safety property. The slippage bound is enforced by the
 * network at execution time, not by us comparing numbers after the fact: a book
 * that moves between quote and inclusion causes the operation to fail, never to
 * fill at a worse price.
 */
@injectable()
export class StellarDexVenue implements IStablebondVenue {
  public readonly quoteAsset: string
  private readonly config: null | StablebondConfig
  private readonly logger: ScopedLogger

  constructor(
    @inject(TYPES.ISecretManager) private readonly secretManager: ISecretManager,
    @inject(CryptoAssetConfigService) private readonly assetConfigService: CryptoAssetConfigService,
    @inject(TYPES.ILockManager) private readonly lockManager: ILockManager,
    @inject(TYPES.ILogger) baseLogger: ILogger,
  ) {
    this.logger = createScopedLogger(baseLogger, { scope: 'StellarDexVenue' })
    const configResult = readStablebondConfig()
    this.config = configResult.enabled ? configResult.config : null
    this.quoteAsset = this.config?.receiveAsset ?? 'USDC'
  }

  /**
   * Opens the trustline if it is missing. Idempotent: an existing trustline is
   * reported, never re-created, so a retried call cannot disturb a funded one.
   */
  public async ensureTrustline(): Promise<StablebondTrustlineResult> {
    const config = this.requireConfig()
    const existing = await this.readTrustline()
    if (existing.outcome !== 'absent') return existing

    const [horizonUrl, privateKey] = await Promise.all([
      this.secretManager.getSecret(Secrets.STELLAR_HORIZON_URL),
      this.secretManager.getSecret(Secrets.STELLAR_PRIVATE_KEY),
    ])
    const server = new Horizon.Server(horizonUrl)
    const keypair = Keypair.fromSecret(privateKey)

    return this.lockManager.withLock(keypair.publicKey(), STELLAR_WITHDRAWAL_LOCK_TIMEOUT_MS, async () => {
      const account = await server.loadAccount(keypair.publicKey())
      const transaction = new TransactionBuilder(account, {
        fee: (await this.resolveFeeStroops(server)).toString(),
        networkPassphrase: Networks.PUBLIC,
      })
        // No explicit limit: the default is the maximum, and a limit lower than
        // the position we intend to hold would reject our own acquisition.
        .addOperation(Operation.changeTrust({ asset: new Asset(config.assetCode, config.issuer) }))
        .setTimeout(STELLAR_TRANSACTION_TIMEOUT_SECONDS)
        .build()
      transaction.sign(keypair)
      const onChainId = transaction.hash().toString('hex')

      try {
        await server.submitTransaction(transaction)
        this.logger.info('Stablebond trustline opened', { assetCode: config.assetCode })
        return { onChainId, outcome: 'opened' as const }
      }
      catch (error) {
        // Re-read rather than trust the error: a trustline that exists after the
        // fact is a success however the submission looked.
        const reread = await this.readTrustline()
        if (reread.outcome === 'present') return reread
        if (isAmbiguous(error)) {
          return { onChainId, outcome: 'ambiguous' as const, reason: 'stellar_submission_ambiguous' }
        }
        return { outcome: 'failed' as const, reason: 'stellar_change_trust_rejected' }
      }
    })
  }

  public async execute(
    params: StablebondExecuteParams,
    persistPrepared: (prepared: { onChainId: string }) => Promise<void>,
  ): Promise<StablebondExecutionResult> {
    const sendAmount = toStellarAmount(params.sendAmount)
    const minReceive = toStellarAmount(params.minReceive)
    if (new Prisma.Decimal(sendAmount).lessThanOrEqualTo(0) || new Prisma.Decimal(minReceive).lessThanOrEqualTo(0)) {
      return { onChainId: null, outcome: 'failed', reason: 'amount_below_stellar_precision' }
    }

    const [horizonUrl, privateKey, assets] = await Promise.all([
      this.secretManager.getSecret(Secrets.STELLAR_HORIZON_URL),
      this.secretManager.getSecret(Secrets.STELLAR_PRIVATE_KEY),
      this.resolveAssets(params.direction),
    ])
    const server = new Horizon.Server(horizonUrl)
    const keypair = Keypair.fromSecret(privateKey)
    const sourcePublicKey = keypair.publicKey()

    return this.lockManager.withLock(sourcePublicKey, STELLAR_WITHDRAWAL_LOCK_TIMEOUT_MS, async () => {
      const account = await server.loadAccount(sourcePublicKey)
      const fee = await this.resolveFeeStroops(server)

      const transaction = new TransactionBuilder(account, {
        fee: fee.toString(),
        // Must match StellarWalletHandler: the same account signs both, and a
        // passphrase mismatch would produce envelopes for a different network.
        networkPassphrase: Networks.PUBLIC,
      })
        .addOperation(Operation.pathPaymentStrictSend({
          destAsset: assets.receive,
          // Self-payment: the position and the proceeds live on one account.
          destination: sourcePublicKey,
          // The bound. Below this the network rejects the operation outright.
          destMin: minReceive,
          path: [],
          sendAmount,
          sendAsset: assets.send,
        }))
        .setTimeout(STELLAR_TRANSACTION_TIMEOUT_SECONDS)
        .build()
      transaction.sign(keypair)
      const onChainId = transaction.hash().toString('hex')

      // Durable before submission. An execution we cannot name is an execution
      // we cannot reconcile, and the only alternative to reconciling is guessing.
      await persistPrepared({ onChainId })

      try {
        const response = await server.submitTransaction(transaction)
        const responseHash = typeof response.hash === 'string' ? response.hash : onChainId
        if (responseHash !== onChainId) {
          this.logger.error('Stellar returned a different hash for a prepared execution', {
            preparedHashSuffix: transactionFingerprint(onChainId),
            responseHashSuffix: transactionFingerprint(responseHash),
          })
          return { onChainId, outcome: 'ambiguous', reason: 'stellar_submission_hash_mismatch' }
        }
        return {
          onChainId,
          outcome: 'confirmed',
          receivedAmount: await this.readExecutedAmount(server, onChainId),
        }
      }
      catch (error) {
        // Reconcile before classifying. A submission that timed out on the wire
        // may already be in the ledger, and calling that a failure would invite
        // a second trade of the same funds.
        const reconciled = await this.reconcileWithServer(server, onChainId)
        if (reconciled.outcome === 'confirmed') {
          return { onChainId, outcome: 'confirmed', receivedAmount: reconciled.receivedAmount }
        }
        if (reconciled.outcome === 'failed') {
          return { onChainId, outcome: 'failed', reason: 'stellar_execution_rejected' }
        }
        const reason = isAmbiguous(error) ? 'stellar_submission_ambiguous' : 'stellar_submission_failed'
        this.logger.warn('Stellar execution needs reconciliation', {
          direction: params.direction,
          reason,
          reconciliationOutcome: reconciled.outcome,
          status: errorStatus(error),
          transactionHashSuffix: transactionFingerprint(onChainId),
        })
        // `absent` still means ambiguous while the envelope's timebound is open:
        // Horizon not seeing it yet is not proof it will never be included.
        return { onChainId, outcome: 'ambiguous', reason }
      }
    })
  }

  public async quoteByReceive(
    direction: StablebondExecutionDirection,
    receiveAmount: Prisma.Decimal,
  ): Promise<null | StablebondQuote> {
    const amount = toStellarAmount(receiveAmount)
    if (new Prisma.Decimal(amount).lessThanOrEqualTo(0)) return null
    const [server, assets] = await Promise.all([this.buildServer(), this.resolveAssets(direction)])

    const response: unknown = await server
      .strictReceivePaths([assets.send], assets.receive, amount)
      .call()
    return this.firstDirectPath(response, direction, assets)
  }

  public async quoteBySend(
    direction: StablebondExecutionDirection,
    sendAmount: Prisma.Decimal,
  ): Promise<null | StablebondQuote> {
    const amount = toStellarAmount(sendAmount)
    if (new Prisma.Decimal(amount).lessThanOrEqualTo(0)) return null
    const [server, assets] = await Promise.all([this.buildServer(), this.resolveAssets(direction)])

    const response: unknown = await server
      .strictSendPaths(assets.send, amount, [assets.receive])
      .call()
    return this.firstDirectPath(response, direction, assets)
  }

  public async readTrustline(): Promise<StablebondTrustlineResult> {
    const config = this.requireConfig()
    const [horizonUrl, accountId] = await Promise.all([
      this.secretManager.getSecret(Secrets.STELLAR_HORIZON_URL),
      this.secretManager.getSecret(Secrets.STELLAR_ACCOUNT_ID),
    ])
    const account = await new Horizon.Server(horizonUrl).loadAccount(accountId)
    const line = account.balances.find(balance =>
      'asset_code' in balance
      && balance.asset_code === config.assetCode
      && balance.asset_issuer === config.issuer)
    if (!line || !('limit' in line)) return { outcome: 'absent' }

    return {
      balance: new Prisma.Decimal(line.balance),
      limit: new Prisma.Decimal(line.limit),
      outcome: 'present',
    }
  }

  public async reconcile(onChainId: string): Promise<StablebondReconciliation> {
    return this.reconcileWithServer(await this.buildServer(), onChainId)
  }

  private async buildServer(): Promise<Horizon.Server> {
    return new Horizon.Server(await this.secretManager.getSecret(Secrets.STELLAR_HORIZON_URL))
  }

  /**
   * Horizon returns paths best-first. Only direct paths are taken: a multi-hop
   * route through an unrelated asset adds venues whose depth we have not
   * measured, and the whole premise here is a fill we can predict.
   */
  private firstDirectPath(
    response: unknown,
    direction: StablebondExecutionDirection,
    assets: { receiveCode: string, sendCode: string },
  ): null | StablebondQuote {
    const parsed = pathResponseSchema.safeParse(response)
    if (!parsed.success) {
      this.logger.warn('Horizon returned an unrecognised path response')
      return null
    }
    const direct = parsed.data.records.find(record => record.path.length === 0)
    if (!direct) return null

    const sendAmount = new Prisma.Decimal(direct.source_amount)
    const receiveAmount = new Prisma.Decimal(direct.destination_amount)
    if (sendAmount.lessThanOrEqualTo(0) || receiveAmount.lessThanOrEqualTo(0)) return null

    return {
      direction,
      observedAt: new Date(),
      receiveAmount,
      receiveAsset: assets.receiveCode,
      sendAmount,
      sendAsset: assets.sendCode,
    }
  }

  /**
   * What the operation actually filled, read back from Horizon.
   *
   * Returns null rather than throwing when the read fails: by this point the
   * money has provably moved, and losing the measurement must not turn a settled
   * execution into an ambiguous one. A later reconcile fills the number in.
   */
  private async readExecutedAmount(
    server: Horizon.Server,
    onChainId: string,
  ): Promise<null | Prisma.Decimal> {
    try {
      const response: unknown = await server.operations().forTransaction(onChainId).call()
      const parsed = executedOperationSchema.safeParse(response)
      if (!parsed.success) return null
      const operation = parsed.data.records.find(record => record.type === 'path_payment_strict_send')
      if (!operation?.amount) return null
      const amount = new Prisma.Decimal(operation.amount)
      return amount.greaterThan(0) ? amount : null
    }
    catch {
      return null
    }
  }

  private async reconcileWithServer(
    server: Horizon.Server,
    onChainId: string,
  ): Promise<StablebondReconciliation> {
    try {
      const response: unknown = await server.transactions().transaction(onChainId).call()
      const parsed = z.object({ successful: z.boolean() }).passthrough().safeParse(response)
      if (!parsed.success) {
        return { outcome: 'unavailable', reason: 'stellar_reconciliation_invalid_response' }
      }
      if (!parsed.data.successful) return { outcome: 'failed' }
      return {
        onChainId,
        outcome: 'confirmed',
        receivedAmount: await this.readExecutedAmount(server, onChainId),
      }
    }
    catch (error) {
      if (errorStatus(error) === 404) return { outcome: 'absent' }
      return { outcome: 'unavailable', reason: 'stellar_reconciliation_unavailable' }
    }
  }

  private requireConfig(): StablebondConfig {
    if (!this.config) {
      throw new Error('Stablebond venue used while the position is disabled')
    }
    return this.config
  }

  /**
   * The two sides of the swap, in the order the path payment sends and receives
   * them. An acquisition spends the quote asset for bond tokens; an unwind is
   * exactly the reverse.
   *
   * The quote asset's issuer comes from the chain's own asset registry rather
   * than an environment variable, so it can never disagree with the one every
   * other Stellar payment already uses.
   */
  private async resolveAssets(direction: StablebondExecutionDirection): Promise<{
    receive: Asset
    receiveCode: string
    send: Asset
    sendCode: string
  }> {
    const config = this.requireConfig()
    const assetConfig = await this.assetConfigService.getActiveMint({
      blockchain: BlockchainNetwork.STELLAR,
      cryptoCurrency: config.receiveAsset,
    })
    if (!assetConfig) {
      throw new Error(`No active Stellar issuer configured for ${config.receiveAsset}`)
    }
    const bond = new Asset(config.assetCode, config.issuer)
    const quote = new Asset(config.receiveAsset, assetConfig.mintAddress)

    return direction === StablebondExecutionDirection.ACQUIRE
      ? { receive: bond, receiveCode: config.assetCode, send: quote, sendCode: config.receiveAsset }
      : { receive: quote, receiveCode: config.receiveAsset, send: bond, sendCode: config.assetCode }
  }

  /** Mirrors StellarWalletHandler: bid the network's p90 so a spike cannot strand the execution. */
  private async resolveFeeStroops(server: Horizon.Server): Promise<number> {
    const baseFee = await server.fetchBaseFee().catch(() => 100)
    try {
      const stats = await server.feeStats()
      const p90 = Number(stats.max_fee.p90)
      const candidate = Number.isFinite(p90) && p90 > 0 ? p90 : baseFee * 100
      return Math.max(baseFee, Math.min(candidate, MAX_STELLAR_FEE_STROOPS))
    }
    catch {
      return Math.max(baseFee, Math.min(baseFee * 100, MAX_STELLAR_FEE_STROOPS))
    }
  }
}

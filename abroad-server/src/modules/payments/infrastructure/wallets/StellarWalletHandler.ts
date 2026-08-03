import { BlockchainNetwork } from '@prisma/client'
import {
  Asset,
  Horizon,
  Keypair,
  Memo,
  Networks,
  Operation,
  Transaction,
  TransactionBuilder,
} from '@stellar/stellar-sdk'
import { inject, injectable } from 'inversify'
import { z } from 'zod'

import { TYPES } from '../../../../app/container/types'
import { createScopedLogger, ScopedLogger } from '../../../../core/logging/scopedLogger'
import { ILogger } from '../../../../core/logging/types'
import { ILockManager } from '../../../../platform/cacheLock/ILockManager'
import { ISecretManager, Secrets } from '../../../../platform/secrets/ISecretManager'
import {
  IWalletHandler,
  WalletDurableSendResult,
  WalletPreparedSend,
  WalletSendParams,
  WalletSendResult,
  WalletTransactionFeeResult,
  WalletTransactionReconciliationResult,
} from '../../application/contracts/IWalletHandler'
import { CryptoAssetConfigService } from '../../application/CryptoAssetConfigService'

// Horizon GET reads (loadAccount/fetchBaseFee) default to no HTTP timeout. Since the
// withdrawal critical section runs inside a Postgres SESSION advisory lock held until
// the function resolves, a hung read would hold that lock (and its DB connection) forever
// and stall every Stellar send cluster-wide. Bound the shared Horizon client so a hung
// read aborts the socket. submitTransaction keeps its own 60s cap (submit unchanged).
const HORIZON_HTTP_TIMEOUT_MS = 30_000
const STELLAR_TRANSACTION_TIMEOUT_SECONDS = 30
const STELLAR_WITHDRAWAL_LOCK_TIMEOUT_MS = 20_000
const stellarTransactionReconciliationSchema = z.object({ successful: z.boolean() }).passthrough()

type HttpErrorShape = {
  code?: unknown
  message?: unknown
  response?: {
    status?: unknown
  }
}

function asHttpError(error: unknown): HttpErrorShape {
  return error && typeof error === 'object' ? error as HttpErrorShape : {}
}

function errorMessage(error: unknown): string | undefined {
  const message = asHttpError(error).message
  return typeof message === 'string' ? message : undefined
}

function errorStatus(error: unknown): number | undefined {
  const status = asHttpError(error).response?.status
  return typeof status === 'number' ? status : undefined
}

function isAmbiguousSubmissionError(error: unknown): boolean {
  const status = errorStatus(error)
  const message = errorMessage(error)
  return status === 504
    || status === 408
    || status === 429
    || (typeof status === 'number' && status >= 500)
    || (typeof message === 'string' && /timeout|timed out|network|socket/i.test(message))
}

function safeMemo(m: string): string {
  // Memo.text must be <= 28 bytes (UTF-8). Trim if user passes longer text.
  const enc = new TextEncoder()
  if (enc.encode(m).length <= 28) return m
  let s = m
  while (enc.encode(s).length > 28 && s.length > 0) s = s.slice(0, -1)
  return s
}

function safeSubmissionFailureCode(error: unknown): string {
  const status = errorStatus(error)
  if (status === 429) return 'stellar_rate_limited'
  if (status === 408 || status === 504) return 'stellar_submission_timeout'
  if (typeof status === 'number' && status >= 500) return 'stellar_provider_unavailable'
  if (typeof status === 'number' && status >= 400) return 'stellar_submission_rejected'
  return isAmbiguousSubmissionError(error) ? 'stellar_submission_ambiguous' : 'stellar_submission_failed'
}

function toStellarAmount(n: number): string {
  // <= 7 decimals; strip trailing zeros and trailing dot
  return n.toFixed(7).replace(/\.?0+$/, '')
}

function transactionFingerprint(transactionId: string | undefined): string | undefined {
  return transactionId ? transactionId.slice(-8) : undefined
}

@injectable()
export class StellarWalletHandler implements IWalletHandler {
  public readonly capability = { blockchain: BlockchainNetwork.STELLAR }
  private readonly logger: ScopedLogger

  constructor(
    @inject(TYPES.ISecretManager) private secretManager: ISecretManager,
    @inject(CryptoAssetConfigService) private readonly assetConfigService: CryptoAssetConfigService,
    @inject(TYPES.ILockManager) private lockManager: ILockManager,
    @inject(TYPES.ILogger) baseLogger: ILogger,
  ) {
    this.logger = createScopedLogger(baseLogger, { scope: 'StellarWalletHandler' })
    // See HORIZON_HTTP_TIMEOUT_MS: bound Horizon reads so a hung request can't hold the
    // advisory lock forever. Idempotent; respects any timeout already configured. Null-safe
    // so the constructor never throws if the SDK's shared client is absent/mocked.
    const axiosDefaults = Horizon.AxiosClient?.defaults
    if (axiosDefaults && !axiosDefaults.timeout) {
      axiosDefaults.timeout = HORIZON_HTTP_TIMEOUT_MS
    }
  }

  async getAddressFromTransaction({ onChainId }: { onChainId?: string }): Promise<string> {
    if (!onChainId) {
      throw new Error('onChainId is required to get address from transaction')
    }

    const horizonUrl = await this.secretManager.getSecret(Secrets.STELLAR_HORIZON_URL)
    const server = new Horizon.Server(horizonUrl)
    try {
      const tx = await server.transactions().transaction(onChainId).call()
      if (typeof tx.source_account === 'string' && tx.source_account.trim()) {
        return tx.source_account
      }
    }
    catch {
      // Fall back to operation lookups for legacy on-chain identifiers.
    }

    try {
      const op = await server.operations().operation(onChainId).call()
      return typeof op.source_account === 'string' ? op.source_account : ''
    }
    catch (error) {
      this.logger.error('Error fetching Stellar transaction', { error, onChainId })
      throw new Error(`Failed to fetch transaction with ID ${onChainId}`)
    }
  }

  public async getTransactionFee(transactionId: string): Promise<WalletTransactionFeeResult> {
    try {
      const horizonUrl = await this.secretManager.getSecret(Secrets.STELLAR_HORIZON_URL)
      const server = new Horizon.Server(horizonUrl)
      const transaction = await server.transactions().transaction(transactionId).call()
      const feeStroops = Number(transaction.fee_charged)
      if (!Number.isSafeInteger(feeStroops) || feeStroops < 0) {
        return { outcome: 'unavailable', reason: 'stellar_fee_invalid' }
      }
      return {
        fee: { amount: (feeStroops / 10_000_000).toFixed(7), currency: 'XLM' },
        outcome: 'found',
      }
    }
    catch {
      return { outcome: 'pending', reason: 'stellar_transaction_read_pending' }
    }
  }

  public async reconcileTransaction(transactionId: string): Promise<WalletTransactionReconciliationResult> {
    const horizonUrl = await this.secretManager.getSecret(Secrets.STELLAR_HORIZON_URL)
    const server = new Horizon.Server(horizonUrl)
    return this.reconcileTransactionWithServer(server, transactionId)
  }

  async send({
    address,
    amount,
    cryptoCurrency,
    memo,
  }: WalletSendParams): Promise<WalletSendResult> {
    let preparedTransactionId: string | undefined
    try {
      const assetConfig = await this.assetConfigService.getActiveMint({
        blockchain: BlockchainNetwork.STELLAR,
        cryptoCurrency,
      })
      if (!assetConfig) {
        throw new Error(`Unsupported cryptocurrency for Stellar: ${cryptoCurrency}`)
      }

      const horizonUrl = await this.secretManager.getSecret(Secrets.STELLAR_HORIZON_URL)
      const privateKey = await this.secretManager.getSecret(Secrets.STELLAR_PRIVATE_KEY)

      const server = new Horizon.Server(horizonUrl)
      const sourceKeypair = Keypair.fromSecret(privateKey)
      const sourcePublicKey = sourceKeypair.publicKey()

      // 🔒 Serialize all txs per source account across ALL nodes
      const result = await this.lockManager.withLock(sourcePublicKey, STELLAR_WITHDRAWAL_LOCK_TIMEOUT_MS, async () => {
        const sourceAccount = await server.loadAccount(sourcePublicKey)
        const fee = await server.fetchBaseFee()

        const stellarAsset = new Asset(cryptoCurrency, assetConfig.mintAddress)
        const amountStr = toStellarAmount(amount)

        const builder = new TransactionBuilder(sourceAccount, {
          fee: fee.toString(),
          networkPassphrase: Networks.PUBLIC,
        })

        if (memo) builder.addMemo(Memo.text(safeMemo(memo)))

        builder.addOperation(
          Operation.payment({
            amount: amountStr,
            asset: stellarAsset,
            destination: address,
          }),
        )

        const tx = builder.setTimeout(STELLAR_TRANSACTION_TIMEOUT_SECONDS).build()
        tx.sign(sourceKeypair)
        preparedTransactionId = tx.hash().toString('hex')

        const submitResp = await this.submitWithRetry(server, tx)
        return submitResp.hash as string
      })

      return { success: true, transactionId: result }
    }
    catch (error: unknown) {
      const failureCode = safeSubmissionFailureCode(error)
      this.logger.error('Error sending Stellar transaction', {
        failureCode,
        status: errorStatus(error),
        transactionHashSuffix: transactionFingerprint(preparedTransactionId),
      })
      const failure = {
        code: errorStatus(error) === 400 ? 'permanent' : 'retriable',
        reason: failureCode,
        success: false,
      } as const
      return preparedTransactionId
        ? { ...failure, reconciliationRequired: true, transactionId: preparedTransactionId }
        : failure
    }
  }

  public async sendDurably(
    { address, amount, cryptoCurrency, memo }: WalletSendParams,
    persistPrepared: (prepared: WalletPreparedSend) => Promise<void>,
  ): Promise<WalletDurableSendResult> {
    const assetConfig = await this.assetConfigService.getActiveMint({
      blockchain: BlockchainNetwork.STELLAR,
      cryptoCurrency,
    })
    if (!assetConfig) {
      throw new Error(`Unsupported cryptocurrency for Stellar: ${cryptoCurrency}`)
    }

    const horizonUrl = await this.secretManager.getSecret(Secrets.STELLAR_HORIZON_URL)
    const privateKey = await this.secretManager.getSecret(Secrets.STELLAR_PRIVATE_KEY)
    const server = new Horizon.Server(horizonUrl)
    const sourceKeypair = Keypair.fromSecret(privateKey)
    const sourcePublicKey = sourceKeypair.publicKey()

    return this.lockManager.withLock(sourcePublicKey, STELLAR_WITHDRAWAL_LOCK_TIMEOUT_MS, async () => {
      const sourceAccount = await server.loadAccount(sourcePublicKey)
      const fee = await server.fetchBaseFee()
      const stellarAsset = new Asset(cryptoCurrency, assetConfig.mintAddress)
      const amountString = toStellarAmount(amount)
      const builder = new TransactionBuilder(sourceAccount, {
        fee: fee.toString(),
        networkPassphrase: Networks.PUBLIC,
      })

      if (memo) builder.addMemo(Memo.text(safeMemo(memo)))
      builder.addOperation(Operation.payment({
        amount: amountString,
        asset: stellarAsset,
        destination: address,
      }))

      const expiresAt = new Date(Date.now() + STELLAR_TRANSACTION_TIMEOUT_SECONDS * 1_000)
      const transaction = builder.setTimeout(STELLAR_TRANSACTION_TIMEOUT_SECONDS).build()
      transaction.sign(sourceKeypair)
      const transactionId = transaction.hash().toString('hex')

      await persistPrepared({
        amount: amountString,
        expiresAt,
        signedEnvelopeXdr: transaction.toXDR(),
        transactionId,
      })

      try {
        const response = await server.submitTransaction(transaction)
        const responseHash = typeof response.hash === 'string' ? response.hash : transactionId
        if (responseHash !== transactionId) {
          this.logger.error('Stellar returned a different hash for a prepared transaction', {
            preparedHashSuffix: transactionFingerprint(transactionId),
            responseHashSuffix: transactionFingerprint(responseHash),
          })
          return {
            outcome: 'ambiguous',
            reason: 'stellar_submission_hash_mismatch',
            transactionId,
          }
        }
        return { outcome: 'confirmed', transactionId }
      }
      catch (error: unknown) {
        const reconciled = await this.reconcileTransactionWithServer(server, transactionId)
        if (reconciled.outcome === 'confirmed') {
          return { outcome: 'confirmed', transactionId }
        }

        const failureCode = safeSubmissionFailureCode(error)
        this.logger.warn('Stellar durable submission requires exact-hash reconciliation', {
          failureCode,
          reconciliationOutcome: reconciled.outcome,
          status: errorStatus(error),
          transactionHashSuffix: transactionFingerprint(transactionId),
        })
        return { outcome: 'ambiguous', reason: failureCode, transactionId }
      }
    })
  }

  private async reconcileTransactionWithServer(
    server: Horizon.Server,
    transactionId: string,
  ): Promise<WalletTransactionReconciliationResult> {
    try {
      const response: unknown = await server.transactions().transaction(transactionId).call()
      const parsed = stellarTransactionReconciliationSchema.safeParse(response)
      if (!parsed.success) {
        this.logger.warn('Stellar returned an invalid transaction reconciliation response', {
          failureCode: 'stellar_reconciliation_invalid_response',
          transactionHashSuffix: transactionFingerprint(transactionId),
        })
        return { outcome: 'unavailable', reason: 'stellar_reconciliation_invalid_response' }
      }
      return parsed.data.successful === false
        ? { outcome: 'failed', transactionId }
        : { outcome: 'confirmed', transactionId }
    }
    catch (error: unknown) {
      if (errorStatus(error) === 404) {
        return { outcome: 'absent' }
      }
      this.logger.warn('Unable to reconcile Stellar transaction by hash', {
        failureCode: 'stellar_reconciliation_unavailable',
        status: errorStatus(error),
        transactionHashSuffix: transactionFingerprint(transactionId),
      })
      return { outcome: 'unavailable', reason: 'stellar_reconciliation_unavailable' }
    }
  }

  /** Submit once; on 504 or timeout, check by hash and then resubmit the SAME envelope once. */
  private async submitWithRetry(server: Horizon.Server, tx: Transaction) {
    try {
      return await server.submitTransaction(tx)
    }
    catch (error: unknown) {
      const status = errorStatus(error)
      const message = errorMessage(error)

      const isTimeout
        = status === 504 || (typeof message === 'string' && /timeout|timed out/i.test(message))

      if (!isTimeout) throw error

      // Did it actually make it into the ledger?
      try {
        const hashHex = tx.hash().toString('hex')
        const existing = await server.transactions().transaction(hashHex).call()
        if (existing) return existing
      }
      catch {
        // not found; proceed to one resubmission
      }

      // Resubmit the exact same envelope ONCE
      return await server.submitTransaction(tx)
    }
  }
}

#!/usr/bin/env -S npx tsx
// src/stellar/index.ts

import { BlockchainNetwork, CryptoCurrency } from '@prisma/client'
import { Horizon } from '@stellar/stellar-sdk'
import { inject, injectable } from 'inversify'

import { TYPES } from '../../../../app/container/types'
import { createScopedLogger, ScopedLogger } from '../../../../core/logging/scopedLogger'
import { ILogger } from '../../../../core/logging/types'
import { QueueName } from '../../../../platform/messaging/queues'
import { OutboxDispatcher } from '../../../../platform/outbox/OutboxDispatcher'
import { IDatabaseClientProvider } from '../../../../platform/persistence/IDatabaseClientProvider'
import { ISecretManager } from '../../../../platform/secrets/ISecretManager'
import { IDepositVerifierRegistry } from '../../../payments/application/contracts/IDepositVerifier'
import { CryptoAssetConfigService } from '../../../payments/application/CryptoAssetConfigService'
import { StellarOrphanRefundService } from '../../../transactions/application/StellarOrphanRefundService'
import { PaymentReconciliationReason } from '../../../transactions/application/StellarTypes'

// Minimal stream handle types returned by stellar-sdk stream()
type StreamHandle = (() => void) | { close: () => void }

@injectable()
export class StellarListener {
  private accountId!: string
  private horizonUrl!: string
  private keepAlive?: ReturnType<typeof setInterval>
  private readonly logger: ScopedLogger
  private queueName = QueueName.RECEIVED_CRYPTO_TRANSACTION
  private server?: Horizon.Server
  // Keep strong references so the stream isn't GC'd.
  private stream?: StreamHandle
  private assetCache?: { assets: Map<string, CryptoCurrency>, expiresAt: number }
  private readonly assetCacheTtlMs = 60_000

  constructor(
    @inject(TYPES.IOutboxDispatcher) private readonly outboxDispatcher: OutboxDispatcher,
    @inject(TYPES.ISecretManager) private secretManager: ISecretManager,
    @inject(TYPES.IDatabaseClientProvider)
    private dbClientProvider: IDatabaseClientProvider,
    @inject(TYPES.IDepositVerifierRegistry) private readonly depositVerifierRegistry: IDepositVerifierRegistry,
    @inject(TYPES.StellarOrphanRefundService) private readonly orphanRefundService: StellarOrphanRefundService,
    @inject(CryptoAssetConfigService) private readonly assetConfigService: CryptoAssetConfigService,
    @inject(TYPES.ILogger) baseLogger: ILogger,
  ) {
    this.logger = createScopedLogger(baseLogger, { scope: 'StellarListener', staticPayload: { queue: this.queueName } })
  }

  /**
   * Converts a Base64 string to a UUID string.
   */
  private static base64ToUuid(base64: string): string {
    const buffer = Buffer.from(base64, 'base64')
    const hex = buffer.toString('hex')
    return [
      hex.substring(0, 8),
      hex.substring(8, 12),
      hex.substring(12, 16),
      hex.substring(16, 20),
      hex.substring(20),
    ].join('-')
  }

  /**
   * Listens to Stellar "payment" operations for the given account and
   * publishes valid messages to the RabbitMQ queue.
   */
  public async start(): Promise<void> {
    this.logger.info('Initializing listener')

    const {
      STELLAR_ACCOUNT_ID,
      STELLAR_HORIZON_URL,
    } = await this.secretManager.getSecrets([
      'STELLAR_ACCOUNT_ID',
      'STELLAR_HORIZON_URL',
    ])
    this.accountId = STELLAR_ACCOUNT_ID
    this.horizonUrl = STELLAR_HORIZON_URL

    this.logger.info('Initializing Horizon server for account', { accountId: this.accountId })

    const server = new Horizon.Server(this.horizonUrl)
    this.server = server
    const prismaClient = await this.dbClientProvider.getClient()

    const state = await prismaClient.stellarListenerState.findUnique({
      where: { id: 'singleton' },
    })
    this.logger.info('Retrieved listener state', state ?? {})

    const cursorServer = state?.lastPagingToken
      ? server.payments().cursor(state.lastPagingToken)
      : server.payments()
    this.logger.info(
      'Starting stream',
      state?.lastPagingToken ? { cursor: state.lastPagingToken } : { cursor: 'now' },
    )

    // Keep a reference to the stream handle returned by SDK
    this.stream = cursorServer.forAccount(this.accountId).stream({
      onerror: (err) => {
        this.logger.error('Stream error', err)
      },
      onmessage: async (payment) => {
        this.logger.info('Received payment from stream', { paymentId: payment.id })

        try {
          await prismaClient.stellarListenerState.upsert({
            create: {
              id: 'singleton',
              lastPagingToken: payment.paging_token,
            },
            update: { lastPagingToken: payment.paging_token },
            where: { id: 'singleton' },
          })
          this.logger.info('Updated listener state with paging token', { pagingToken: payment.paging_token })
        }
        catch (error) {
          this.logger.error('Error updating listener state', error)
        }

        if (payment.type !== 'payment') {
          this.logger.warn('Skipping message (wrong type)', { type: payment.type })
          return
        }

        if (payment.to !== this.accountId) {
          this.logger.warn(
            'Skipping payment (wrong recipient).',
            { recipient: payment.to },
          )
          return
        }

        const cryptoCurrency = await this.resolvePaymentAsset(payment)
        if (!cryptoCurrency) {
          this.logger.warn(
            'Skipping payment (unsupported asset).',
            {
              assetCode: payment.asset_code,
              assetIssuer: payment.asset_issuer,
              assetType: payment.asset_type,
            },
          )
          return
        }

        const tx: Horizon.ServerApi.TransactionRecord = await payment.transaction()
        const transactionHash = tx.id ?? payment.transaction_hash
        if (!transactionHash) {
          this.logger.error('Stellar transaction hash is missing', { paymentId: payment.id })
          return
        }
        this.logger.info('Fetched full transaction details', { cryptoCurrency, transactionId: transactionHash })

        if (!tx.memo) {
          await this.handleOrphanPayment(payment, 'missingMemo')
          return
        }

        // Convert memo to a UUID if needed
        const transactionId = StellarListener.base64ToUuid(tx.memo)

        try {
          const verifier = this.depositVerifierRegistry.getVerifier(BlockchainNetwork.STELLAR)
          const outcome = await verifier.verifyNotification(transactionHash, transactionId)
          if (outcome.outcome === 'error') {
            this.logger.warn('Skipping payment due to verification failure', {
              paymentId: payment.id,
              reason: outcome.reason,
              status: outcome.status,
              transactionId,
            })
            return
          }

          await this.outboxDispatcher.enqueueQueue(
            this.queueName,
            outcome.queueMessage,
            'stellar.listener',
            { deliverNow: true },
          )
          this.logger.info('Sent message to queue', { queueName: this.queueName, transactionId: transactionId })
        }
        catch (error) {
          this.logger.error(
            'Error sending message to queue',
            error,
          )
        }
      },
    })

    // Prevent GC of the stream by touching it periodically and keep event loop active
    this.keepAlive = setInterval(() => {
      // no-op; reference the stream so it's strongly reachable
      if (!this.stream) return
    }, 60_000)
  }

  /** Gracefully stop the stream and clear keep-alive. */
  public stop(): void {
    try {
      // SDKs may return an EventSource-like with close(), or a function to cancel
      if (typeof this.stream === 'function') {
        this.stream()
      }
      else if (this.stream && typeof this.stream.close === 'function') {
        this.stream.close()
      }
    }
    catch (err) {
      this.logger.error('Error while stopping stream', err)
    }
    finally {
      if (this.keepAlive) {
        clearInterval(this.keepAlive)
        this.keepAlive = undefined
      }
      this.stream = undefined
    }
  }

  private async handleOrphanPayment(
    payment: Horizon.ServerApi.PaymentOperationRecord,
    reason: PaymentReconciliationReason,
  ): Promise<void> {
    this.logger.warn('Received Stellar payment without memo; attempting refund', { paymentId: payment.id })
    const outcome = await this.orphanRefundService.refundOrphanPayment({ payment, reason })
    if (outcome.outcome === 'failed') {
      this.logger.error('Failed to refund orphan Stellar payment', { paymentId: payment.id })
    }
    else {
      this.logger.info('Processed orphan Stellar payment refund', {
        outcome: outcome.outcome,
        paymentId: payment.id,
        refundTransactionId: outcome.refundTransactionId,
      })
    }
  }

  private async resolvePaymentAsset(
    payment: Horizon.ServerApi.PaymentOperationRecord,
  ): Promise<CryptoCurrency | null> {
    if (payment.asset_type !== 'credit_alphanum4' && payment.asset_type !== 'credit_alphanum12') {
      return null
    }
    if (!payment.asset_code || !payment.asset_issuer) {
      return null
    }

    const assetMap = await this.getEnabledAssetMap()
    return assetMap.get(this.assetKey(payment.asset_code, payment.asset_issuer)) ?? null
  }

  private async getEnabledAssetMap(): Promise<Map<string, CryptoCurrency>> {
    const now = Date.now()
    if (this.assetCache && this.assetCache.expiresAt > now) {
      return this.assetCache.assets
    }

    const assets = await this.assetConfigService.listEnabledAssets(BlockchainNetwork.STELLAR)
    const map = new Map<string, CryptoCurrency>()
    assets.forEach(asset => {
      map.set(this.assetKey(asset.cryptoCurrency, asset.mintAddress), asset.cryptoCurrency)
    })

    this.assetCache = { assets: map, expiresAt: now + this.assetCacheTtlMs }
    return map
  }

  private assetKey(assetCode: string, issuer: string): string {
    return `${assetCode}:${issuer}`
  }
}

#!/usr/bin/env -S npx tsx
// src/stellar/index.ts

import { BlockchainNetwork, CryptoCurrency } from '@prisma/client'
import { Horizon } from '@stellar/stellar-sdk'
import { inject } from 'inversify'

import { TransactionQueueMessage } from '../../controllers/queue/ReceivedCryptoTransactionController'
import { ILogger, IQueueHandler, QueueName } from '../../interfaces'
import { IDatabaseClientProvider } from '../../interfaces/IDatabaseClientProvider'
import { ISecretManager } from '../../interfaces/ISecretManager'
import { createScopedLogger, ScopedLogger } from '../../shared/logging'
import { TYPES } from '../../types'

// Minimal stream handle types returned by stellar-sdk stream()
type StreamHandle = (() => void) | { close: () => void }

export class StellarListener {
  private accountId!: string
  private horizonUrl!: string
  private keepAlive?: ReturnType<typeof setInterval>
  private readonly logger: ScopedLogger
  private queueName = QueueName.RECEIVED_CRYPTO_TRANSACTION
  private server?: Horizon.Server
  // Keep strong references so the stream isn't GC'd.
  private stream?: StreamHandle
  private usdcIssuer!: string

  constructor(
    @inject(TYPES.IQueueHandler) private queueHandler: IQueueHandler,
    @inject(TYPES.ISecretManager) private secretManager: ISecretManager,
    @inject(TYPES.IDatabaseClientProvider)
    private dbClientProvider: IDatabaseClientProvider,
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

    this.accountId = await this.secretManager.getSecret('STELLAR_ACCOUNT_ID')
    this.horizonUrl = await this.secretManager.getSecret('STELLAR_HORIZON_URL')
    this.usdcIssuer = await this.secretManager.getSecret('STELLAR_USDC_ISSUER')

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

        // Filter for USDC payments
        if (
          payment.to !== this.accountId
          || payment.asset_type !== 'credit_alphanum4'
          || payment.asset_code !== 'USDC'
          || !payment.asset_issuer
        ) {
          this.logger.warn(
            'Skipping message (wrong type, recipient, or asset).',
            {
              assetCode: payment.asset_code,
              assetIssuer: payment.asset_issuer,
              assetType: payment.asset_type,
              recipient: payment.to,
              type: payment.type,
            },
          )
          return
        }

        const usdcAssetIssuers = [
          this.usdcIssuer,
        ]

        if (!usdcAssetIssuers.includes(payment.asset_issuer)) {
          this.logger.warn(
            'Skipping payment. USDC Asset Issuer is not allowed.',
            { assetIssuer: payment.asset_issuer },
          )
          return
        }

        const tx = await payment.transaction()
        this.logger.info('Fetched full transaction details', { transactionId: tx.id })

        if (!tx.memo) {
          this.logger.warn('Skipping message (no memo) in payment', { paymentId: payment.id })
          return
        }

        // Convert memo to a UUID if needed
        const transactionId = StellarListener.base64ToUuid(tx.memo)

        const queueMessage: TransactionQueueMessage = {
          addressFrom: payment.from,
          amount: parseFloat(payment.amount),
          blockchain: BlockchainNetwork.STELLAR,
          cryptoCurrency: CryptoCurrency.USDC,
          onChainId: payment.id,
          transactionId: transactionId,
        }

        try {
          await this.queueHandler.postMessage(this.queueName, queueMessage)
          this.logger.info(
            'Sent message to queue',
            { queueName: this.queueName, transactionId: queueMessage.transactionId },
          )
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
      console.error('[StellarListener] Error while stopping stream:', err)
    }
    finally {
      if (this.keepAlive) {
        clearInterval(this.keepAlive)
        this.keepAlive = undefined
      }
      this.stream = undefined
    }
  }
}

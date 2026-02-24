import { BlockchainNetwork, TransactionStatus } from '@prisma/client'
import { Horizon } from '@stellar/stellar-sdk'
import { inject, injectable } from 'inversify'

import { TYPES } from '../../../app/container/types'
import { ILogger } from '../../../core/logging/types'
import { QueueName } from '../../../platform/messaging/queues'
import { OutboxDispatcher } from '../../../platform/outbox/OutboxDispatcher'
import { IDatabaseClientProvider } from '../../../platform/persistence/IDatabaseClientProvider'
import { ISecretManager, Secrets } from '../../../platform/secrets/ISecretManager'
import { IDepositVerifierRegistry } from '../../payments/application/contracts/IDepositVerifier'

export type OpsTransactionReconciliationInput = {
  blockchain: BlockchainNetwork
  onChainTx: string
  transactionId?: string
}

export type OpsTransactionReconciliationResult = {
  blockchain: BlockchainNetwork
  onChainTx: string
  reason?: string
  result: OpsTransactionReconciliationResultCode
  transactionId: null | string
  transactionStatus: null | TransactionStatus
}

export type OpsTransactionReconciliationResultCode
  = 'alreadyProcessed'
    | 'enqueued'
    | 'failed'
    | 'invalid'
    | 'notFound'
    | 'unresolved'

type DerivedTransactionId
  = | { reason: string, result: OpsTransactionReconciliationResultCode, status: 'error' }
    | { status: 'ok', transactionId: string }

@injectable()
export class OpsTransactionReconciliationService {
  constructor(
    @inject(TYPES.IDatabaseClientProvider) private readonly dbProvider: IDatabaseClientProvider,
    @inject(TYPES.IDepositVerifierRegistry) private readonly verifierRegistry: IDepositVerifierRegistry,
    @inject(TYPES.IOutboxDispatcher) private readonly outboxDispatcher: OutboxDispatcher,
    @inject(TYPES.ISecretManager) private readonly secretManager: ISecretManager,
    @inject(TYPES.ILogger) private readonly logger: ILogger,
  ) {}

  public async reconcileHash(input: OpsTransactionReconciliationInput): Promise<OpsTransactionReconciliationResult> {
    const onChainTx = input.onChainTx.trim()
    const existing = await this.findTransactionByOnChainId(onChainTx)
    if (existing) {
      return {
        blockchain: input.blockchain,
        onChainTx,
        result: 'alreadyProcessed',
        transactionId: existing.id,
        transactionStatus: existing.status,
      }
    }

    if (input.blockchain === BlockchainNetwork.STELLAR) {
      const derived = await this.deriveStellarTransactionId(onChainTx)
      if (derived.status === 'error') {
        return {
          blockchain: input.blockchain,
          onChainTx,
          reason: derived.reason,
          result: derived.result,
          transactionId: null,
          transactionStatus: null,
        }
      }

      return this.reconcileWithVerifier({
        blockchain: BlockchainNetwork.STELLAR,
        onChainTx,
        transactionId: derived.transactionId,
      })
    }

    const transactionId = input.transactionId?.trim()
    if (!transactionId) {
      return {
        blockchain: input.blockchain,
        onChainTx,
        reason: 'transaction_id is required when hash is not linked',
        result: 'unresolved',
        transactionId: null,
        transactionStatus: null,
      }
    }

    return this.reconcileWithVerifier({
      blockchain: input.blockchain,
      onChainTx,
      transactionId,
    })
  }

  private async deriveStellarTransactionId(onChainTx: string): Promise<DerivedTransactionId> {
    let horizonUrl: string
    try {
      horizonUrl = await this.secretManager.getSecret(Secrets.STELLAR_HORIZON_URL)
    }
    catch (error: unknown) {
      this.logger.error('[OpsTransactionReconciliation] Failed to resolve STELLAR_HORIZON_URL', error)
      return { reason: 'Failed to resolve Stellar horizon URL', result: 'failed', status: 'error' }
    }

    const server = new Horizon.Server(horizonUrl)
    let transaction: Horizon.ServerApi.TransactionRecord
    try {
      transaction = await server.transactions().transaction(onChainTx).call()
    }
    catch (error: unknown) {
      const status = this.extractErrorStatus(error)
      if (status === 404) {
        return { reason: 'Transaction not found on Stellar', result: 'notFound', status: 'error' }
      }
      if (status === 400) {
        return { reason: 'Invalid Stellar transaction hash', result: 'invalid', status: 'error' }
      }

      this.logger.error('[OpsTransactionReconciliation] Failed to fetch Stellar transaction', {
        error,
        onChainTx,
      })
      return { reason: 'Failed to fetch Stellar transaction', result: 'failed', status: 'error' }
    }

    const memo = transaction.memo?.trim()
    if (!memo) {
      return { reason: 'Payment is missing memo', result: 'invalid', status: 'error' }
    }

    const transactionId = this.memoToUuid(memo)
    if (!transactionId) {
      return { reason: 'Payment memo has invalid format', result: 'invalid', status: 'error' }
    }

    return { status: 'ok', transactionId }
  }

  private extractErrorStatus(error: unknown): number | undefined {
    if (!error || typeof error !== 'object') {
      return undefined
    }

    if ('response' in error) {
      const status = (error as { response?: { status?: unknown } }).response?.status
      if (typeof status === 'number') {
        return status
      }
    }

    if ('status' in error) {
      const status = (error as { status?: unknown }).status
      if (typeof status === 'number') {
        return status
      }
    }

    return undefined
  }

  private async findTransactionByOnChainId(onChainTx: string): Promise<null | { id: string, status: TransactionStatus }> {
    const prisma = await this.dbProvider.getClient()
    return prisma.transaction.findUnique({
      select: {
        id: true,
        status: true,
      },
      where: { onChainId: onChainTx },
    })
  }

  private async getTransactionStatus(transactionId: string): Promise<null | TransactionStatus> {
    const prisma = await this.dbProvider.getClient()
    const transaction = await prisma.transaction.findUnique({
      select: { status: true },
      where: { id: transactionId },
    })
    return transaction?.status ?? null
  }

  private memoToUuid(memo: string): null | string {
    let buffer: Buffer
    try {
      buffer = Buffer.from(memo, 'base64')
    }
    catch {
      return null
    }

    if (buffer.length !== 16) {
      return null
    }

    const hex = buffer.toString('hex')
    return [
      hex.substring(0, 8),
      hex.substring(8, 12),
      hex.substring(12, 16),
      hex.substring(16, 20),
      hex.substring(20),
    ].join('-')
  }

  private async reconcileWithVerifier(params: {
    blockchain: BlockchainNetwork
    onChainTx: string
    transactionId: string
  }): Promise<OpsTransactionReconciliationResult> {
    const verifier = this.verifierRegistry.getVerifier(params.blockchain)
    const verification = await verifier.verifyNotification(params.onChainTx, params.transactionId)
    if (verification.outcome === 'error') {
      return {
        blockchain: params.blockchain,
        onChainTx: params.onChainTx,
        reason: verification.reason,
        result: verification.status === 404 ? 'notFound' : 'invalid',
        transactionId: params.transactionId,
        transactionStatus: await this.getTransactionStatus(params.transactionId),
      }
    }

    try {
      await this.outboxDispatcher.enqueueQueue(
        QueueName.RECEIVED_CRYPTO_TRANSACTION,
        verification.queueMessage,
        'ops.transactions.reconcile-hash',
        { deliverNow: true },
      )
    }
    catch (error: unknown) {
      this.logger.error('[OpsTransactionReconciliation] Failed to enqueue reconciliation message', {
        error,
        onChainTx: params.onChainTx,
        transactionId: verification.queueMessage.transactionId,
      })

      return {
        blockchain: params.blockchain,
        onChainTx: params.onChainTx,
        reason: 'Failed to enqueue reconciliation message',
        result: 'failed',
        transactionId: verification.queueMessage.transactionId,
        transactionStatus: await this.getTransactionStatus(verification.queueMessage.transactionId),
      }
    }

    const transactionStatus = await this.getTransactionStatus(verification.queueMessage.transactionId)
    return {
      blockchain: params.blockchain,
      onChainTx: params.onChainTx,
      result: 'enqueued',
      transactionId: verification.queueMessage.transactionId,
      transactionStatus,
    }
  }
}

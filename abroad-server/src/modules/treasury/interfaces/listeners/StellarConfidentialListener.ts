import { BlockchainNetwork } from '@prisma/client'
import { rpc } from '@stellar/stellar-sdk'
import { inject, injectable } from 'inversify'

import { TYPES } from '../../../../app/container/types'
import { createScopedLogger, ScopedLogger } from '../../../../core/logging/scopedLogger'
import { ILogger } from '../../../../core/logging/types'
import { QueueName } from '../../../../platform/messaging/queues'
import { OutboxDispatcher } from '../../../../platform/outbox/OutboxDispatcher'
import { IDatabaseClientProvider } from '../../../../platform/persistence/IDatabaseClientProvider'
import { ISecretManager } from '../../../../platform/secrets/ISecretManager'
import { IConfidentialDepositVerifier } from '../../../payments/application/contracts/IDepositVerifier'
import { CryptoAssetConfigService } from '../../../payments/application/CryptoAssetConfigService'

const LISTENER_STATE_ID = 'singleton'
const POLL_INTERVAL_MS = 10_000
const PAGE_SIZE = 100

/**
 * Finds confidential deposits by polling Soroban RPC for contract events.
 *
 * This is a second listener rather than a branch inside `StellarListener` because
 * a confidential transfer is a Soroban `invoke_host_function` that emits contract
 * events — Horizon does not index it as a payment, so it can never appear on the
 * payments stream the classic listener consumes. Keeping them apart also means the
 * classic path is untouched by this feature rather than merely guarded.
 *
 * Events are used only to notice that a transaction exists. Everything that
 * decides whether money moves is re-read from the transaction by the verifier.
 *
 * The cursor advances only after a page has been processed, so a crash re-reads
 * the page. That is safe: the deposit journal is keyed on the on-chain id, and the
 * verifier refuses an on-chain id already linked to another transaction.
 *
 * Operationally, that also means an outage longer than the RPC's event-retention
 * window leaves a cursor the node can no longer resolve. The poll then fails
 * loudly every tick and stops making progress until an operator clears
 * `StellarConfidentialListenerState`, which restarts from the current ledger and
 * skips the gap — deposits inside it need reconciling by hand.
 *
 * Nothing starts unless a `ConfidentialAssetConfig` row is enabled.
 */
@injectable()
export class StellarConfidentialListener {
  private contractIds: string[] = []
  private readonly logger: ScopedLogger
  private poller?: ReturnType<typeof setInterval>
  private polling = false
  private readonly queueName = QueueName.RECEIVED_CRYPTO_TRANSACTION
  private server?: rpc.Server

  constructor(
    @inject(TYPES.IOutboxDispatcher) private readonly outboxDispatcher: OutboxDispatcher,
    @inject(TYPES.ISecretManager) private readonly secretManager: ISecretManager,
    @inject(TYPES.IDatabaseClientProvider) private readonly dbClientProvider: IDatabaseClientProvider,
    @inject(TYPES.IConfidentialDepositVerifier) private readonly verifier: IConfidentialDepositVerifier,
    @inject(CryptoAssetConfigService) private readonly assetConfigService: CryptoAssetConfigService,
    @inject(TYPES.ILogger) baseLogger: ILogger,
  ) {
    this.logger = createScopedLogger(baseLogger, {
      scope: 'StellarConfidentialListener',
      staticPayload: { queue: this.queueName },
    })
  }

  public async start(): Promise<void> {
    this.contractIds = await this.assetConfigService.listEnabledConfidentialContracts(BlockchainNetwork.STELLAR)
    if (this.contractIds.length === 0) {
      this.logger.info('No confidential assets enabled; listener idle')
      return
    }

    const rpcUrl = await this.secretManager.getSecret('SOROBAN_RPC_URL')
    this.server = new rpc.Server(rpcUrl)
    this.logger.info('Starting confidential event poll', { contracts: this.contractIds.length })

    this.poller = setInterval(() => {
      void this.pollOnce()
    }, POLL_INTERVAL_MS)

    await this.pollOnce()
  }

  public stop(): void {
    if (this.poller) {
      clearInterval(this.poller)
      this.poller = undefined
    }
    this.server = undefined
  }

  private async loadCursor(): Promise<string | undefined> {
    const prisma = await this.dbClientProvider.getClient()
    const state = await prisma.stellarConfidentialListenerState.findUnique({
      where: { id: LISTENER_STATE_ID },
    })
    return state?.lastCursor
  }

  /** Runs one page of events; overlapping runs are skipped rather than queued. */
  private async pollOnce(): Promise<void> {
    const server = this.server
    if (!server || this.polling) {
      return
    }
    this.polling = true

    try {
      const cursor = await this.loadCursor()
      const page = await server.getEvents({
        filters: [{ contractIds: this.contractIds, type: 'contract' }],
        limit: PAGE_SIZE,
        ...(cursor ? { cursor } : { startLedger: await this.resolveStartLedger(server) }),
      })

      for (const transactionHash of new Set(page.events.map(event => event.txHash))) {
        await this.processTransaction(transactionHash)
      }

      if (page.cursor) {
        await this.saveCursor(page.cursor)
      }
    }
    catch (error) {
      // Leave the cursor where it is; the next tick re-reads the same page.
      this.logger.error('Confidential event poll failed', error)
    }
    finally {
      this.polling = false
    }
  }

  private async processTransaction(transactionHash: string): Promise<void> {
    const transactionId = await this.verifier.resolveTransactionId(transactionHash)
    if (!transactionId) {
      this.logger.info('Skipping event without an Abroad transaction reference')
      return
    }

    const outcome = await this.verifier.verifyNotification(transactionHash, transactionId)
    if (outcome.outcome === 'error') {
      this.logger.warn('Skipping confidential transfer due to verification failure', {
        reason: outcome.reason,
        status: outcome.status,
        transactionId,
      })
      return
    }

    await this.outboxDispatcher.enqueueQueue(
      this.queueName,
      outcome.queueMessage,
      'stellar.confidential.listener',
      { deliverNow: true },
    )
    this.logger.info('Sent confidential deposit to queue', { queueName: this.queueName, transactionId })
  }

  /** First run has no cursor, so start from the current ledger rather than genesis. */
  private async resolveStartLedger(server: rpc.Server): Promise<number> {
    const latest = await server.getLatestLedger()
    return latest.sequence
  }

  private async saveCursor(cursor: string): Promise<void> {
    const prisma = await this.dbClientProvider.getClient()
    await prisma.stellarConfidentialListenerState.upsert({
      create: { id: LISTENER_STATE_ID, lastCursor: cursor },
      update: { lastCursor: cursor },
      where: { id: LISTENER_STATE_ID },
    })
  }
}

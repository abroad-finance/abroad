import { TransactionOrigin } from '@prisma/client'

import type { ISecretManager } from '../../../../platform/secrets/ISecretManager'

import { TransactionWebhookRouter } from '../../../../modules/transactions/application/TransactionWebhookRouter'
import { WebhookEvent } from '../../../../platform/notifications/IWebhookNotifier'
import { OutboxDispatcher } from '../../../../platform/outbox/OutboxDispatcher'
import { IDatabaseClientProvider } from '../../../../platform/persistence/IDatabaseClientProvider'
import { createMockLogger } from '../../../setup/mockFactories'

describe('TransactionWebhookRouter', () => {
  const primaryTarget = 'https://api-v3.production.decafapi.com/abroad/webhook'
  const sepTarget = 'https://sep-stellar.abroad.finance/webhooks/abroad/transactions'
  const payload = {
    data: { id: 'transaction-1' },
    event: WebhookEvent.TRANSACTION_UPDATED,
  }

  const buildRouter = (options?: {
    sepPartnerId?: string
    sepTarget?: null | string
  }) => {
    const partnerFindUnique = jest.fn(async () => (
      options?.sepTarget === null
        ? null
        : { webhookUrl: options?.sepTarget ?? sepTarget }
    ))
    const databaseClientProvider: IDatabaseClientProvider = {
      getClient: jest.fn(async () => ({
        partner: { findUnique: partnerFindUnique },
      }) as unknown as import('@prisma/client').PrismaClient),
    }
    const secretManager: ISecretManager = {
      getSecret: jest.fn(async () => options?.sepPartnerId ?? 'sep-partner-id'),
      getSecrets: jest.fn(),
    }
    const outboxDispatcher = {
      enqueueWebhook: jest.fn(async () => undefined),
    } as unknown as OutboxDispatcher
    const logger = createMockLogger()
    const router = new TransactionWebhookRouter(
      outboxDispatcher,
      databaseClientProvider,
      secretManager,
      logger,
    )

    return {
      databaseClientProvider,
      logger,
      outboxDispatcher,
      partnerFindUnique,
      router,
      secretManager,
    }
  }

  it('routes a direct transaction only to its owning partner', async () => {
    const {
      databaseClientProvider,
      outboxDispatcher,
      router,
      secretManager,
    } = buildRouter()

    await router.enqueue(
      ` ${primaryTarget} `,
      TransactionOrigin.DIRECT,
      payload,
      'transaction.updated',
      { deliverNow: false },
    )

    expect(outboxDispatcher.enqueueWebhook).toHaveBeenCalledTimes(1)
    expect(outboxDispatcher.enqueueWebhook).toHaveBeenCalledWith(
      primaryTarget,
      payload,
      'transaction.updated:https://api-v3.production.decafapi.com',
      { deliverNow: false },
    )
    expect(databaseClientProvider.getClient).not.toHaveBeenCalled()
    expect(secretManager.getSecret).not.toHaveBeenCalled()
  })

  it('creates one independently retryable row for partner and SEP targets', async () => {
    const { outboxDispatcher, router } = buildRouter()
    const client = { transaction: {} } as unknown as import('@prisma/client').PrismaClient

    await router.enqueue(
      primaryTarget,
      TransactionOrigin.SEP_24,
      payload,
      'transaction.updated',
      { client, deliverNow: false },
    )

    expect(outboxDispatcher.enqueueWebhook).toHaveBeenCalledTimes(2)
    expect(outboxDispatcher.enqueueWebhook).toHaveBeenNthCalledWith(
      1,
      primaryTarget,
      payload,
      'transaction.updated:https://api-v3.production.decafapi.com',
      { client, deliverNow: false },
    )
    expect(outboxDispatcher.enqueueWebhook).toHaveBeenNthCalledWith(
      2,
      sepTarget,
      payload,
      'transaction.updated:https://sep-stellar.abroad.finance',
      { client, deliverNow: false },
    )
  })

  it('deduplicates the SEP target when it is already the primary target', async () => {
    const { outboxDispatcher, router } = buildRouter({ sepTarget })

    await router.enqueue(
      ` ${sepTarget} `,
      TransactionOrigin.SEP_24,
      payload,
      'transaction.created',
    )

    expect(outboxDispatcher.enqueueWebhook).toHaveBeenCalledTimes(1)
    expect(outboxDispatcher.enqueueWebhook).toHaveBeenCalledWith(
      sepTarget,
      payload,
      'transaction.created:https://sep-stellar.abroad.finance',
      {},
    )
  })

  it('preserves primary delivery when a legacy SEP target cannot be resolved', async () => {
    const {
      logger,
      outboxDispatcher,
      router,
    } = buildRouter({ sepTarget: null })

    await router.enqueue(
      primaryTarget,
      TransactionOrigin.LEGACY,
      payload,
      'transaction.updated',
    )

    expect(outboxDispatcher.enqueueWebhook).toHaveBeenCalledTimes(1)
    expect(logger.warn).toHaveBeenCalledWith(
      '[TransactionWebhookRouter] Failed to resolve SEP webhook target; preserving primary delivery only',
      expect.any(Error),
    )
  })

  it('fails acceptance pre-resolution when a required SEP target is unavailable', async () => {
    const { router } = buildRouter({ sepTarget: null })

    await expect(router.resolveTargets(
      primaryTarget,
      TransactionOrigin.SEP_24,
      { requireSepTarget: true },
    )).rejects.toThrow('SEP webhook target is not configured')
  })
})

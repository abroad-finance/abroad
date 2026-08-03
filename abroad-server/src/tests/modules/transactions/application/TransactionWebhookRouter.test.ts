import { TransactionOrigin, WebhookCredentialMode, WebhookDeliveryPurpose } from '@prisma/client'
import { createHash } from 'node:crypto'

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
    managedSecret?: boolean
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
        partnerWebhookConfiguration: {
          findUnique: jest.fn(async () => (
            options?.managedSecret ? { activeSecretCiphertext: 'active-envelope' } : null
          )),
        },
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
      {
        deliverNow: false,
        partnerId: 'partner-1',
        transactionId: 'transaction-1',
      },
    )

    expect(outboxDispatcher.enqueueWebhook).toHaveBeenCalledTimes(1)
    expect(outboxDispatcher.enqueueWebhook).toHaveBeenCalledWith(
      primaryTarget,
      payload,
      'transaction.updated:https://api-v3.production.decafapi.com',
      {
        client: undefined,
        deliverNow: false,
        metadata: {
          partnerId: 'partner-1',
          transactionId: 'transaction-1',
          webhookCredentialMode: WebhookCredentialMode.LEGACY_ORIGIN,
          webhookPurpose: WebhookDeliveryPurpose.TRANSACTION,
        },
      },
    )
    expect(databaseClientProvider.getClient).toHaveBeenCalledTimes(1)
    expect(secretManager.getSecret).not.toHaveBeenCalled()
  })

  it('creates one independently retryable row for partner and SEP targets', async () => {
    const { outboxDispatcher, router } = buildRouter()
    const client = {
      partnerWebhookConfiguration: { findUnique: jest.fn(async () => null) },
      transaction: {},
    } as unknown as import('@prisma/client').PrismaClient

    await router.enqueue(
      primaryTarget,
      TransactionOrigin.SEP_24,
      payload,
      'transaction.updated',
      {
        client,
        deliverNow: false,
        partnerId: 'partner-1',
        transactionId: 'transaction-1',
      },
    )

    expect(outboxDispatcher.enqueueWebhook).toHaveBeenCalledTimes(2)
    expect(outboxDispatcher.enqueueWebhook).toHaveBeenNthCalledWith(
      1,
      primaryTarget,
      payload,
      'transaction.updated:https://api-v3.production.decafapi.com',
      {
        client,
        deliverNow: false,
        metadata: {
          partnerId: 'partner-1',
          transactionId: 'transaction-1',
          webhookCredentialMode: WebhookCredentialMode.LEGACY_ORIGIN,
          webhookPurpose: WebhookDeliveryPurpose.TRANSACTION,
        },
      },
    )
    expect(outboxDispatcher.enqueueWebhook).toHaveBeenNthCalledWith(
      2,
      sepTarget,
      payload,
      'transaction.updated:https://sep-stellar.abroad.finance',
      {
        client,
        deliverNow: false,
        metadata: {
          partnerId: undefined,
          transactionId: 'transaction-1',
          webhookCredentialMode: WebhookCredentialMode.LEGACY_ORIGIN,
          webhookPurpose: WebhookDeliveryPurpose.TRANSACTION,
        },
      },
    )
  })

  it('scopes a supplied idempotency key independently to every resolved target', async () => {
    const { outboxDispatcher, router } = buildRouter()
    const idempotencyKey = 'refund-recovery:completed:transaction-1:refund-hash'

    await router.enqueue(
      primaryTarget,
      TransactionOrigin.SEP_24,
      payload,
      'ops_refund_recovery',
      {
        idempotencyKey,
        partnerId: 'partner-1',
        transactionId: 'transaction-1',
      },
    )

    const fingerprint = (target: string): string => createHash('sha256').update(target).digest('hex').slice(0, 16)
    expect(outboxDispatcher.enqueueWebhook).toHaveBeenNthCalledWith(
      1,
      primaryTarget,
      payload,
      'ops_refund_recovery:https://api-v3.production.decafapi.com',
      expect.objectContaining({
        metadata: expect.objectContaining({
          idempotencyKey: `${idempotencyKey}:${fingerprint(primaryTarget)}`,
        }),
      }),
    )
    expect(outboxDispatcher.enqueueWebhook).toHaveBeenNthCalledWith(
      2,
      sepTarget,
      payload,
      'ops_refund_recovery:https://sep-stellar.abroad.finance',
      expect.objectContaining({
        metadata: expect.objectContaining({
          idempotencyKey: `${idempotencyKey}:${fingerprint(sepTarget)}`,
        }),
      }),
    )
  })

  it('deduplicates the SEP target when it is already the primary target', async () => {
    const { outboxDispatcher, router } = buildRouter({ sepTarget })

    await router.enqueue(
      ` ${sepTarget} `,
      TransactionOrigin.SEP_24,
      payload,
      'transaction.created',
      { partnerId: 'partner-1', transactionId: 'transaction-1' },
    )

    expect(outboxDispatcher.enqueueWebhook).toHaveBeenCalledTimes(1)
    expect(outboxDispatcher.enqueueWebhook).toHaveBeenCalledWith(
      sepTarget,
      payload,
      'transaction.created:https://sep-stellar.abroad.finance',
      {
        client: undefined,
        deliverNow: undefined,
        metadata: {
          partnerId: 'partner-1',
          transactionId: 'transaction-1',
          webhookCredentialMode: WebhookCredentialMode.LEGACY_ORIGIN,
          webhookPurpose: WebhookDeliveryPurpose.TRANSACTION,
        },
      },
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
      { partnerId: 'partner-1', transactionId: 'transaction-1' },
    )

    expect(outboxDispatcher.enqueueWebhook).toHaveBeenCalledTimes(1)
    expect(logger.warn).toHaveBeenCalledWith(
      '[TransactionWebhookRouter] Failed to resolve SEP webhook target; preserving primary delivery only',
      expect.any(Error),
    )
  })

  it('pins managed credentials only after the partner has an active managed secret', async () => {
    const { outboxDispatcher, router } = buildRouter({ managedSecret: true })

    await router.enqueue(
      primaryTarget,
      TransactionOrigin.DIRECT,
      payload,
      'transaction.updated',
      { partnerId: 'partner-1', transactionId: 'transaction-1' },
    )

    expect(outboxDispatcher.enqueueWebhook).toHaveBeenCalledWith(
      primaryTarget,
      payload,
      'transaction.updated:https://api-v3.production.decafapi.com',
      expect.objectContaining({
        metadata: expect.objectContaining({
          partnerId: 'partner-1',
          webhookCredentialMode: WebhookCredentialMode.PARTNER_CURRENT,
        }),
      }),
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

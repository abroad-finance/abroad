import 'reflect-metadata'

import type { OutboxEvent, PartnerWebhookConfiguration, PrismaClient } from '@prisma/client'
import type { Agent } from 'node:https'

import {
  OutboxStatus,
  PartnerPortalRole,
  Prisma,
  WebhookCredentialMode,
  WebhookDeliveryPurpose,
} from '@prisma/client'

import { PartnerPortalAuditService } from '../../../../modules/partners/application/PartnerPortalAuditService'
import { PartnerPortalSecretEnvelopeService } from '../../../../modules/partners/application/PartnerPortalSecretEnvelopeService'
import { PartnerPortalPrincipal } from '../../../../modules/partners/application/PartnerPortalSessionService'
import { PartnerPortalWebhookService, PartnerPortalWebhookValidationError } from '../../../../modules/partners/application/PartnerPortalWebhookService'
import { PartnerWebhookSecretResolver } from '../../../../modules/partners/application/PartnerWebhookSecretResolver'
import { WebhookEvent } from '../../../../platform/notifications/IWebhookNotifier'
import { WebhookTargetPolicy } from '../../../../platform/notifications/WebhookTargetPolicy'
import { OutboxDispatcher } from '../../../../platform/outbox/OutboxDispatcher'
import { IDatabaseClientProvider } from '../../../../platform/persistence/IDatabaseClientProvider'

type TransactionCallback = (transaction: Prisma.TransactionClient) => Promise<unknown>

const principal: PartnerPortalPrincipal = {
  authenticationSource: 'PARTNER_PORTAL',
  email: 'admin@decaf.so',
  kind: 'partner_portal',
  mfaEnabled: true,
  mfaVerified: true,
  partner: { id: 'partner-1', name: 'Decaf' } as PartnerPortalPrincipal['partner'],
  role: PartnerPortalRole.ADMIN,
  userId: 'portal-user-1',
}

const webhookConfiguration = (
  overrides: Partial<PartnerWebhookConfiguration> = {},
): PartnerWebhookConfiguration => ({
  activeSecretCiphertext: 'active-envelope',
  activeSecretPrefix: 'whsec_active',
  activeSecretVersion: 2,
  createdAt: new Date('2026-08-01T12:00:00.000Z'),
  lastTestDurationMs: 125,
  lastTestedAt: new Date(),
  lastTestedRevision: 4,
  lastTestFailureCode: null,
  lastTestHttpStatus: 204,
  lastTestSucceeded: true,
  partnerId: principal.partner.id,
  pendingRevision: 4,
  pendingSecretCiphertext: 'pending-envelope',
  pendingSecretPrefix: 'whsec_pending',
  pendingUrl: 'https://hooks.partner.example/events',
  updatedAt: new Date('2026-08-01T12:00:00.000Z'),
  ...overrides,
})

const outboxEvent = (overrides: Partial<OutboxEvent> = {}): OutboxEvent => ({
  attempts: 1,
  availableAt: new Date('2026-08-01T12:00:00.000Z'),
  createdAt: new Date('2026-08-01T12:00:00.000Z'),
  id: 'delivery-1',
  idempotencyKey: 'webhook-test-key',
  initiatedByPortalUserId: principal.userId,
  lastAttemptDurationMs: 125,
  lastError: null,
  lastHttpStatus: 204,
  maxAttempts: 1,
  partnerId: principal.partner.id,
  payload: {},
  sourceOutboxEventId: null,
  status: OutboxStatus.DELIVERED,
  transactionId: null,
  type: 'webhook',
  updatedAt: new Date('2026-08-01T12:00:01.000Z'),
  webhookCredentialMode: WebhookCredentialMode.PARTNER_PENDING,
  webhookEvent: WebhookEvent.WEBHOOK_TEST,
  webhookPurpose: WebhookDeliveryPurpose.TEST,
  ...overrides,
})

const buildHarness = (
  configuration: null | PartnerWebhookConfiguration = webhookConfiguration(),
) => {
  const destroyAgent = jest.fn<void, []>()
  const configFindUnique = jest.fn(async () => configuration)
  const configCreate = jest.fn(async () => configuration ?? webhookConfiguration())
  const configUpdateMany = jest.fn<
    Promise<{ count: number }>,
    [Prisma.PartnerWebhookConfigurationUpdateManyArgs]
  >(async () => ({ count: 1 }))
  const configUpsert = jest.fn<
    Promise<PartnerWebhookConfiguration>,
    [{
      create: Record<string, unknown>
      update: Record<string, unknown>
      where: { partnerId: string }
    }]
  >(async () => configuration ?? webhookConfiguration())
  const partnerFindUnique = jest.fn(async () => ({
    webhookUrl: 'https://hooks.partner.example/active',
  }))
  const partnerUpdate = jest.fn(async () => principal.partner)
  const transactionClient = {
    partner: { update: partnerUpdate },
    partnerWebhookConfiguration: {
      create: configCreate,
      updateMany: configUpdateMany,
      upsert: configUpsert,
    },
  }
  const databaseTransaction = jest.fn<Promise<unknown>, [TransactionCallback]>(
    async callback => callback(transactionClient as unknown as Prisma.TransactionClient),
  )
  const deliveryFindUnique = jest.fn(async () => outboxEvent())
  const databaseClientProvider: IDatabaseClientProvider = {
    getClient: jest.fn(async () => ({
      $transaction: databaseTransaction,
      outboxEvent: { findUnique: deliveryFindUnique },
      partner: { findUnique: partnerFindUnique },
      partnerWebhookConfiguration: { findUnique: configFindUnique },
    }) as unknown as PrismaClient),
  }
  const enqueueWebhook = jest.fn(async () => outboxEvent({ attempts: 0, status: OutboxStatus.PENDING }))
  const auditRecord = jest.fn(async () => undefined)
  const decrypt = jest.fn(async () => 'pending-plaintext')
  const encrypt = jest.fn(async () => 'encrypted-envelope')
  const secretContext = jest.fn((partnerId: string, state: 'active' | 'pending') => (
    `partner-portal:webhook:${partnerId}:${state}`
  ))
  const validate = jest.fn(async (rawUrl: string) => ({
    httpsAgent: { destroy: destroyAgent } as unknown as Agent,
    url: new URL(rawUrl).toString(),
  }))

  return {
    auditRecord,
    configCreate,
    configFindUnique,
    configUpdateMany,
    configUpsert,
    databaseTransaction,
    decrypt,
    deliveryFindUnique,
    destroyAgent,
    encrypt,
    enqueueWebhook,
    partnerFindUnique,
    partnerUpdate,
    secretContext,
    service: new PartnerPortalWebhookService(
      databaseClientProvider,
      { enqueueWebhook } as unknown as OutboxDispatcher,
      { record: auditRecord } as unknown as PartnerPortalAuditService,
      { decrypt, encrypt } as unknown as PartnerPortalSecretEnvelopeService,
      { secretContext } as unknown as PartnerWebhookSecretResolver,
      { validate } as unknown as WebhookTargetPolicy,
    ),
    validate,
  }
}

describe('PartnerPortalWebhookService', () => {
  it('returns only safe active/draft metadata and hides stale test evidence', async () => {
    const harness = buildHarness(webhookConfiguration({
      lastTestedRevision: 3,
      pendingRevision: 4,
    }))

    const result = await harness.service.getConfiguration(principal.partner.id)

    expect(result).toEqual({
      active: {
        managedSecret: true,
        secretPrefix: 'whsec_active',
        url: 'https://hooks.partner.example/active',
        version: 2,
      },
      pending: {
        lastTest: null,
        revision: 4,
        rotatesSecret: true,
        secretPrefix: 'whsec_pending',
        url: 'https://hooks.partner.example/events',
      },
    })
    expect(JSON.stringify(result)).not.toContain('envelope')
  })

  it('stages only a validated canonical URL and invalidates prior test proof', async () => {
    const harness = buildHarness()

    await harness.service.stageUrl(
      principal,
      'https://hooks.partner.example/new-events',
    )

    expect(harness.validate).toHaveBeenCalledWith(
      'https://hooks.partner.example/new-events',
    )
    expect(harness.destroyAgent).toHaveBeenCalledTimes(1)
    expect(harness.configUpsert).toHaveBeenCalledWith({
      create: {
        partnerId: principal.partner.id,
        pendingRevision: 1,
        pendingUrl: 'https://hooks.partner.example/new-events',
      },
      update: expect.objectContaining({
        lastTestedAt: null,
        lastTestedRevision: null,
        lastTestSucceeded: null,
        pendingRevision: { increment: 1 },
        pendingUrl: 'https://hooks.partner.example/new-events',
      }),
      where: { partnerId: principal.partner.id },
    })
  })

  it('stages an encrypted signing-secret rotation and reveals only the generated plaintext', async () => {
    const harness = buildHarness()

    const result = await harness.service.rotateSecret(principal)

    expect(result.secret).toMatch(/^whsec_[A-Za-z0-9_-]{43}$/u)
    expect(harness.encrypt).toHaveBeenCalledWith(
      result.secret,
      'partner-portal:webhook:partner-1:pending',
    )
    const persisted = harness.configUpdateMany.mock.calls[0][0]
    expect(persisted.data).toEqual(expect.objectContaining({
      pendingSecretCiphertext: 'encrypted-envelope',
      pendingSecretPrefix: result.secret.slice(0, 14),
    }))
    expect(JSON.stringify(persisted)).not.toContain(result.secret)
    expect(JSON.stringify(result.configuration)).not.toContain(result.secret)
  })

  it('returns no secret when a concurrent draft change wins the rotation race', async () => {
    const harness = buildHarness()
    harness.configUpdateMany.mockResolvedValueOnce({ count: 0 })

    await expect(harness.service.rotateSecret(principal)).rejects.toThrow(
      'The webhook draft changed; retry the secret rotation',
    )
    expect(harness.auditRecord).not.toHaveBeenCalled()
  })

  it('creates the first managed configuration without an upsert race', async () => {
    const harness = buildHarness(null)

    const result = await harness.service.rotateSecret(principal)

    expect(harness.configCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        partnerId: principal.partner.id,
        pendingRevision: 1,
        pendingSecretCiphertext: 'encrypted-envelope',
        pendingSecretPrefix: result.secret.slice(0, 14),
        pendingUrl: 'https://hooks.partner.example/active',
      }),
    })
    expect(harness.configUpsert).not.toHaveBeenCalled()
  })

  it.each([
    [
      webhookConfiguration({ pendingSecretCiphertext: 'pending-envelope' }),
      WebhookCredentialMode.PARTNER_PENDING,
    ],
    [
      webhookConfiguration({ pendingSecretCiphertext: null }),
      WebhookCredentialMode.PARTNER_CURRENT,
    ],
    [
      webhookConfiguration({
        activeSecretCiphertext: null,
        pendingSecretCiphertext: null,
      }),
      WebhookCredentialMode.LEGACY_ORIGIN,
    ],
  ])('tests the exact draft credential mode and records safe diagnostics', async (
    configuration,
    expectedMode,
  ) => {
    const harness = buildHarness(configuration)

    const result = await harness.service.testDraft(principal)

    expect(result).toEqual(expect.objectContaining({
      deliveryId: 'delivery-1',
      durationMs: 125,
      failureCode: null,
      httpStatus: 204,
      status: OutboxStatus.DELIVERED,
    }))
    expect(harness.enqueueWebhook).toHaveBeenCalledWith(
      configuration.pendingUrl,
      expect.objectContaining({ event: WebhookEvent.WEBHOOK_TEST }),
      'partner-portal:webhook-test',
      expect.objectContaining({
        deliverNow: true,
        metadata: expect.objectContaining({
          maxAttempts: 1,
          partnerId: principal.partner.id,
          webhookCredentialMode: expectedMode,
          webhookPurpose: WebhookDeliveryPurpose.TEST,
        }),
      }),
    )
    expect(harness.configUpdateMany).toHaveBeenCalledWith({
      data: expect.objectContaining({
        lastTestedRevision: configuration.pendingRevision,
        lastTestSucceeded: true,
      }),
      where: {
        partnerId: principal.partner.id,
        pendingRevision: configuration.pendingRevision,
        pendingUrl: configuration.pendingUrl,
      },
    })
  })

  it('rejects a test result if the draft changed during delivery', async () => {
    const harness = buildHarness()
    harness.configUpdateMany.mockResolvedValueOnce({ count: 0 })

    await expect(harness.service.testDraft(principal)).rejects.toThrow(
      'The webhook draft changed while the test was running; test it again',
    )
    expect(harness.auditRecord).not.toHaveBeenCalled()
  })

  it('atomically activates only the recently tested exact revision', async () => {
    const configuration = webhookConfiguration()
    const harness = buildHarness(configuration)

    await harness.service.activate(principal)

    expect(harness.decrypt).toHaveBeenCalledWith(
      'pending-envelope',
      'partner-portal:webhook:partner-1:pending',
    )
    expect(harness.encrypt).toHaveBeenCalledWith(
      'pending-plaintext',
      'partner-portal:webhook:partner-1:active',
    )
    expect(harness.configUpdateMany).toHaveBeenCalledWith({
      data: expect.objectContaining({
        activeSecretCiphertext: 'encrypted-envelope',
        activeSecretPrefix: 'whsec_pending',
        activeSecretVersion: { increment: 1 },
        pendingSecretCiphertext: null,
        pendingUrl: null,
      }),
      where: {
        lastTestedAt: configuration.lastTestedAt,
        lastTestedRevision: configuration.pendingRevision,
        lastTestSucceeded: true,
        partnerId: principal.partner.id,
        pendingRevision: configuration.pendingRevision,
        pendingUrl: configuration.pendingUrl,
      },
    })
    expect(harness.partnerUpdate).toHaveBeenCalledWith({
      data: { webhookUrl: configuration.pendingUrl },
      where: { id: principal.partner.id },
    })
  })

  it('does not promote a stale activation proof or an expired successful test', async () => {
    const staleHarness = buildHarness()
    staleHarness.configUpdateMany.mockResolvedValueOnce({ count: 0 })

    await expect(staleHarness.service.activate(principal)).rejects.toThrow(
      new PartnerPortalWebhookValidationError(
        'The webhook draft changed; test it again before activation',
      ),
    )
    expect(staleHarness.partnerUpdate).not.toHaveBeenCalled()

    const expiredHarness = buildHarness(webhookConfiguration({
      lastTestedAt: new Date(Date.now() - 16 * 60 * 1_000),
    }))
    await expect(expiredHarness.service.activate(principal)).rejects.toThrow(
      'Test the current webhook draft successfully before activation',
    )
    expect(expiredHarness.databaseTransaction).not.toHaveBeenCalled()
  })
})

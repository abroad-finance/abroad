import { OutboxStatus, Prisma, WebhookCredentialMode, WebhookDeliveryPurpose } from '@prisma/client'
import { inject, injectable } from 'inversify'
import { randomBytes, randomUUID } from 'node:crypto'

import { TYPES } from '../../../app/container/types'
import { WebhookEvent } from '../../../platform/notifications/IWebhookNotifier'
import { WebhookTargetPolicy, WebhookTargetValidationError } from '../../../platform/notifications/WebhookTargetPolicy'
import { OutboxDispatcher } from '../../../platform/outbox/OutboxDispatcher'
import { IDatabaseClientProvider } from '../../../platform/persistence/IDatabaseClientProvider'
import { PartnerPortalAuditService } from './PartnerPortalAuditService'
import { PartnerPortalSecretEnvelopeService } from './PartnerPortalSecretEnvelopeService'
import { PartnerPortalPrincipal } from './PartnerPortalSessionService'
import { PartnerWebhookSecretResolver } from './PartnerWebhookSecretResolver'

const ACTIVATION_TEST_TTL_MS = 15 * 60 * 1_000
const WEBHOOK_SECRET_BYTES = 32
const WEBHOOK_SECRET_PREFIX = 'whsec_'

export type PartnerPortalWebhookConfigurationDto = {
  active: {
    managedSecret: boolean
    secretPrefix: null | string
    url: null | string
    version: number
  }
  pending: null | {
    lastTest: null | PartnerPortalWebhookTestResult
    revision: number
    rotatesSecret: boolean
    secretPrefix: null | string
    url: string
  }
}

export type PartnerPortalWebhookSecretResult = {
  configuration: PartnerPortalWebhookConfigurationDto
  secret: string
}

export type PartnerPortalWebhookTestResult = {
  attemptedAt: Date
  deliveryId: null | string
  durationMs: null | number
  failureCode: null | string
  httpStatus: null | number
  status: OutboxStatus
}

export class PartnerPortalWebhookValidationError extends Error {
  public constructor(message: string) {
    super(message)
    this.name = 'PartnerPortalWebhookValidationError'
  }
}

@injectable()
export class PartnerPortalWebhookService {
  public constructor(
    @inject(TYPES.IDatabaseClientProvider)
    private readonly databaseClientProvider: IDatabaseClientProvider,
    @inject(TYPES.IOutboxDispatcher)
    private readonly outboxDispatcher: OutboxDispatcher,
    @inject(PartnerPortalAuditService)
    private readonly auditService: PartnerPortalAuditService,
    @inject(PartnerPortalSecretEnvelopeService)
    private readonly secretEnvelopeService: PartnerPortalSecretEnvelopeService,
    @inject(PartnerWebhookSecretResolver)
    private readonly secretResolver: PartnerWebhookSecretResolver,
    @inject(WebhookTargetPolicy)
    private readonly targetPolicy: WebhookTargetPolicy,
  ) {}

  public async activate(
    principal: PartnerPortalPrincipal,
  ): Promise<PartnerPortalWebhookConfigurationDto> {
    const prismaClient = await this.databaseClientProvider.getClient()
    const configuration = await prismaClient.partnerWebhookConfiguration.findUnique({
      where: { partnerId: principal.partner.id },
    })
    const now = new Date()
    if (
      !configuration?.pendingUrl
      || configuration.lastTestedRevision !== configuration.pendingRevision
      || configuration.lastTestSucceeded !== true
      || !configuration.lastTestedAt
      || now.getTime() - configuration.lastTestedAt.getTime() > ACTIVATION_TEST_TTL_MS
    ) {
      throw new PartnerPortalWebhookValidationError(
        'Test the current webhook draft successfully before activation',
      )
    }

    let activeSecretCiphertext: string | undefined
    if (configuration.pendingSecretCiphertext) {
      const pendingSecret = await this.secretEnvelopeService.decrypt(
        configuration.pendingSecretCiphertext,
        this.secretResolver.secretContext(principal.partner.id, 'pending'),
      )
      activeSecretCiphertext = await this.secretEnvelopeService.encrypt(
        pendingSecret,
        this.secretResolver.secretContext(principal.partner.id, 'active'),
      )
    }

    await prismaClient.$transaction(async (transaction) => {
      const activated = await transaction.partnerWebhookConfiguration.updateMany({
        data: {
          activeSecretCiphertext,
          activeSecretPrefix: configuration.pendingSecretCiphertext
            ? configuration.pendingSecretPrefix
            : undefined,
          activeSecretVersion: configuration.pendingSecretCiphertext
            ? { increment: 1 }
            : undefined,
          lastTestDurationMs: null,
          lastTestedAt: null,
          lastTestedRevision: null,
          lastTestFailureCode: null,
          lastTestHttpStatus: null,
          lastTestSucceeded: null,
          pendingSecretCiphertext: null,
          pendingSecretPrefix: null,
          pendingUrl: null,
        },
        where: {
          lastTestedAt: configuration.lastTestedAt,
          lastTestedRevision: configuration.pendingRevision,
          lastTestSucceeded: true,
          partnerId: principal.partner.id,
          pendingRevision: configuration.pendingRevision,
          pendingUrl: configuration.pendingUrl,
        },
      })
      if (activated.count !== 1) {
        throw new PartnerPortalWebhookValidationError(
          'The webhook draft changed; test it again before activation',
        )
      }
      await transaction.partner.update({
        data: { webhookUrl: configuration.pendingUrl },
        where: { id: principal.partner.id },
      })
      await this.auditService.record({
        action: 'webhook.activated',
        actorUserId: principal.userId,
        metadata: { secretRotated: Boolean(configuration.pendingSecretCiphertext) },
        partnerId: principal.partner.id,
        resourceId: principal.partner.id,
        resourceType: 'webhook_configuration',
      }, transaction)
    })
    return this.getConfiguration(principal.partner.id)
  }

  public async discardDraft(
    principal: PartnerPortalPrincipal,
  ): Promise<PartnerPortalWebhookConfigurationDto> {
    const prismaClient = await this.databaseClientProvider.getClient()
    await prismaClient.$transaction(async (transaction) => {
      await transaction.partnerWebhookConfiguration.updateMany({
        data: {
          lastTestDurationMs: null,
          lastTestedAt: null,
          lastTestedRevision: null,
          lastTestFailureCode: null,
          lastTestHttpStatus: null,
          lastTestSucceeded: null,
          pendingSecretCiphertext: null,
          pendingSecretPrefix: null,
          pendingUrl: null,
        },
        where: { partnerId: principal.partner.id },
      })
      await this.auditService.record({
        action: 'webhook.draft_discarded',
        actorUserId: principal.userId,
        partnerId: principal.partner.id,
        resourceId: principal.partner.id,
        resourceType: 'webhook_configuration',
      }, transaction)
    })
    return this.getConfiguration(principal.partner.id)
  }

  public async getConfiguration(
    partnerId: string,
  ): Promise<PartnerPortalWebhookConfigurationDto> {
    const prismaClient = await this.databaseClientProvider.getClient()
    const [partner, configuration] = await Promise.all([
      prismaClient.partner.findUnique({
        select: { webhookUrl: true },
        where: { id: partnerId },
      }),
      prismaClient.partnerWebhookConfiguration.findUnique({ where: { partnerId } }),
    ])
    const pending = configuration?.pendingUrl
      ? {
          lastTest: (
            configuration.lastTestedAt
            && configuration.lastTestedRevision === configuration.pendingRevision
          )
            ? {
                attemptedAt: configuration.lastTestedAt,
                deliveryId: null,
                durationMs: configuration.lastTestDurationMs,
                failureCode: configuration.lastTestFailureCode,
                httpStatus: configuration.lastTestHttpStatus,
                status: configuration.lastTestSucceeded
                  ? OutboxStatus.DELIVERED
                  : OutboxStatus.FAILED,
              }
            : null,
          revision: configuration.pendingRevision,
          rotatesSecret: Boolean(configuration.pendingSecretCiphertext),
          secretPrefix: configuration.pendingSecretPrefix,
          url: configuration.pendingUrl,
        }
      : null
    return {
      active: {
        managedSecret: Boolean(configuration?.activeSecretCiphertext),
        secretPrefix: configuration?.activeSecretPrefix ?? null,
        url: partner?.webhookUrl ?? null,
        version: configuration?.activeSecretVersion ?? 0,
      },
      pending,
    }
  }

  public async rotateSecret(
    principal: PartnerPortalPrincipal,
  ): Promise<PartnerPortalWebhookSecretResult> {
    const prismaClient = await this.databaseClientProvider.getClient()
    const [partner, configuration] = await Promise.all([
      prismaClient.partner.findUnique({
        select: { webhookUrl: true },
        where: { id: principal.partner.id },
      }),
      prismaClient.partnerWebhookConfiguration.findUnique({
        where: { partnerId: principal.partner.id },
      }),
    ])
    const target = configuration?.pendingUrl ?? partner?.webhookUrl
    if (!target) {
      throw new PartnerPortalWebhookValidationError(
        'Stage a webhook URL before rotating its signing secret',
      )
    }
    await this.validateTarget(target)
    const plaintext = `${WEBHOOK_SECRET_PREFIX}${randomBytes(WEBHOOK_SECRET_BYTES).toString('base64url')}`
    const encryptedSecret = await this.secretEnvelopeService.encrypt(
      plaintext,
      this.secretResolver.secretContext(principal.partner.id, 'pending'),
    )
    const secretPrefix = plaintext.slice(0, 14)
    try {
      await prismaClient.$transaction(async (transaction) => {
        if (configuration) {
          const updated = await transaction.partnerWebhookConfiguration.updateMany({
            data: {
              lastTestDurationMs: null,
              lastTestedAt: null,
              lastTestedRevision: null,
              lastTestFailureCode: null,
              lastTestHttpStatus: null,
              lastTestSucceeded: null,
              pendingRevision: { increment: 1 },
              pendingSecretCiphertext: encryptedSecret,
              pendingSecretPrefix: secretPrefix,
              pendingUrl: target,
            },
            where: {
              partnerId: principal.partner.id,
              pendingRevision: configuration.pendingRevision,
              pendingUrl: configuration.pendingUrl,
            },
          })
          if (updated.count !== 1) {
            throw new PartnerPortalWebhookValidationError(
              'The webhook draft changed; retry the secret rotation',
            )
          }
        }
        else {
          await transaction.partnerWebhookConfiguration.create({
            data: {
              partnerId: principal.partner.id,
              pendingRevision: 1,
              pendingSecretCiphertext: encryptedSecret,
              pendingSecretPrefix: secretPrefix,
              pendingUrl: target,
            },
          })
        }
        await this.auditService.record({
          action: 'webhook.secret_rotation_staged',
          actorUserId: principal.userId,
          partnerId: principal.partner.id,
          resourceId: principal.partner.id,
          resourceType: 'webhook_configuration',
        }, transaction)
      })
    }
    catch (error) {
      if (
        error instanceof PartnerPortalWebhookValidationError
        || (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
      ) {
        throw new PartnerPortalWebhookValidationError(
          'The webhook draft changed; retry the secret rotation',
        )
      }
      throw error
    }
    return {
      configuration: await this.getConfiguration(principal.partner.id),
      secret: plaintext,
    }
  }

  public async stageUrl(
    principal: PartnerPortalPrincipal,
    rawUrl: string,
  ): Promise<PartnerPortalWebhookConfigurationDto> {
    const url = await this.validateTarget(rawUrl)
    const prismaClient = await this.databaseClientProvider.getClient()
    await prismaClient.$transaction(async (transaction) => {
      await transaction.partnerWebhookConfiguration.upsert({
        create: {
          partnerId: principal.partner.id,
          pendingRevision: 1,
          pendingUrl: url,
        },
        update: {
          lastTestDurationMs: null,
          lastTestedAt: null,
          lastTestedRevision: null,
          lastTestFailureCode: null,
          lastTestHttpStatus: null,
          lastTestSucceeded: null,
          pendingRevision: { increment: 1 },
          pendingUrl: url,
        },
        where: { partnerId: principal.partner.id },
      })
      await this.auditService.record({
        action: 'webhook.url_staged',
        actorUserId: principal.userId,
        partnerId: principal.partner.id,
        resourceId: principal.partner.id,
        resourceType: 'webhook_configuration',
      }, transaction)
    })
    return this.getConfiguration(principal.partner.id)
  }

  public async testDraft(
    principal: PartnerPortalPrincipal,
  ): Promise<PartnerPortalWebhookTestResult> {
    const prismaClient = await this.databaseClientProvider.getClient()
    const configuration = await prismaClient.partnerWebhookConfiguration.findUnique({
      where: { partnerId: principal.partner.id },
    })
    if (!configuration?.pendingUrl) {
      throw new PartnerPortalWebhookValidationError('Stage a webhook draft before testing it')
    }
    const credentialMode = configuration.pendingSecretCiphertext
      ? WebhookCredentialMode.PARTNER_PENDING
      : configuration.activeSecretCiphertext
        ? WebhookCredentialMode.PARTNER_CURRENT
        : WebhookCredentialMode.LEGACY_ORIGIN
    const attemptedAt = new Date()
    const syntheticDeliveryId = randomUUID()
    const record = await this.outboxDispatcher.enqueueWebhook(
      configuration.pendingUrl,
      {
        data: {
          deliveryId: syntheticDeliveryId,
          sentAt: attemptedAt.toISOString(),
        },
        event: WebhookEvent.WEBHOOK_TEST,
      },
      'partner-portal:webhook-test',
      {
        deliverNow: true,
        metadata: {
          idempotencyKey: `partner-webhook-test:${principal.partner.id}:${configuration.pendingRevision}:${syntheticDeliveryId}`,
          initiatedByPortalUserId: principal.userId,
          maxAttempts: 1,
          partnerId: principal.partner.id,
          webhookCredentialMode: credentialMode,
          webhookPurpose: WebhookDeliveryPurpose.TEST,
        },
      },
    )
    if (!record) {
      throw new PartnerPortalWebhookValidationError('Webhook test could not be created')
    }
    const delivered = await prismaClient.outboxEvent.findUnique({ where: { id: record.id } })
    if (!delivered) {
      throw new PartnerPortalWebhookValidationError('Webhook test result is unavailable')
    }
    const succeeded = delivered.status === OutboxStatus.DELIVERED
    const result: PartnerPortalWebhookTestResult = {
      attemptedAt: delivered.updatedAt,
      deliveryId: delivered.id,
      durationMs: delivered.lastAttemptDurationMs,
      failureCode: succeeded
        ? null
        : delivered.lastHttpStatus ? 'http_error' : 'delivery_failed',
      httpStatus: delivered.lastHttpStatus,
      status: delivered.status,
    }
    await prismaClient.$transaction(async (transaction) => {
      const recorded = await transaction.partnerWebhookConfiguration.updateMany({
        data: {
          lastTestDurationMs: result.durationMs,
          lastTestedAt: result.attemptedAt,
          lastTestedRevision: configuration.pendingRevision,
          lastTestFailureCode: result.failureCode,
          lastTestHttpStatus: result.httpStatus,
          lastTestSucceeded: succeeded,
        },
        where: {
          partnerId: principal.partner.id,
          pendingRevision: configuration.pendingRevision,
          pendingUrl: configuration.pendingUrl,
        },
      })
      if (recorded.count !== 1) {
        throw new PartnerPortalWebhookValidationError(
          'The webhook draft changed while the test was running; test it again',
        )
      }
      await this.auditService.record({
        action: succeeded ? 'webhook.test_succeeded' : 'webhook.test_failed',
        actorUserId: principal.userId,
        metadata: {
          hasHttpStatus: result.httpStatus !== null,
          revision: configuration.pendingRevision,
        },
        partnerId: principal.partner.id,
        resourceId: delivered.id,
        resourceType: 'webhook_delivery',
      }, transaction)
    })
    return result
  }

  private async validateTarget(rawUrl: string): Promise<string> {
    try {
      const validated = await this.targetPolicy.validate(rawUrl)
      validated.httpsAgent.destroy()
      return validated.url
    }
    catch (error) {
      if (error instanceof WebhookTargetValidationError) {
        throw new PartnerPortalWebhookValidationError(error.message)
      }
      throw error
    }
  }
}

import {
  Prisma,
  PrismaClient,
  TransactionOrigin,
  WebhookCredentialMode,
  WebhookDeliveryPurpose,
} from '@prisma/client'
import { inject, injectable } from 'inversify'

import { TYPES } from '../../../app/container/types'
import { createScopedLogger, ScopedLogger } from '../../../core/logging/scopedLogger'
import { ILogger } from '../../../core/logging/types'
import { WebhookEvent } from '../../../platform/notifications/IWebhookNotifier'
import { OutboxDispatcher } from '../../../platform/outbox/OutboxDispatcher'
import { IDatabaseClientProvider } from '../../../platform/persistence/IDatabaseClientProvider'
import { ISecretManager } from '../../../platform/secrets/ISecretManager'

type EnqueueOptions = {
  client?: PrismaClientLike
  deliverNow?: boolean
  partnerId: string
  primaryTarget?: string
  transactionId: string
}

type PrismaClientLike = Prisma.TransactionClient | PrismaClient

type ResolveOptions = {
  requireSepTarget?: boolean
}

@injectable()
export class TransactionWebhookRouter {
  private readonly logger: ScopedLogger
  private sepWebhookTargetPromise?: Promise<string>

  public constructor(
    @inject(TYPES.IOutboxDispatcher)
    private readonly outboxDispatcher: OutboxDispatcher,
    @inject(TYPES.IDatabaseClientProvider)
    private readonly databaseClientProvider: IDatabaseClientProvider,
    @inject(TYPES.ISecretManager)
    private readonly secretManager: ISecretManager,
    @inject(TYPES.ILogger)
    baseLogger: ILogger,
  ) {
    this.logger = createScopedLogger(baseLogger, { scope: 'TransactionWebhookRouter' })
  }

  public async enqueue(
    primaryTarget: null | string,
    origin: TransactionOrigin,
    payload: { data: unknown, event: WebhookEvent },
    context: string,
    options: EnqueueOptions,
  ): Promise<void> {
    const targets = await this.resolveTargets(primaryTarget, origin)
    await this.enqueueTargets(targets, payload, context, {
      ...options,
      primaryTarget: primaryTarget ?? undefined,
    })
  }

  public async enqueueTargets(
    targets: readonly string[],
    payload: { data: unknown, event: WebhookEvent },
    context: string,
    options: EnqueueOptions,
  ): Promise<void> {
    const primaryCredentialMode = options.primaryTarget?.trim()
      ? await this.resolvePrimaryCredentialMode(options.partnerId, options.client)
      : WebhookCredentialMode.LEGACY_ORIGIN
    for (const target of this.normalizeTargets(targets)) {
      const isPrimaryTarget = Boolean(
        options.primaryTarget
        && target === options.primaryTarget.trim(),
      )
      await this.outboxDispatcher.enqueueWebhook(
        target,
        payload,
        `${context}:${this.targetOrigin(target)}`,
        {
          client: options.client,
          deliverNow: options.deliverNow,
          metadata: {
            partnerId: isPrimaryTarget ? options.partnerId : undefined,
            transactionId: options.transactionId,
            webhookCredentialMode: isPrimaryTarget
              ? primaryCredentialMode
              : WebhookCredentialMode.LEGACY_ORIGIN,
            webhookPurpose: WebhookDeliveryPurpose.TRANSACTION,
          },
        },
      )
    }
  }

  public async resolveTargets(
    primaryTarget: null | string,
    origin: TransactionOrigin,
    options: ResolveOptions = {},
  ): Promise<string[]> {
    const primaryTargets = this.normalizeTargets([primaryTarget ?? ''])
    if (origin === TransactionOrigin.DIRECT) {
      return primaryTargets
    }

    try {
      const sepTarget = await this.getSepWebhookTarget()
      return this.normalizeTargets([...primaryTargets, sepTarget])
    }
    catch (error) {
      this.sepWebhookTargetPromise = undefined
      const normalizedError = error instanceof Error ? error : new Error(String(error))

      if (options.requireSepTarget) {
        throw normalizedError
      }

      this.logger.warn(
        'Failed to resolve SEP webhook target; preserving primary delivery only',
        normalizedError,
      )
      return primaryTargets
    }
  }

  private async fetchSepWebhookTarget(): Promise<string> {
    const [prismaClient, sepPartnerId] = await Promise.all([
      this.databaseClientProvider.getClient(),
      this.secretManager.getSecret('STELLAR_SEP_PARTNER_ID'),
    ])

    const normalizedPartnerId = sepPartnerId.trim()
    if (!normalizedPartnerId) {
      throw new Error('SEP partner ID is not configured')
    }

    const sepPartner = await prismaClient.partner.findUnique({
      select: { webhookUrl: true },
      where: { id: normalizedPartnerId },
    })
    const [target] = this.normalizeTargets([sepPartner?.webhookUrl ?? ''])
    if (!target) {
      throw new Error('SEP webhook target is not configured')
    }

    return target
  }

  private getSepWebhookTarget(): Promise<string> {
    if (!this.sepWebhookTargetPromise) {
      this.sepWebhookTargetPromise = this.fetchSepWebhookTarget()
    }
    return this.sepWebhookTargetPromise
  }

  private normalizeTargets(targets: readonly string[]): string[] {
    const normalizedTargets: string[] = []
    const seen = new Set<string>()

    for (const target of targets) {
      const normalizedTarget = target.trim()
      if (!normalizedTarget || seen.has(normalizedTarget)) {
        continue
      }
      seen.add(normalizedTarget)
      normalizedTargets.push(normalizedTarget)
    }

    return normalizedTargets
  }

  private async resolvePrimaryCredentialMode(
    partnerId: string,
    client?: PrismaClientLike,
  ): Promise<WebhookCredentialMode> {
    const prismaClient = client ?? await this.databaseClientProvider.getClient()
    const configuration = await prismaClient.partnerWebhookConfiguration.findUnique({
      select: { activeSecretCiphertext: true },
      where: { partnerId },
    })
    return configuration?.activeSecretCiphertext
      ? WebhookCredentialMode.PARTNER_CURRENT
      : WebhookCredentialMode.LEGACY_ORIGIN
  }

  private targetOrigin(target: string): string {
    try {
      return new URL(target).origin
    }
    catch {
      return 'invalid-url'
    }
  }
}

import { PartnerPortalEmailDeliveryStatus, Prisma, PrismaClient } from '@prisma/client'
import { inject, injectable } from 'inversify'

import { TYPES } from '../../../app/container/types'
import { IDatabaseClientProvider } from '../../../platform/persistence/IDatabaseClientProvider'

const MAX_SERIALIZATION_ATTEMPTS = 3

export const partnerPortalVerificationTokenContext = (tokenId: string): string => (
  `partner-portal-email-verification:${tokenId}`
)

export type ResendLifecycleEventType
  = | 'email.bounced'
    | 'email.complained'
    | 'email.delivered'
    | 'email.delivery_delayed'
    | 'email.failed'
    | 'email.sent'
    | 'email.suppressed'

type DeliveryState = {
  deliveredAt: Date | null
  failureCode: null | string
  status: PartnerPortalEmailDeliveryStatus
}

type RecordedLifecycleEvent = {
  eventType: string
  occurredAt: Date
}

@injectable()
export class PartnerPortalEmailDeliveryLifecycleService {
  public constructor(
    @inject(TYPES.IDatabaseClientProvider)
    private readonly databaseClientProvider: IDatabaseClientProvider,
  ) {}

  public async recordAccepted(input: {
    providerMessageId: string
    tokenId: string
  }): Promise<void> {
    const prismaClient = await this.databaseClientProvider.getClient()
    await this.executeSerializable(prismaClient, async (transaction) => {
      const token = await transaction.partnerPortalEmailVerificationToken.findUnique({
        where: { id: input.tokenId },
      })
      if (!token) {
        throw new Error('Verification email token no longer exists')
      }
      if (token.providerMessageId && token.providerMessageId !== input.providerMessageId) {
        throw new Error('Verification email provider identity is inconsistent')
      }

      const pendingEvents = await transaction.partnerPortalEmailWebhookEvent.findMany({
        orderBy: [{ occurredAt: 'asc' }, { receivedAt: 'asc' }],
        where: {
          processedAt: null,
          providerMessageId: input.providerMessageId,
        },
      })
      const initialState: DeliveryState = {
        deliveredAt: token.deliveredAt,
        failureCode: token.deliveryFailureCode,
        status: token.deliveryStatus === PartnerPortalEmailDeliveryStatus.PENDING
          || token.deliveryStatus === PartnerPortalEmailDeliveryStatus.UNAVAILABLE
          ? PartnerPortalEmailDeliveryStatus.ACCEPTED
          : token.deliveryStatus,
      }
      const state = pendingEvents.reduce(
        (current, event) => this.applyEvent(current, event),
        initialState,
      )
      const now = new Date()
      await transaction.partnerPortalEmailVerificationToken.update({
        data: {
          deliveredAt: state.deliveredAt,
          deliveryFailureCode: state.failureCode,
          deliveryStatus: state.status,
          deliveryStatusUpdatedAt: now,
          providerMessageId: input.providerMessageId,
          sentAt: token.sentAt ?? now,
          tokenCiphertext: null,
        },
        where: { id: token.id },
      })
      if (pendingEvents.length > 0) {
        await transaction.partnerPortalEmailWebhookEvent.updateMany({
          data: { processedAt: now },
          where: { id: { in: pendingEvents.map(event => event.id) } },
        })
      }
    })
  }

  public async recordAttempt(tokenId: string): Promise<void> {
    const prismaClient = await this.databaseClientProvider.getClient()
    await prismaClient.partnerPortalEmailVerificationToken.update({
      data: {
        deliveryAttemptCount: { increment: 1 },
        lastDeliveryAttemptAt: new Date(),
      },
      where: { id: tokenId },
    })
  }

  public async recordFailure(input: {
    code: string
    terminal: boolean
    tokenId: string
  }): Promise<void> {
    const now = new Date()
    await (await this.databaseClientProvider.getClient())
      .partnerPortalEmailVerificationToken.updateMany({
        data: {
          deliveryFailureCode: input.code,
          deliveryStatus: input.terminal
            ? PartnerPortalEmailDeliveryStatus.FAILED
            : PartnerPortalEmailDeliveryStatus.PENDING,
          deliveryStatusUpdatedAt: now,
          tokenCiphertext: input.terminal ? null : undefined,
        },
        where: {
          id: input.tokenId,
          providerMessageId: null,
        },
      })
  }

  public async recordWebhook(input: {
    eventId: string
    eventType: ResendLifecycleEventType
    occurredAt: Date
    providerMessageId: string
  }): Promise<void> {
    const prismaClient = await this.databaseClientProvider.getClient()
    try {
      await this.executeSerializable(prismaClient, async (transaction) => {
        const existingEvent = await transaction.partnerPortalEmailWebhookEvent.findUnique({
          where: { id: input.eventId },
        })
        if (existingEvent) {
          return
        }
        await transaction.partnerPortalEmailWebhookEvent.create({
          data: {
            eventType: input.eventType,
            id: input.eventId,
            occurredAt: input.occurredAt,
            providerMessageId: input.providerMessageId,
          },
        })
        const token = await transaction.partnerPortalEmailVerificationToken.findUnique({
          where: { providerMessageId: input.providerMessageId },
        })
        if (!token) {
          return
        }
        const state = this.applyEvent({
          deliveredAt: token.deliveredAt,
          failureCode: token.deliveryFailureCode,
          status: token.deliveryStatus,
        }, input)
        const now = new Date()
        await transaction.partnerPortalEmailVerificationToken.update({
          data: {
            deliveredAt: state.deliveredAt,
            deliveryFailureCode: state.failureCode,
            deliveryStatus: state.status,
            deliveryStatusUpdatedAt: now,
          },
          where: { id: token.id },
        })
        await transaction.partnerPortalEmailWebhookEvent.update({
          data: { processedAt: now },
          where: { id: input.eventId },
        })
      })
    }
    catch (error) {
      if (this.isUniqueConstraintError(error)) {
        return
      }
      throw error
    }
  }

  private applyEvent(
    current: DeliveryState,
    event: RecordedLifecycleEvent,
  ): DeliveryState {
    switch (event.eventType) {
      case 'email.bounced':
        return this.applyTerminalProviderFailure(
          current,
          PartnerPortalEmailDeliveryStatus.BOUNCED,
          'PROVIDER_BOUNCED',
        )
      case 'email.complained':
        return this.isStatusOneOf(current.status, [
          PartnerPortalEmailDeliveryStatus.PENDING,
          PartnerPortalEmailDeliveryStatus.ACCEPTED,
          PartnerPortalEmailDeliveryStatus.DELAYED,
          PartnerPortalEmailDeliveryStatus.DELIVERED,
        ])
          ? { ...current, failureCode: 'PROVIDER_COMPLAINED', status: PartnerPortalEmailDeliveryStatus.COMPLAINED }
          : current
      case 'email.delivered':
        return this.isStatusOneOf(current.status, [
          PartnerPortalEmailDeliveryStatus.PENDING,
          PartnerPortalEmailDeliveryStatus.ACCEPTED,
          PartnerPortalEmailDeliveryStatus.DELAYED,
        ])
          ? {
              deliveredAt: current.deliveredAt ?? event.occurredAt,
              failureCode: null,
              status: PartnerPortalEmailDeliveryStatus.DELIVERED,
            }
          : current
      case 'email.delivery_delayed':
        return this.isStatusOneOf(current.status, [
          PartnerPortalEmailDeliveryStatus.PENDING,
          PartnerPortalEmailDeliveryStatus.ACCEPTED,
          PartnerPortalEmailDeliveryStatus.DELAYED,
        ])
          ? { ...current, failureCode: 'PROVIDER_DELAYED', status: PartnerPortalEmailDeliveryStatus.DELAYED }
          : current
      case 'email.failed':
        return this.applyTerminalProviderFailure(
          current,
          PartnerPortalEmailDeliveryStatus.FAILED,
          'PROVIDER_FAILED',
        )
      case 'email.sent':
        return current.status === PartnerPortalEmailDeliveryStatus.PENDING
          ? { ...current, failureCode: null, status: PartnerPortalEmailDeliveryStatus.ACCEPTED }
          : current
      case 'email.suppressed':
        return this.applyTerminalProviderFailure(
          current,
          PartnerPortalEmailDeliveryStatus.SUPPRESSED,
          'PROVIDER_SUPPRESSED',
        )
      default:
        return current
    }
  }

  private applyTerminalProviderFailure(
    current: DeliveryState,
    status: PartnerPortalEmailDeliveryStatus,
    failureCode: string,
  ): DeliveryState {
    return this.isStatusOneOf(current.status, [
      PartnerPortalEmailDeliveryStatus.PENDING,
      PartnerPortalEmailDeliveryStatus.ACCEPTED,
      PartnerPortalEmailDeliveryStatus.DELAYED,
    ])
      ? { ...current, failureCode, status }
      : current
  }

  private async executeSerializable<TResult>(
    prismaClient: PrismaClient,
    operation: (transaction: Prisma.TransactionClient) => Promise<TResult>,
  ): Promise<TResult> {
    for (let attempt = 1; attempt <= MAX_SERIALIZATION_ATTEMPTS; attempt += 1) {
      try {
        return await prismaClient.$transaction(operation, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        })
      }
      catch (error) {
        if (!this.isSerializationError(error) || attempt === MAX_SERIALIZATION_ATTEMPTS) {
          throw error
        }
      }
    }
    throw new Error('Serializable email lifecycle operation did not complete')
  }

  private isSerializationError(error: unknown): boolean {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034'
  }

  private isStatusOneOf(
    status: PartnerPortalEmailDeliveryStatus,
    allowed: readonly PartnerPortalEmailDeliveryStatus[],
  ): boolean {
    return allowed.includes(status)
  }

  private isUniqueConstraintError(error: unknown): boolean {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
  }
}

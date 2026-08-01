import { Prisma, PrismaClient } from '@prisma/client'
import { inject, injectable } from 'inversify'

import { TYPES } from '../../../app/container/types'
import { IDatabaseClientProvider } from '../../../platform/persistence/IDatabaseClientProvider'

export type PartnerPortalAuditInput = {
  action: string
  actorUserId?: string
  metadata?: Prisma.InputJsonValue
  partnerId: string
  resourceId?: string
  resourceType: string
}

type PrismaClientLike = Prisma.TransactionClient | PrismaClient

@injectable()
export class PartnerPortalAuditService {
  public constructor(
    @inject(TYPES.IDatabaseClientProvider)
    private readonly databaseClientProvider: IDatabaseClientProvider,
  ) {}

  public async record(
    input: PartnerPortalAuditInput,
    client?: PrismaClientLike,
  ): Promise<void> {
    const prismaClient = client ?? await this.databaseClientProvider.getClient()
    await prismaClient.partnerPortalAuditEvent.create({
      data: {
        action: input.action,
        actorUserId: input.actorUserId,
        metadata: input.metadata,
        partnerId: input.partnerId,
        resourceId: input.resourceId,
        resourceType: input.resourceType,
      },
    })
  }
}

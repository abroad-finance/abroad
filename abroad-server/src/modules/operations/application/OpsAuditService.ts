import type { OpsAuditEvent, Prisma } from '@prisma/client'

import { inject, injectable } from 'inversify'

import { TYPES } from '../../../app/container/types'
import { IDatabaseClientProvider } from '../../../platform/persistence/IDatabaseClientProvider'
import { OpsPrincipal } from './opsIdentity'

type OpsAuditInput = {
  action: string
  metadata?: Prisma.InputJsonValue
  reason?: string
  reference?: string
  resourceId?: string
  resourceType: string
}

const normalizeOptional = (value: string | undefined): string | undefined => {
  const normalized = value?.trim()
  return normalized ? normalized : undefined
}

@injectable()
export class OpsAuditService {
  public constructor(
    @inject(TYPES.IDatabaseClientProvider)
    private readonly databaseClientProvider: IDatabaseClientProvider,
  ) {}

  public async record(
    principal: OpsPrincipal,
    input: OpsAuditInput,
    transaction?: Prisma.TransactionClient,
  ): Promise<OpsAuditEvent> {
    const prismaClient = transaction ?? await this.databaseClientProvider.getClient()
    return prismaClient.opsAuditEvent.create({
      data: {
        action: input.action,
        actorKind: principal.kind === 'ops_user' ? 'USER' : 'LEGACY_KEY',
        actorLabel: principal.displayName,
        actorUserId: principal.userId,
        metadata: input.metadata,
        reason: normalizeOptional(input.reason),
        reference: normalizeOptional(input.reference),
        resourceId: normalizeOptional(input.resourceId),
        resourceType: input.resourceType.trim(),
      },
    })
  }

  public async recordSystem(
    input: OpsAuditInput,
    transaction?: Prisma.TransactionClient,
  ): Promise<OpsAuditEvent> {
    const prismaClient = transaction ?? await this.databaseClientProvider.getClient()
    return prismaClient.opsAuditEvent.create({
      data: {
        action: input.action,
        actorKind: 'SYSTEM',
        actorLabel: 'Abroad system',
        metadata: input.metadata,
        reason: normalizeOptional(input.reason),
        reference: normalizeOptional(input.reference),
        resourceId: normalizeOptional(input.resourceId),
        resourceType: input.resourceType.trim(),
      },
    })
  }
}

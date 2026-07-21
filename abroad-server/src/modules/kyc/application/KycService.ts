import { KycStatus } from '@prisma/client'
import { inject, injectable } from 'inversify'

import { TYPES } from '../../../app/container/types'
import { IDatabaseClientProvider } from '../../../platform/persistence/IDatabaseClientProvider'
import { IKycService, KycPrismaClient } from './contracts/IKycService'

/**
 * Lightweight replacement for the Persona-based KYC service. The only gating
 * question the transaction flow asks is "has this user been approved?", which
 * a complete self-service form submission sets to APPROVED.
 */
@injectable()
export class KycService implements IKycService {
  constructor(
    @inject(TYPES.IDatabaseClientProvider)
    private readonly dbProvider: IDatabaseClientProvider,
  ) {}

  public async hasApprovedKyc(
    partnerUserId: string,
    client?: KycPrismaClient,
  ): Promise<boolean> {
    const prisma = client ?? (await this.dbProvider.getClient())
    const approved = await prisma.partnerUserKyc.findFirst({
      select: { id: true },
      where: { partnerUserId, status: KycStatus.APPROVED },
    })
    return approved !== null
  }
}

import { OpsRole } from '@prisma/client'
import { timingSafeEqual } from 'crypto'
import { inject, injectable } from 'inversify'

import { OpsAuthenticationError, OpsLegacyPrincipal } from '../../modules/operations/application/opsIdentity'
import { getOpsRolePermissions, OPS_PERMISSIONS } from '../../modules/operations/application/opsPermissions'
import { IDatabaseClientProvider } from '../../platform/persistence/IDatabaseClientProvider'
import { ISecretManager, Secrets } from '../../platform/secrets/ISecretManager'
import { TYPES } from '../container/types'

@injectable()
export class OpsAuthService {
  constructor(
    @inject(TYPES.ISecretManager) private readonly secretManager: ISecretManager,
    @inject(TYPES.IDatabaseClientProvider)
    private readonly databaseClientProvider: IDatabaseClientProvider,
  ) {}

  public async authenticateLegacyApiKey(providedKey: string): Promise<OpsLegacyPrincipal> {
    await this.verifyOpsApiKey(providedKey)
    const prismaClient = await this.databaseClientProvider.getClient()
    const administratorCount = await prismaClient.opsUser.count({
      where: {
        disabledAt: null,
        role: OpsRole.ADMINISTRATOR,
      },
    })

    return {
      authTime: null,
      displayName: 'Legacy Ops key',
      email: null,
      kind: 'ops_legacy',
      permissions: administratorCount === 0
        ? OPS_PERMISSIONS
        : getOpsRolePermissions(OpsRole.VIEWER),
      role: null,
      sessionVersion: null,
      userId: null,
    }
  }

  public async getOpsApiKey(): Promise<string> {
    return this.secretManager.getSecret(Secrets.OPS_API_KEY)
  }

  public async verifyOpsApiKey(providedKey: string): Promise<void> {
    const expectedKey = await this.getOpsApiKey()
    const providedBuffer = Buffer.from(providedKey)
    const expectedBuffer = Buffer.from(expectedKey)
    if (
      providedBuffer.length !== expectedBuffer.length
      || !timingSafeEqual(providedBuffer, expectedBuffer)
    ) {
      throw new OpsAuthenticationError()
    }
  }
}

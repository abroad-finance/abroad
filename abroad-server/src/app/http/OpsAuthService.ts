import { inject, injectable } from 'inversify'

import { ISecretManager, Secrets } from '../../platform/secrets/ISecretManager'
import { TYPES } from '../container/types'

@injectable()
export class OpsAuthService {
  constructor(
    @inject(TYPES.ISecretManager) private readonly secretManager: ISecretManager,
  ) {}

  public async getOpsApiKey(): Promise<string> {
    return this.secretManager.getSecret(Secrets.OPS_API_KEY)
  }
}

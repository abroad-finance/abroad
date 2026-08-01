import { WebhookCredentialMode } from '@prisma/client'
import { inject, injectable } from 'inversify'

import { TYPES } from '../../../app/container/types'
import { IDatabaseClientProvider } from '../../../platform/persistence/IDatabaseClientProvider'
import { PartnerPortalSecretEnvelopeService } from './PartnerPortalSecretEnvelopeService'

@injectable()
export class PartnerWebhookSecretResolver {
  public constructor(
    @inject(TYPES.IDatabaseClientProvider)
    private readonly databaseClientProvider: IDatabaseClientProvider,
    @inject(PartnerPortalSecretEnvelopeService)
    private readonly secretEnvelopeService: PartnerPortalSecretEnvelopeService,
  ) {}

  public async resolve(
    partnerId: string,
    mode: WebhookCredentialMode,
  ): Promise<string | undefined> {
    if (mode === WebhookCredentialMode.LEGACY_ORIGIN) {
      return undefined
    }
    const prismaClient = await this.databaseClientProvider.getClient()
    const configuration = await prismaClient.partnerWebhookConfiguration.findUnique({
      where: { partnerId },
    })
    if (!configuration) {
      return undefined
    }
    if (mode === WebhookCredentialMode.PARTNER_PENDING) {
      return configuration.pendingSecretCiphertext
        ? this.secretEnvelopeService.decrypt(
            configuration.pendingSecretCiphertext,
            this.secretContext(partnerId, 'pending'),
          )
        : undefined
    }
    return configuration.activeSecretCiphertext
      ? this.secretEnvelopeService.decrypt(
          configuration.activeSecretCiphertext,
          this.secretContext(partnerId, 'active'),
        )
      : undefined
  }

  public secretContext(partnerId: string, state: 'active' | 'pending'): string {
    return `partner-portal:webhook:${partnerId}:${state}`
  }
}

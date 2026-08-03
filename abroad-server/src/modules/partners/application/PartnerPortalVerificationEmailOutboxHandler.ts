import { inject, injectable } from 'inversify'
import { z } from 'zod'

import { TYPES } from '../../../app/container/types'
import { OutboxDeliveryError, OutboxDeliveryHandler } from '../../../platform/outbox/OutboxDeliveryHandler'
import { OutboxRecord } from '../../../platform/outbox/OutboxRepository'
import { IDatabaseClientProvider } from '../../../platform/persistence/IDatabaseClientProvider'
import { PartnerPortalEmailDeliveryLifecycleService, partnerPortalVerificationTokenContext } from './PartnerPortalEmailDeliveryLifecycleService'
import { PartnerPortalSecretEnvelopeError, PartnerPortalSecretEnvelopeService } from './PartnerPortalSecretEnvelopeService'
import { PartnerPortalEmailDeliveryError, ResendPartnerPortalEmailSender } from './ResendPartnerPortalEmailSender'

export const PARTNER_PORTAL_VERIFICATION_EMAIL_OUTBOX_KIND = 'partner-portal-verification-email'

const payloadSchema = z.object({
  kind: z.literal(PARTNER_PORTAL_VERIFICATION_EMAIL_OUTBOX_KIND),
  tokenId: z.string().uuid(),
}).strict()

@injectable()
export class PartnerPortalVerificationEmailOutboxHandler implements OutboxDeliveryHandler {
  public readonly kind = PARTNER_PORTAL_VERIFICATION_EMAIL_OUTBOX_KIND

  public constructor(
    @inject(TYPES.IDatabaseClientProvider)
    private readonly databaseClientProvider: IDatabaseClientProvider,
    @inject(PartnerPortalEmailDeliveryLifecycleService)
    private readonly lifecycleService: PartnerPortalEmailDeliveryLifecycleService,
    @inject(PartnerPortalSecretEnvelopeService)
    private readonly secretEnvelopeService: PartnerPortalSecretEnvelopeService,
    @inject(ResendPartnerPortalEmailSender)
    private readonly emailSender: ResendPartnerPortalEmailSender,
  ) {}

  public async deliver(record: OutboxRecord): Promise<void> {
    const payload = payloadSchema.safeParse(record.payload)
    if (!payload.success) {
      throw new OutboxDeliveryError('Verification email outbox payload is invalid', false)
    }
    const prismaClient = await this.databaseClientProvider.getClient()
    const token = await prismaClient.partnerPortalEmailVerificationToken.findUnique({
      include: { user: { include: { partner: true } } },
      where: { id: payload.data.tokenId },
    })
    if (!token) {
      throw new OutboxDeliveryError('Verification email token no longer exists', false)
    }
    if (token.providerMessageId) {
      return
    }
    const now = new Date()
    if (
      !token.tokenCiphertext
      || token.consumedAt
      || token.expiresAt <= now
      || token.user.disabledAt
      || token.user.emailVerifiedAt
      || !token.user.emailVerificationRequiredAt
      || token.user.passwordVerifier === null
    ) {
      await this.lifecycleService.recordFailure({
        code: 'DELIVERY_NOT_ELIGIBLE',
        terminal: true,
        tokenId: token.id,
      })
      throw new OutboxDeliveryError('Verification email is not eligible for delivery', false)
    }

    await this.lifecycleService.recordAttempt(token.id)
    let plaintextToken: string
    try {
      plaintextToken = await this.secretEnvelopeService.decrypt(
        token.tokenCiphertext,
        partnerPortalVerificationTokenContext(token.id),
      )
    }
    catch (error) {
      if (error instanceof PartnerPortalSecretEnvelopeError) {
        await this.lifecycleService.recordFailure({
          code: 'TOKEN_UNAVAILABLE',
          terminal: true,
          tokenId: token.id,
        })
        throw new OutboxDeliveryError('Verification email token could not be opened', false)
      }
      throw error
    }

    try {
      const result = await this.emailSender.sendVerificationEmail({
        email: token.user.email,
        firstName: token.user.partner.firstName ?? 'there',
        plaintextToken,
        tokenId: token.id,
      })
      await this.lifecycleService.recordAccepted({
        providerMessageId: result.providerMessageId,
        tokenId: token.id,
      })
    }
    catch (error) {
      if (!(error instanceof PartnerPortalEmailDeliveryError)) {
        throw error
      }
      const nextAttempt = record.attempts + 1
      const terminal = !error.retryable || nextAttempt >= record.maxAttempts
      await this.lifecycleService.recordFailure({
        code: error.code,
        terminal,
        tokenId: token.id,
      })
      throw new OutboxDeliveryError('Verification email provider delivery failed', error.retryable)
    }
  }
}

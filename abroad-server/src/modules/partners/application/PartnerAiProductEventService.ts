import { inject, injectable } from 'inversify'

import { TYPES } from '../../../app/container/types'
import { ILogger } from '../../../core/logging/types'
import { PartnerPortalPrincipal } from './PartnerPortalSessionService'

export const partnerAiProductEventNames = [
  'AI_INTEGRATION_PAGE_VIEWED',
  'AI_CONNECTION_STARTED',
  'AI_AUTHORIZATION_COMPLETED',
  'AI_CONNECTION_TESTED',
  'AI_CONNECTION_REVOKED',
] as const

export const partnerAiProductEntryPoints = [
  'DIRECT',
  'DOCUMENTATION',
  'INTEGRATION_CARD',
  'NAVIGATION',
  'TRANSACTION_EMPTY_STATE',
] as const

export const partnerAiProductOutcomes = [
  'APPROVED',
  'DENIED',
  'FAILED',
  'NOT_APPLICABLE',
  'REVOKED',
  'SUCCEEDED',
] as const

export const partnerAiProductClientCategories = ['GENERIC', 'UNSUPPORTED'] as const

export type PartnerAiProductEventInput = {
  clientCategory: typeof partnerAiProductClientCategories[number]
  entryPoint: typeof partnerAiProductEntryPoints[number]
  event: typeof partnerAiProductEventNames[number]
  outcome: typeof partnerAiProductOutcomes[number]
}

const PARTNER_AI_PRODUCT_EVENT_LOG_MESSAGE = '[PartnerAiIntegration] Product event'

@injectable()
export class PartnerAiProductEventService {
  public constructor(
    @inject(TYPES.ILogger)
    private readonly logger: ILogger,
  ) {}

  public record(principal: PartnerPortalPrincipal, input: PartnerAiProductEventInput): void {
    this.logger.info(PARTNER_AI_PRODUCT_EVENT_LOG_MESSAGE, {
      clientCategory: input.clientCategory,
      entryPoint: input.entryPoint,
      event: input.event,
      outcome: input.outcome,
      role: principal.role,
    })
  }
}

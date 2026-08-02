import 'reflect-metadata'
import { PartnerPortalRole } from '@prisma/client'

import { ILogger } from '../../../../core/logging/types'
import { PartnerAiProductEventService } from '../../../../modules/partners/application/PartnerAiProductEventService'
import { PartnerPortalPrincipal } from '../../../../modules/partners/application/PartnerPortalSessionService'

const principal: PartnerPortalPrincipal = {
  authenticationSource: 'PARTNER_PORTAL',
  email: 'administrator@partner.example',
  kind: 'partner_portal',
  mfaEnabled: true,
  mfaVerified: true,
  partner: { id: 'partner-1', name: 'Atlas Payments' } as PartnerPortalPrincipal['partner'],
  role: PartnerPortalRole.ADMIN,
  userId: 'portal-user-1',
}

describe('PartnerAiProductEventService', () => {
  it('logs only bounded product dimensions without user, organization, prompt, or credential data', () => {
    const info = jest.fn()
    const service = new PartnerAiProductEventService({ info } as unknown as ILogger)

    service.record(principal, {
      clientCategory: 'GENERIC',
      entryPoint: 'NAVIGATION',
      event: 'AI_INTEGRATION_PAGE_VIEWED',
      outcome: 'NOT_APPLICABLE',
    })

    expect(info).toHaveBeenCalledWith('[PartnerAiIntegration] Product event', {
      clientCategory: 'GENERIC',
      entryPoint: 'NAVIGATION',
      event: 'AI_INTEGRATION_PAGE_VIEWED',
      outcome: 'NOT_APPLICABLE',
      role: PartnerPortalRole.ADMIN,
    })
    const serialized = JSON.stringify(info.mock.calls)
    expect(serialized).not.toContain(principal.email)
    expect(serialized).not.toContain(principal.partner.name)
    expect(serialized).not.toContain(principal.userId)
  })
})

import 'reflect-metadata'

import type { TsoaResponse } from '@tsoa/runtime'

import { PartnerPortalAccountNotFoundError, PartnerPortalAccountService, PartnerPortalAccountValidationError } from '../../../../../modules/partners/application/PartnerPortalAccountService'
import { OpsPartnerPortalController } from '../../../../../modules/partners/interfaces/http/OpsPartnerPortalController'

type AccountServiceMock = Pick<PartnerPortalAccountService, 'provision'>

const partnerId = '3ee06787-8a54-4af2-8f74-ec26d43167aa'

const buildService = (): jest.Mocked<AccountServiceMock> => {
  const provision = jest.fn<
    ReturnType<PartnerPortalAccountService['provision']>,
    Parameters<PartnerPortalAccountService['provision']>
  >()
  provision.mockResolvedValue({
    created: true,
    email: 'operator@decaf.so',
    id: '22222222-2222-4222-8222-222222222222',
    partnerId,
  })
  return { provision }
}

const badRequestResponder = (): TsoaResponse<400, { reason: string }> => (
  jest.fn((_status: 400, payload: { reason: string }) => payload)
)

const notFoundResponder = (): TsoaResponse<404, { reason: string }> => (
  jest.fn((_status: 404, payload: { reason: string }) => payload)
)

describe('OpsPartnerPortalController', () => {
  it('provisions a validated portal account through the Ops-only surface', async () => {
    const service = buildService()
    const controller = new OpsPartnerPortalController(
      service as unknown as PartnerPortalAccountService,
    )

    const result = await controller.upsertPortalUser(
      partnerId,
      {
        email: ' Operator@Decaf.So ',
        password: 'correct horse battery staple',
      },
      badRequestResponder(),
      notFoundResponder(),
    )

    expect(service.provision).toHaveBeenCalledWith(partnerId, {
      email: 'Operator@Decaf.So',
      password: 'correct horse battery staple',
    })
    expect(result).toEqual(expect.objectContaining({ created: true, partnerId }))
  })

  it('rejects malformed credentials before provisioning', async () => {
    const service = buildService()
    const controller = new OpsPartnerPortalController(
      service as unknown as PartnerPortalAccountService,
    )
    const badRequest = badRequestResponder()

    const result = await controller.upsertPortalUser(
      partnerId,
      { email: 'invalid', password: 'short' },
      badRequest,
      notFoundResponder(),
    )

    expect(result).toEqual(expect.objectContaining({ reason: expect.any(String) }))
    expect(service.provision).not.toHaveBeenCalled()
  })

  it('maps missing partners to HTTP 404', async () => {
    const service = buildService()
    service.provision.mockRejectedValueOnce(new PartnerPortalAccountNotFoundError())
    const controller = new OpsPartnerPortalController(
      service as unknown as PartnerPortalAccountService,
    )
    const notFound = notFoundResponder()

    const result = await controller.upsertPortalUser(
      partnerId,
      { email: 'operator@decaf.so', password: 'correct horse battery staple' },
      badRequestResponder(),
      notFound,
    )

    expect(result).toEqual({ reason: 'Partner not found' })
    expect(notFound).toHaveBeenCalledWith(404, { reason: 'Partner not found' })
  })

  it('maps account-policy failures to HTTP 400 without returning credentials', async () => {
    const service = buildService()
    service.provision.mockRejectedValueOnce(
      new PartnerPortalAccountValidationError('Portal email is already assigned'),
    )
    const controller = new OpsPartnerPortalController(
      service as unknown as PartnerPortalAccountService,
    )
    const badRequest = badRequestResponder()

    const result = await controller.upsertPortalUser(
      partnerId,
      { email: 'operator@decaf.so', password: 'correct horse battery staple' },
      badRequest,
      notFoundResponder(),
    )

    expect(result).toEqual({ reason: 'Portal email is already assigned' })
    expect(JSON.stringify(result)).not.toContain('correct horse battery staple')
  })
})

import 'reflect-metadata'
import type { TsoaResponse } from '@tsoa/runtime'

import {
  OpsPartnerNotFoundError,
  OpsPartnerService,
  OpsPartnerValidationError,
} from '../../../../../modules/partners/application/OpsPartnerService'
import { OpsPartnerController } from '../../../../../modules/partners/interfaces/http/OpsPartnerController'

type OpsPartnerServiceMock = Pick<
OpsPartnerService,
'createPartner' | 'listPartners' | 'revokeApiKey' | 'rotateApiKey'
>

const buildService = (): jest.Mocked<OpsPartnerServiceMock> => ({
  createPartner: jest.fn(async (_input) => ({
    apiKey: 'partner_test_key',
    partner: {
      createdAt: new Date('2024-01-01T00:00:00.000Z'),
      hasApiKey: true,
      id: 'partner-1',
      isKybApproved: false,
      name: 'Partner One',
      needsKyc: true,
    },
  })),
  listPartners: jest.fn(async (_params) => ({
    items: [{
      createdAt: new Date('2024-01-01T00:00:00.000Z'),
      hasApiKey: true,
      id: 'partner-1',
      isKybApproved: false,
      name: 'Partner One',
      needsKyc: true,
    }],
    page: 1,
    pageSize: 20,
    total: 1,
  })),
  revokeApiKey: jest.fn(async (_partnerId: string) => undefined),
  rotateApiKey: jest.fn(async (_partnerId: string) => ({
    apiKey: 'partner_rotated_key',
    partner: {
      createdAt: new Date('2024-01-01T00:00:00.000Z'),
      hasApiKey: true,
      id: 'partner-1',
      isKybApproved: false,
      name: 'Partner One',
      needsKyc: true,
    },
  })),
})

const badRequestResponder = (): TsoaResponse<400, { reason: string }> => (
  jest.fn((_status: 400, payload: { reason: string }) => payload)
)

const notFoundResponder = (): TsoaResponse<404, { reason: string }> => (
  jest.fn((_status: 404, payload: { reason: string }) => payload)
)

const createdResponder = (): TsoaResponse<201, {
  apiKey: string
  partner: {
    createdAt: Date
    hasApiKey: boolean
    id: string
    isKybApproved: boolean
    name: string
    needsKyc: boolean
  }
}> => (
  jest.fn((_status: 201, payload) => payload)
)

describe('OpsPartnerController', () => {
  it('returns 400 for invalid pagination', async () => {
    const service = buildService()
    const controller = new OpsPartnerController(service as unknown as OpsPartnerService)
    const badRequest = badRequestResponder()

    const response = await controller.listPartners(0, 20, badRequest)

    expect(response).toEqual({ reason: 'Too small: expected number to be >=1' })
    expect(service.listPartners).not.toHaveBeenCalled()
  })

  it('lists partners when request is valid', async () => {
    const service = buildService()
    const controller = new OpsPartnerController(service as unknown as OpsPartnerService)
    const badRequest = badRequestResponder()

    const response = await controller.listPartners(1, 20, badRequest)

    expect(badRequest).not.toHaveBeenCalled()
    expect(service.listPartners).toHaveBeenCalledWith({ page: 1, pageSize: 20 })
    expect(response.items).toHaveLength(1)
  })

  it('returns 400 for invalid create payload', async () => {
    const service = buildService()
    const controller = new OpsPartnerController(service as unknown as OpsPartnerService)
    const badRequest = badRequestResponder()
    const created = createdResponder()

    const response = await controller.createPartner(
      {
        company: '',
        country: '',
        email: 'invalid-email',
        firstName: '',
        lastName: '',
        password: '',
      },
      badRequest,
      created,
    )

    expect(response).toEqual(expect.objectContaining({ reason: expect.any(String) }))
    expect(created).not.toHaveBeenCalled()
    expect(service.createPartner).not.toHaveBeenCalled()
  })

  it('creates partner with api key and returns 201 payload', async () => {
    const service = buildService()
    const controller = new OpsPartnerController(service as unknown as OpsPartnerService)
    const badRequest = badRequestResponder()
    const created = createdResponder()

    const response = await controller.createPartner(
      {
        company: 'Acme',
        country: 'CO',
        email: 'acme@example.com',
        firstName: 'Ada',
        lastName: 'Lovelace',
        password: 'supersecret',
        phone: '555',
      },
      badRequest,
      created,
    )

    expect(service.createPartner).toHaveBeenCalledWith(expect.objectContaining({
      company: 'Acme',
      email: 'acme@example.com',
    }))
    expect(created).toHaveBeenCalledWith(201, response)
  })

  it('maps service validation errors to 400 on create', async () => {
    const service = buildService()
    service.createPartner.mockRejectedValueOnce(new OpsPartnerValidationError('Partner email already exists'))
    const controller = new OpsPartnerController(service as unknown as OpsPartnerService)
    const badRequest = badRequestResponder()
    const created = createdResponder()

    const response = await controller.createPartner(
      {
        company: 'Acme',
        country: 'CO',
        email: 'acme@example.com',
        firstName: 'Ada',
        lastName: 'Lovelace',
        password: 'supersecret',
      },
      badRequest,
      created,
    )

    expect(response).toEqual({ reason: 'Partner email already exists' })
    expect(created).not.toHaveBeenCalled()
  })

  it('returns 400 for invalid partner id on rotate', async () => {
    const service = buildService()
    const controller = new OpsPartnerController(service as unknown as OpsPartnerService)
    const badRequest = badRequestResponder()
    const notFound = notFoundResponder()

    const response = await controller.rotateApiKey('not-a-uuid', badRequest, notFound)

    expect(response).toEqual({ reason: 'Invalid UUID' })
    expect(service.rotateApiKey).not.toHaveBeenCalled()
  })

  it('returns 404 when rotate target is missing', async () => {
    const service = buildService()
    service.rotateApiKey.mockRejectedValueOnce(new OpsPartnerNotFoundError('Partner not found'))
    const controller = new OpsPartnerController(service as unknown as OpsPartnerService)
    const badRequest = badRequestResponder()
    const notFound = notFoundResponder()

    const response = await controller.rotateApiKey('3ee06787-8a54-4af2-8f74-ec26d43167aa', badRequest, notFound)

    expect(response).toEqual({ reason: 'Partner not found' })
    expect(notFound).toHaveBeenCalledWith(404, { reason: 'Partner not found' })
  })

  it('revokes API key and responds with 204', async () => {
    const service = buildService()
    const controller = new OpsPartnerController(service as unknown as OpsPartnerService)
    const badRequest = badRequestResponder()
    const notFound = notFoundResponder()
    const setStatusSpy = jest.spyOn(controller, 'setStatus')

    await controller.revokeApiKey('3ee06787-8a54-4af2-8f74-ec26d43167aa', badRequest, notFound)

    expect(service.revokeApiKey).toHaveBeenCalledWith('3ee06787-8a54-4af2-8f74-ec26d43167aa')
    expect(setStatusSpy).toHaveBeenCalledWith(204)
    expect(notFound).not.toHaveBeenCalled()
  })
})

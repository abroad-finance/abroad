import 'reflect-metadata'
import type { TsoaResponse } from '@tsoa/runtime'
import type { Request } from 'express'

import { OpsRole } from '@prisma/client'

import { OpsAuditService } from '../../../../../modules/operations/application/OpsAuditService'
import { OpsMutationService } from '../../../../../modules/operations/application/opsMutation'
import { OpsPartnerNotFoundError, OpsPartnerService, OpsPartnerValidationError } from '../../../../../modules/partners/application/OpsPartnerService'
import { OpsPartnerController } from '../../../../../modules/partners/interfaces/http/OpsPartnerController'

type OpsPartnerServiceMock = Pick<
  OpsPartnerService,
'createPartner' | 'getCredentialHistory' | 'listPartners' | 'revokeApiKey' | 'rotateApiKey' | 'updateClientDomain'
>

const request = {
  header: jest.fn(() => undefined),
  user: {
    authTime: new Date(),
    displayName: 'Test Operator',
    email: 'operator@abroad.finance',
    kind: 'ops_user' as const,
    permissions: ['partners:manage', 'credentials:manage'] as const,
    role: OpsRole.ADMINISTRATOR,
    sessionVersion: 1,
    userId: 'ops-user-1',
  },
} as unknown as Request

const mutationService = {
  execute: jest.fn(async (...parameters: unknown[]) => {
    const operation = parameters[4]
    if (typeof operation !== 'function') throw new Error('Operation callback is required')
    return operation()
  }),
} as unknown as OpsMutationService

const auditService = {
  record: jest.fn(async () => ({ id: 'audit-event-1' })),
} as unknown as OpsAuditService

const buildController = (service: OpsPartnerServiceMock): OpsPartnerController => (
  new OpsPartnerController(
    service as unknown as OpsPartnerService,
    mutationService,
    auditService,
  )
)

const buildPartnerSummary = (overrides?: Partial<{
  clientDomain?: string
  createdAt: Date
  hasApiKey: boolean
  id: string
  isKybApproved: boolean
  name: string
  needsKyc: boolean
}>): {
  clientDomain?: string
  createdAt: Date
  hasApiKey: boolean
  id: string
  isKybApproved: boolean
  name: string
  needsKyc: boolean
} => ({
  createdAt: new Date('2024-01-01T00:00:00.000Z'),
  hasApiKey: true,
  id: 'partner-1',
  isKybApproved: false,
  name: 'Partner One',
  needsKyc: true,
  ...(overrides ?? {}),
})

const buildService = (): jest.Mocked<OpsPartnerServiceMock> => ({
  createPartner: jest.fn(async (_input) => {
    void _input
    return {
      apiKey: 'partner_test_key',
      partner: buildPartnerSummary(),
    }
  }),
  getCredentialHistory: jest.fn(async (_partnerId: string) => {
    void _partnerId
    return {
      events: [],
      legacyCredential: { active: true },
      managedCredentials: [],
      partner: buildPartnerSummary(),
    }
  }),
  listPartners: jest.fn(async (_params) => {
    void _params
    return {
      items: [{
        ...buildPartnerSummary(),
        completedVolume: {
          completedTransactions: 2,
          payout: [{ amount: 500, currency: 'BRL' as const }],
          source: [{ amount: 100, currency: 'USDC' as const }],
          stablecoinAmount: 100,
        },
      }],
      maximumStablecoinAmount: 100,
      page: 1,
      pageSize: 20,
      total: 1,
    }
  }),
  revokeApiKey: jest.fn(async (_partnerId: string) => {
    void _partnerId
    return undefined
  }),
  rotateApiKey: jest.fn(async (_partnerId: string) => {
    void _partnerId
    return {
      apiKey: 'partner_rotated_key',
      partner: buildPartnerSummary(),
    }
  }),
  updateClientDomain: jest.fn(async (_partnerId: string, _body: { clientDomain: null | string }) => {
    void _partnerId
    void _body
    return buildPartnerSummary({ clientDomain: 'app.abroad.finance' })
  }),
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
    clientDomain?: string
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
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('returns 400 for invalid pagination', async () => {
    const service = buildService()
    const controller = buildController(service)
    const badRequest = badRequestResponder()

    const response = await controller.listPartners(0, 20, badRequest)

    expect(response).toEqual({ reason: 'Too small: expected number to be >=1' })
    expect(service.listPartners).not.toHaveBeenCalled()
  })

  it('lists partners when request is valid', async () => {
    const service = buildService()
    const controller = buildController(service)
    const badRequest = badRequestResponder()

    const response = await controller.listPartners(1, 20, badRequest)

    expect(badRequest).not.toHaveBeenCalled()
    expect(service.listPartners).toHaveBeenCalledWith({ page: 1, pageSize: 20 })
    expect(response.items).toHaveLength(1)
    expect(response.maximumStablecoinAmount).toBe(100)
    expect(response.items[0]?.completedVolume).toEqual({
      completedTransactions: 2,
      payout: [{ amount: 500, currency: 'BRL' }],
      source: [{ amount: 100, currency: 'USDC' }],
      stablecoinAmount: 100,
    })
  })

  it('returns the safe credential history and audits the sensitive read', async () => {
    const partnerId = '19d73f3a-28c9-40ff-bd7f-ff4e9dc83399'
    const service = buildService()
    const controller = buildController(service)
    const badRequest = badRequestResponder()
    const notFound = notFoundResponder()

    const response = await controller.getCredentialHistory(
      partnerId,
      request,
      badRequest,
      notFound,
    )

    expect(service.getCredentialHistory).toHaveBeenCalledWith(partnerId)
    expect(response).toEqual(expect.objectContaining({
      legacyCredential: { active: true },
      managedCredentials: [],
    }))
    expect(auditService.record).toHaveBeenCalledWith(request.user, {
      action: 'credentials.history.viewed',
      resourceId: partnerId,
      resourceType: 'partner',
    })
  })

  it('returns 400 for invalid create payload', async () => {
    const service = buildService()
    const controller = buildController(service)
    const badRequest = badRequestResponder()
    const created = createdResponder()

    const response = await controller.createPartner(
      {
        company: '',
        country: '',
        email: 'invalid-email',
        firstName: '',
        lastName: '',
      },
      request,
      badRequest,
      created,
    )

    expect(response).toEqual(expect.objectContaining({ reason: expect.any(String) }))
    expect(created).not.toHaveBeenCalled()
    expect(service.createPartner).not.toHaveBeenCalled()
  })

  it('creates partner with api key and returns 201 payload', async () => {
    const service = buildService()
    const controller = buildController(service)
    const badRequest = badRequestResponder()
    const created = createdResponder()

    const response = await controller.createPartner(
      {
        clientDomain: 'app.abroad.finance',
        company: 'Acme',
        country: 'CO',
        email: 'acme@example.com',
        firstName: 'Ada',
        lastName: 'Lovelace',
        phone: '555',
      },
      request,
      badRequest,
      created,
    )

    expect(service.createPartner).toHaveBeenCalledWith(expect.objectContaining({
      clientDomain: 'app.abroad.finance',
      company: 'Acme',
      email: 'acme@example.com',
    }))
    expect(created).toHaveBeenCalledWith(201, response)
  })

  it('maps service validation errors to 400 on create', async () => {
    const service = buildService()
    service.createPartner.mockRejectedValueOnce(new OpsPartnerValidationError('Partner email already exists'))
    const controller = buildController(service)
    const badRequest = badRequestResponder()
    const created = createdResponder()

    const response = await controller.createPartner(
      {
        company: 'Acme',
        country: 'CO',
        email: 'acme@example.com',
        firstName: 'Ada',
        lastName: 'Lovelace',
      },
      request,
      badRequest,
      created,
    )

    expect(response).toEqual({ reason: 'Partner email already exists' })
    expect(created).not.toHaveBeenCalled()
  })

  it('returns 400 for invalid partner id on rotate', async () => {
    const service = buildService()
    const controller = buildController(service)
    const badRequest = badRequestResponder()
    const notFound = notFoundResponder()

    const response = await controller.rotateApiKey('not-a-uuid', request, badRequest, notFound)

    expect(response).toEqual({ reason: 'Invalid UUID' })
    expect(service.rotateApiKey).not.toHaveBeenCalled()
  })

  it('returns 404 when rotate target is missing', async () => {
    const service = buildService()
    service.rotateApiKey.mockRejectedValueOnce(new OpsPartnerNotFoundError('Partner not found'))
    const controller = buildController(service)
    const badRequest = badRequestResponder()
    const notFound = notFoundResponder()

    const response = await controller.rotateApiKey('3ee06787-8a54-4af2-8f74-ec26d43167aa', request, badRequest, notFound)

    expect(response).toEqual({ reason: 'Partner not found' })
    expect(notFound).toHaveBeenCalledWith(404, { reason: 'Partner not found' })
  })

  it('returns 400 for invalid partner id on client-domain update', async () => {
    const service = buildService()
    const controller = buildController(service)
    const badRequest = badRequestResponder()
    const notFound = notFoundResponder()

    const response = await controller.updateClientDomain(
      'not-a-uuid',
      { clientDomain: 'app.abroad.finance' },
      request,
      badRequest,
      notFound,
    )

    expect(response).toEqual({ reason: 'Invalid UUID' })
    expect(service.updateClientDomain).not.toHaveBeenCalled()
  })

  it('returns 400 for invalid client-domain payloads', async () => {
    const service = buildService()
    const controller = buildController(service)
    const badRequest = badRequestResponder()
    const notFound = notFoundResponder()

    const response = await controller.updateClientDomain(
      '3ee06787-8a54-4af2-8f74-ec26d43167aa',
      {} as { clientDomain: null | string },
      request,
      badRequest,
      notFound,
    )

    expect(response).toEqual(expect.objectContaining({ reason: expect.any(String) }))
    expect(service.updateClientDomain).not.toHaveBeenCalled()
  })

  it('updates partner client domain and returns the updated summary', async () => {
    const service = buildService()
    const controller = buildController(service)
    const badRequest = badRequestResponder()
    const notFound = notFoundResponder()

    const response = await controller.updateClientDomain(
      '3ee06787-8a54-4af2-8f74-ec26d43167aa',
      { clientDomain: 'https://App.Abroad.Finance/path' },
      request,
      badRequest,
      notFound,
    )

    expect(service.updateClientDomain).toHaveBeenCalledWith(
      '3ee06787-8a54-4af2-8f74-ec26d43167aa',
      { clientDomain: 'https://App.Abroad.Finance/path' },
    )
    expect(response.clientDomain).toBe('app.abroad.finance')
  })

  it('maps missing partner client-domain updates to 404', async () => {
    const service = buildService()
    service.updateClientDomain.mockRejectedValueOnce(new OpsPartnerNotFoundError('Partner not found'))
    const controller = buildController(service)
    const badRequest = badRequestResponder()
    const notFound = notFoundResponder()

    const response = await controller.updateClientDomain(
      '3ee06787-8a54-4af2-8f74-ec26d43167aa',
      { clientDomain: null },
      request,
      badRequest,
      notFound,
    )

    expect(response).toEqual({ reason: 'Partner not found' })
    expect(notFound).toHaveBeenCalledWith(404, { reason: 'Partner not found' })
  })

  it('maps client-domain validation errors to 400', async () => {
    const service = buildService()
    service.updateClientDomain.mockRejectedValueOnce(new OpsPartnerValidationError('Client domain already exists'))
    const controller = buildController(service)
    const badRequest = badRequestResponder()
    const notFound = notFoundResponder()

    const response = await controller.updateClientDomain(
      '3ee06787-8a54-4af2-8f74-ec26d43167aa',
      { clientDomain: 'app.abroad.finance' },
      request,
      badRequest,
      notFound,
    )

    expect(response).toEqual({ reason: 'Client domain already exists' })
  })

  it('revokes API key and responds with 204', async () => {
    const service = buildService()
    const controller = buildController(service)
    const badRequest = badRequestResponder()
    const notFound = notFoundResponder()
    const setStatusSpy = jest.spyOn(controller, 'setStatus')

    await controller.revokeApiKey('3ee06787-8a54-4af2-8f74-ec26d43167aa', request, badRequest, notFound)

    expect(service.revokeApiKey).toHaveBeenCalledWith('3ee06787-8a54-4af2-8f74-ec26d43167aa')
    expect(setStatusSpy).toHaveBeenCalledWith(204)
    expect(notFound).not.toHaveBeenCalled()
  })
})

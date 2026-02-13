import 'reflect-metadata'
import { Prisma } from '@prisma/client'

import type { IDatabaseClientProvider } from '../../../../platform/persistence/IDatabaseClientProvider'

import {
  OpsPartnerNotFoundError,
  OpsPartnerService,
  OpsPartnerValidationError,
} from '../../../../modules/partners/application/OpsPartnerService'
import { hashPartnerApiKey } from '../../../../modules/partners/application/partnerApiKey'

type PartnerModel = import('@prisma/client').Partner

type PartnerDelegateMock = {
  count: jest.MockedFunction<() => Promise<number>>
  create: jest.MockedFunction<(args: { data: Record<string, unknown> }) => Promise<PartnerModel>>
  findMany: jest.MockedFunction<(args: { orderBy: { createdAt: 'desc' }, skip: number, take: number }) => Promise<PartnerModel[]>>
  update: jest.MockedFunction<(args: { data: { apiKey: null | string }, where: { id: string } }) => Promise<PartnerModel>>
}

const basePartner = (overrides?: Partial<PartnerModel>): PartnerModel => ({
  apiKey: null,
  clientDomainHash: null,
  country: 'CO',
  createdAt: new Date('2024-01-01T00:00:00.000Z'),
  email: 'partner@example.com',
  firstName: 'Pat',
  id: 'partner-1',
  isKybApproved: false,
  lastName: 'Ner',
  name: 'Partner Inc',
  needsKyc: true,
  phone: '123',
  webhookUrl: null,
  ...(overrides ?? {}),
})

const buildPartnerMock = (): PartnerDelegateMock => {
  return {
    count: jest.fn(async () => 0),
    create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => basePartner({
      apiKey: typeof data.apiKey === 'string' ? data.apiKey : null,
      country: typeof data.country === 'string' ? data.country : null,
      email: typeof data.email === 'string' ? data.email : null,
      firstName: typeof data.firstName === 'string' ? data.firstName : null,
      id: typeof data.id === 'string' ? data.id : 'partner-1',
      lastName: typeof data.lastName === 'string' ? data.lastName : null,
      name: typeof data.name === 'string' ? data.name : 'Partner Inc',
      phone: typeof data.phone === 'string' ? data.phone : null,
    })),
    findMany: jest.fn(async (
      _args: { orderBy: { createdAt: 'desc' }, skip: number, take: number },
    ): Promise<PartnerModel[]> => []),
    update: jest.fn(async ({ data, where }: { data: { apiKey: null | string }, where: { id: string } }) => basePartner({
      apiKey: data.apiKey,
      id: where.id,
    })),
  }
}

describe('OpsPartnerService', () => {
  let partner: PartnerDelegateMock
  let dbProvider: IDatabaseClientProvider
  let service: OpsPartnerService

  beforeEach(() => {
    jest.resetAllMocks()
    partner = buildPartnerMock()
    dbProvider = {
      getClient: jest.fn(async () => ({ partner }) as unknown as import('@prisma/client').PrismaClient),
    }
    service = new OpsPartnerService(dbProvider)
  })

  it('lists partners with hasApiKey projection', async () => {
    partner.findMany.mockResolvedValueOnce([
      basePartner({ apiKey: 'hashed-a', id: 'partner-a' }),
      basePartner({ apiKey: null, id: 'partner-b' }),
    ])
    partner.count.mockResolvedValueOnce(2)

    const result = await service.listPartners({ page: 2, pageSize: 1 })

    expect(partner.findMany).toHaveBeenCalledWith({
      orderBy: { createdAt: 'desc' },
      skip: 1,
      take: 1,
    })
    expect(result).toEqual({
      items: [
        expect.objectContaining({ hasApiKey: true, id: 'partner-a' }),
        expect.objectContaining({ hasApiKey: false, id: 'partner-b' }),
      ],
      page: 2,
      pageSize: 1,
      total: 2,
    })
  })

  it('creates partner and returns one-time plaintext key', async () => {
    const result = await service.createPartner({
      company: 'Acme',
      country: 'CO',
      email: 'acme@example.com',
      firstName: 'Ada',
      lastName: 'Lovelace',
      phone: '555-0000',
    })

    expect(partner.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        apiKey: hashPartnerApiKey(result.apiKey),
        country: 'CO',
        email: 'acme@example.com',
        firstName: 'Ada',
        lastName: 'Lovelace',
        name: 'Acme',
        phone: '555-0000',
      }),
    }))
    expect(result.apiKey.startsWith('partner_')).toBe(true)
    expect(result.partner.hasApiKey).toBe(true)
  })

  it('throws a domain validation error when partner creation fails', async () => {
    partner.create.mockRejectedValueOnce(new Error('db down'))

    await expect(service.createPartner({
      company: 'Acme',
      country: 'CO',
      email: 'acme@example.com',
      firstName: 'Ada',
      lastName: 'Lovelace',
      phone: '555-0000',
    })).rejects.toThrow(OpsPartnerValidationError)
  })

  it('rotates partner API key and returns one-time plaintext key', async () => {
    const result = await service.rotateApiKey('partner-rotate')

    expect(partner.update).toHaveBeenCalledWith({
      data: { apiKey: hashPartnerApiKey(result.apiKey) },
      where: { id: 'partner-rotate' },
    })
    expect(result.apiKey.startsWith('partner_')).toBe(true)
    expect(result.partner.id).toBe('partner-rotate')
    expect(result.partner.hasApiKey).toBe(true)
  })

  it('throws not found when rotating a missing partner API key', async () => {
    partner.update.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('missing', {
        clientVersion: '6.14.0',
        code: 'P2025',
      }),
    )

    await expect(service.rotateApiKey('missing')).rejects.toThrow(OpsPartnerNotFoundError)
  })

  it('revokes partner API key', async () => {
    await service.revokeApiKey('partner-revoke')

    expect(partner.update).toHaveBeenCalledWith({
      data: { apiKey: null },
      where: { id: 'partner-revoke' },
    })
  })

  it('throws not found when revoking a missing partner API key', async () => {
    partner.update.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('missing', {
        clientVersion: '6.14.0',
        code: 'P2025',
      }),
    )

    await expect(service.revokeApiKey('missing')).rejects.toThrow(OpsPartnerNotFoundError)
  })
})

import 'reflect-metadata'
import { Prisma } from '@prisma/client'

import type { IDatabaseClientProvider } from '../../../../platform/persistence/IDatabaseClientProvider'

import { OpsPartnerNotFoundError, OpsPartnerService, OpsPartnerValidationError } from '../../../../modules/partners/application/OpsPartnerService'
import { hashPartnerApiKey } from '../../../../modules/partners/application/partnerApiKey'
import { normalizeClientDomainInput } from '../../../../modules/partners/domain/clientDomain'

type PartnerCreateData = {
  apiKey?: null | string
  clientDomain?: null | string
  clientDomainHash?: null | string
  country?: null | string
  email?: null | string
  firstName?: null | string
  lastName?: null | string
  name?: string
  phone?: null | string
}

type PartnerDelegateMock = {
  count: jest.MockedFunction<() => Promise<number>>
  create: jest.MockedFunction<(args: { data: PartnerCreateData }) => Promise<PartnerModel>>
  findMany: jest.MockedFunction<(args: { orderBy: { createdAt: 'desc' }, skip: number, take: number }) => Promise<PartnerModel[]>>
  update: jest.MockedFunction<(args: { data: PartnerUpdateData, where: { id: string } }) => Promise<PartnerModel>>
}

type PartnerModel = import('@prisma/client').Partner

type PartnerUpdateData = {
  apiKey?: null | string
  clientDomain?: null | string
  clientDomainHash?: null | string
}

const basePartner = (overrides?: Partial<PartnerModel>): PartnerModel => ({
  apiKey: null,
  clientDomain: null,
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
    create: jest.fn(async ({ data }: { data: PartnerCreateData }) => basePartner({
      apiKey: typeof data.apiKey === 'string' ? data.apiKey : null,
      clientDomain: typeof data.clientDomain === 'string' ? data.clientDomain : null,
      clientDomainHash: typeof data.clientDomainHash === 'string' ? data.clientDomainHash : null,
      country: typeof data.country === 'string' ? data.country : null,
      email: typeof data.email === 'string' ? data.email : null,
      firstName: typeof data.firstName === 'string' ? data.firstName : null,
      id: 'partner-1',
      lastName: typeof data.lastName === 'string' ? data.lastName : null,
      name: typeof data.name === 'string' ? data.name : 'Partner Inc',
      phone: typeof data.phone === 'string' ? data.phone : null,
    })),
    findMany: jest.fn(async (
      _args: { orderBy: { createdAt: 'desc' }, skip: number, take: number },
    ): Promise<PartnerModel[]> => {
      void _args
      return []
    }),
    update: jest.fn(async ({ data, where }: { data: PartnerUpdateData, where: { id: string } }) => basePartner({
      apiKey: data.apiKey ?? null,
      clientDomain: data.clientDomain ?? null,
      clientDomainHash: data.clientDomainHash ?? null,
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

  it('lists partners with hasApiKey projection and client domain', async () => {
    partner.findMany.mockResolvedValueOnce([
      basePartner({ apiKey: 'hashed-a', clientDomain: 'app.abroad.finance', id: 'partner-a' }),
      basePartner({ apiKey: null, clientDomain: null, id: 'partner-b' }),
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
        expect.objectContaining({
          clientDomain: 'app.abroad.finance',
          hasApiKey: true,
          id: 'partner-a',
        }),
        expect.objectContaining({
          clientDomain: undefined,
          hasApiKey: false,
          id: 'partner-b',
        }),
      ],
      page: 2,
      pageSize: 1,
      total: 2,
    })
  })

  it('creates partner and returns one-time plaintext key with no client domain', async () => {
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
        clientDomain: null,
        clientDomainHash: null,
        country: 'CO',
        email: 'acme@example.com',
        firstName: 'Ada',
        lastName: 'Lovelace',
        name: 'Acme',
        phone: '555-0000',
      }),
    }))
    expect(result.apiKey.startsWith('partner_')).toBe(true)
    expect(result.partner.clientDomain).toBeUndefined()
    expect(result.partner.hasApiKey).toBe(true)
  })

  it('creates partner with a normalized client domain', async () => {
    const expectedDomain = normalizeClientDomainInput('https://App.Abroad.Finance/swap')

    const result = await service.createPartner({
      clientDomain: 'https://App.Abroad.Finance/swap',
      company: 'Acme',
      country: 'CO',
      email: 'acme@example.com',
      firstName: 'Ada',
      lastName: 'Lovelace',
    })

    expect(partner.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        clientDomain: expectedDomain.clientDomain,
        clientDomainHash: expectedDomain.clientDomainHash,
      }),
    }))
    expect(result.partner.clientDomain).toBe('app.abroad.finance')
  })

  it('rejects malformed client domains during creation', async () => {
    await expect(service.createPartner({
      clientDomain: 'not a domain',
      company: 'Acme',
      country: 'CO',
      email: 'acme@example.com',
      firstName: 'Ada',
      lastName: 'Lovelace',
    })).rejects.toThrow(new OpsPartnerValidationError('Client domain is invalid'))

    expect(partner.create).not.toHaveBeenCalled()
  })

  it('maps duplicate client domains to a validation error during creation', async () => {
    partner.create.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('duplicate', {
        clientVersion: '6.14.0',
        code: 'P2002',
        meta: { target: ['clientDomain'] },
      }),
    )

    await expect(service.createPartner({
      clientDomain: 'app.abroad.finance',
      company: 'Acme',
      country: 'CO',
      email: 'acme@example.com',
      firstName: 'Ada',
      lastName: 'Lovelace',
    })).rejects.toThrow(new OpsPartnerValidationError('Client domain already exists'))
  })

  it('throws a validation error when partner creation fails', async () => {
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

  it('updates a partner client domain using the canonical host', async () => {
    const expectedDomain = normalizeClientDomainInput('https://MiniPay.Abroad.Finance/path')

    const result = await service.updateClientDomain('partner-domain', {
      clientDomain: 'https://MiniPay.Abroad.Finance/path',
    })

    expect(partner.update).toHaveBeenCalledWith({
      data: {
        clientDomain: expectedDomain.clientDomain,
        clientDomainHash: expectedDomain.clientDomainHash,
      },
      where: { id: 'partner-domain' },
    })
    expect(result.clientDomain).toBe('minipay.abroad.finance')
  })

  it('clears a partner client domain', async () => {
    const result = await service.updateClientDomain('partner-domain', {
      clientDomain: null,
    })

    expect(partner.update).toHaveBeenCalledWith({
      data: {
        clientDomain: null,
        clientDomainHash: null,
      },
      where: { id: 'partner-domain' },
    })
    expect(result.clientDomain).toBeUndefined()
  })

  it('rejects malformed client domains during update', async () => {
    await expect(service.updateClientDomain('partner-domain', {
      clientDomain: 'bad domain value',
    })).rejects.toThrow(new OpsPartnerValidationError('Client domain is invalid'))

    expect(partner.update).not.toHaveBeenCalled()
  })

  it('maps duplicate client domains to a validation error during update', async () => {
    partner.update.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('duplicate', {
        clientVersion: '6.14.0',
        code: 'P2002',
        meta: { target: ['clientDomainHash'] },
      }),
    )

    await expect(service.updateClientDomain('partner-domain', {
      clientDomain: 'app.abroad.finance',
    })).rejects.toThrow(new OpsPartnerValidationError('Client domain already exists'))
  })

  it('throws not found when updating a missing partner client domain', async () => {
    partner.update.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('missing', {
        clientVersion: '6.14.0',
        code: 'P2025',
      }),
    )

    await expect(service.updateClientDomain('missing', {
      clientDomain: 'app.abroad.finance',
    })).rejects.toThrow(OpsPartnerNotFoundError)
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

import 'reflect-metadata'
import {
  CryptoCurrency,
  PartnerApiKeyScope,
  Prisma,
  TargetCurrency,
  TransactionStatus,
} from '@prisma/client'

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
  findMany: jest.MockedFunction<(args: PartnerFindManyArgs) => Promise<PartnerModel[]>>
  findUnique: jest.MockedFunction<(args: { where: { id: string } }) => Promise<null | PartnerModel>>
  update: jest.MockedFunction<(args: { data: PartnerUpdateData, where: { id: string } }) => Promise<PartnerModel>>
}

type PartnerFindManyArgs = {
  where: { id: { in: string[] } }
}

type PartnerModel = import('@prisma/client').Partner

type PartnerUpdateData = {
  apiKey?: null | string
  clientDomain?: null | string
  clientDomainHash?: null | string
  previousApiKey?: null | string
  previousApiKeyExpiresAt?: Date | null
}

type QuoteDelegateMock = {
  groupBy: jest.MockedFunction<(args: QuoteGroupByArgs) => Promise<QuoteVolumeGroup[]>>
}

type QuoteGroupByArgs = {
  _count: { _all: true }
  _sum: { sourceAmount: true, targetAmount: true }
  by: ['partnerId', 'cryptoCurrency', 'targetCurrency']
  where: {
    partnerId: { in: string[] }
    transaction: { is: { status: TransactionStatus } }
  }
}

type QuoteVolumeGroup = {
  _count: { _all: number }
  _sum: { sourceAmount: null | number, targetAmount: null | number }
  cryptoCurrency: CryptoCurrency
  partnerId: string
  targetCurrency: TargetCurrency
}

type RankedPartnerRow = {
  id: string
  maximumStablecoinAmount: number
}

const basePartner = (overrides?: Partial<PartnerModel>): PartnerModel => ({
  apiKey: null,
  clientDomain: null,
  clientDomainHash: null,
  country: 'CO',
  createdAt: new Date('2024-01-01T00:00:00.000Z'),
  disabledAt: null,
  disabledBy: null,
  disabledReason: null,
  email: 'partner@example.com',
  firstName: 'Pat',
  id: 'partner-1',
  isKybApproved: false,
  lastName: 'Ner',
  name: 'Partner Inc',
  needsKyc: true,
  phone: '123',
  previousApiKey: null,
  previousApiKeyExpiresAt: null,
  publicSignupIdempotencyHash: null,
  publicSignupOrganizationHash: null,
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
      _args: PartnerFindManyArgs,
    ): Promise<PartnerModel[]> => {
      void _args
      return []
    }),
    findUnique: jest.fn(async ({ where }) => basePartner({
      apiKey: 'current-legacy-key-hash',
      id: where.id,
    })),
    update: jest.fn(async ({ data, where }: { data: PartnerUpdateData, where: { id: string } }) => {
      const current = basePartner({ apiKey: 'current-legacy-key-hash', id: where.id })
      return basePartner({
        apiKey: data.apiKey === undefined ? current.apiKey : data.apiKey,
        clientDomain: data.clientDomain === undefined ? current.clientDomain : data.clientDomain,
        clientDomainHash: data.clientDomainHash === undefined
          ? current.clientDomainHash
          : data.clientDomainHash,
        id: where.id,
        previousApiKey: data.previousApiKey === undefined
          ? current.previousApiKey
          : data.previousApiKey,
        previousApiKeyExpiresAt: data.previousApiKeyExpiresAt === undefined
          ? current.previousApiKeyExpiresAt
          : data.previousApiKeyExpiresAt,
      })
    }),
  }
}

const buildQuoteMock = (): QuoteDelegateMock => ({
  groupBy: jest.fn(async (_args: QuoteGroupByArgs): Promise<QuoteVolumeGroup[]> => {
    void _args
    return []
  }),
})

describe('OpsPartnerService', () => {
  let partner: PartnerDelegateMock
  let quote: QuoteDelegateMock
  let queryRaw: jest.MockedFunction<(query: Prisma.Sql) => Promise<RankedPartnerRow[]>>
  let dbProvider: IDatabaseClientProvider
  let service: OpsPartnerService
  let transaction: jest.MockedFunction<(
    operation: (client: import('@prisma/client').PrismaClient) => Promise<PartnerModel>,
    options?: unknown,
  ) => Promise<PartnerModel>>

  beforeEach(() => {
    jest.resetAllMocks()
    partner = buildPartnerMock()
    quote = buildQuoteMock()
    queryRaw = jest.fn(async (_query: Prisma.Sql): Promise<RankedPartnerRow[]> => {
      void _query
      return []
    })
    const prismaMock = {
      $queryRaw: queryRaw,
      partner,
      quote,
    } as unknown as import('@prisma/client').PrismaClient
    transaction = jest.fn(async operation => operation(prismaMock))
    dbProvider = {
      getClient: jest.fn(async () => ({
        $queryRaw: queryRaw,
        $transaction: transaction,
        partner,
        quote,
      }) as unknown as import('@prisma/client').PrismaClient),
    }
    service = new OpsPartnerService(dbProvider)
  })

  it('lists partners with completed volumes grouped by source and payout currency', async () => {
    queryRaw.mockResolvedValueOnce([
      { id: 'partner-a', maximumStablecoinAmount: 42.12345678 },
      { id: 'partner-b', maximumStablecoinAmount: 42.12345678 },
    ])
    partner.findMany.mockResolvedValueOnce([
      basePartner({ apiKey: null, clientDomain: null, id: 'partner-b' }),
      basePartner({ apiKey: 'hashed-a', clientDomain: 'app.abroad.finance', id: 'partner-a' }),
    ])
    partner.count.mockResolvedValueOnce(2)
    quote.groupBy.mockResolvedValueOnce([
      {
        _count: { _all: 2 },
        _sum: { sourceAmount: 15.12345678, targetAmount: 75.6 },
        cryptoCurrency: CryptoCurrency.USDC,
        partnerId: 'partner-a',
        targetCurrency: TargetCurrency.BRL,
      },
      {
        _count: { _all: 1 },
        _sum: { sourceAmount: 5, targetAmount: 21_000 },
        cryptoCurrency: CryptoCurrency.USDC,
        partnerId: 'partner-a',
        targetCurrency: TargetCurrency.COP,
      },
      {
        _count: { _all: 3 },
        _sum: { sourceAmount: 10.25, targetAmount: 51.23 },
        cryptoCurrency: CryptoCurrency.USDT,
        partnerId: 'partner-a',
        targetCurrency: TargetCurrency.BRL,
      },
    ])

    const result = await service.listPartners({ page: 2, pageSize: 1 })

    expect(partner.findMany).toHaveBeenCalledWith({
      where: { id: { in: ['partner-a', 'partner-b'] } },
    })
    const rankingQuery = queryRaw.mock.calls[0]?.[0]
    expect(rankingQuery?.sql).toContain('ORDER BY')
    expect(rankingQuery?.sql).toContain('MAX("stablecoinAmount") OVER ()')
    expect(rankingQuery?.values).toEqual([
      TransactionStatus.PAYMENT_COMPLETED,
      1,
      1,
    ])
    expect(quote.groupBy).toHaveBeenCalledWith({
      _count: { _all: true },
      _sum: {
        sourceAmount: true,
        targetAmount: true,
      },
      by: ['partnerId', 'cryptoCurrency', 'targetCurrency'],
      where: {
        partnerId: { in: ['partner-a', 'partner-b'] },
        transaction: {
          is: { status: TransactionStatus.PAYMENT_COMPLETED },
        },
      },
    })
    expect(result).toEqual({
      items: [
        expect.objectContaining({
          clientDomain: 'app.abroad.finance',
          completedVolume: {
            completedTransactions: 6,
            payout: [
              { amount: 126.83, currency: TargetCurrency.BRL },
              { amount: 21_000, currency: TargetCurrency.COP },
            ],
            source: [
              { amount: 20.123457, currency: CryptoCurrency.USDC },
              { amount: 10.25, currency: CryptoCurrency.USDT },
            ],
            stablecoinAmount: 30.373457,
          },
          hasApiKey: true,
          id: 'partner-a',
        }),
        expect.objectContaining({
          clientDomain: undefined,
          completedVolume: {
            completedTransactions: 0,
            payout: [],
            source: [],
            stablecoinAmount: 0,
          },
          hasApiKey: false,
          id: 'partner-b',
        }),
      ],
      maximumStablecoinAmount: 42.123457,
      page: 2,
      pageSize: 1,
      total: 2,
    })
  })

  it('does not query completed volume when the requested page has no partners', async () => {
    partner.count.mockResolvedValueOnce(22)

    const result = await service.listPartners({ page: 3, pageSize: 10 })

    expect(queryRaw).toHaveBeenCalledTimes(1)
    expect(partner.findMany).not.toHaveBeenCalled()
    expect(quote.groupBy).not.toHaveBeenCalled()
    expect(result).toEqual({
      items: [],
      maximumStablecoinAmount: 0,
      page: 3,
      pageSize: 10,
      total: 22,
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

    expect(transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    })
    expect(partner.update).toHaveBeenCalledWith({
      data: {
        apiKey: hashPartnerApiKey(result.apiKey),
        previousApiKey: 'current-legacy-key-hash',
        previousApiKeyExpiresAt: expect.any(Date),
      },
      where: { id: 'partner-rotate' },
    })
    expect(result.apiKey.startsWith('partner_')).toBe(true)
    expect(result.partner.id).toBe('partner-rotate')
    expect(result.partner.hasApiKey).toBe(true)
  })

  it('throws not found when rotating a missing partner API key', async () => {
    partner.findUnique.mockResolvedValueOnce(null)

    await expect(service.rotateApiKey('missing')).rejects.toThrow(OpsPartnerNotFoundError)
  })

  it('prevents a second rotation while the prior key overlap is active', async () => {
    partner.findUnique.mockResolvedValueOnce(basePartner({
      apiKey: 'current-hash',
      previousApiKey: 'previous-hash',
      previousApiKeyExpiresAt: new Date(Date.now() + 60_000),
    }))

    await expect(service.rotateApiKey('partner-rotate')).rejects.toThrow(
      'A 24-hour credential overlap is already active',
    )
    expect(partner.update).not.toHaveBeenCalled()
  })

  it('returns credential history without exposing current, previous, or managed secret hashes', async () => {
    const overlapExpiresAt = new Date(Date.now() + 60_000)
    const historyService = new OpsPartnerService({
      getClient: jest.fn(async () => ({
        opsAuditEvent: {
          findMany: jest.fn(async () => [{
            action: 'credentials.api_key.rotate.succeeded',
            actorLabel: 'Ops Administrator',
            createdAt: new Date('2026-08-02T14:00:00.000Z'),
            id: 'ops-event-1',
            reason: 'Scheduled rotation',
            reference: 'OPS-123',
          }]),
        },
        partner: {
          findUnique: jest.fn(async () => basePartner({
            apiKey: 'current-secret-hash',
            previousApiKey: 'previous-secret-hash',
            previousApiKeyExpiresAt: overlapExpiresAt,
          })),
        },
        partnerApiKey: {
          findMany: jest.fn(async () => [{
            createdAt: new Date('2026-08-01T14:00:00.000Z'),
            displayPrefix: 'partner_ab12',
            expiresAt: null,
            id: 'managed-key-1',
            lastUsedAt: new Date('2026-08-02T13:00:00.000Z'),
            name: 'Production integration',
            revokedAt: null,
            rotatedFromId: null,
            rotatedTo: null,
            scopes: [PartnerApiKeyScope.TRANSACTIONS_READ],
            secretHash: 'managed-secret-hash',
          }]),
        },
        partnerPortalAuditEvent: {
          findMany: jest.fn(async () => [{
            action: 'api_key.created',
            createdAt: new Date('2026-08-01T14:00:00.000Z'),
            id: 'portal-event-1',
          }]),
        },
      }) as unknown as import('@prisma/client').PrismaClient),
    })

    const result = await historyService.getCredentialHistory('partner-1')
    const serialized = JSON.stringify(result)

    expect(result.legacyCredential).toEqual({
      active: true,
      overlapExpiresAt,
    })
    expect(result.managedCredentials).toEqual([expect.objectContaining({
      displayPrefix: 'partner_ab12',
      scopes: ['transactions:read'],
      status: 'ACTIVE',
    })])
    expect(result.events.map(event => event.source)).toEqual(['OPS', 'PARTNER_PORTAL'])
    expect(serialized).not.toContain('current-secret-hash')
    expect(serialized).not.toContain('previous-secret-hash')
    expect(serialized).not.toContain('managed-secret-hash')
  })

  it('approves and revokes KYB', async () => {
    await service.updateKybApproval('partner-domain', { isKybApproved: true })
    expect(partner.update).toHaveBeenCalledWith({
      data: { isKybApproved: true },
      where: { id: 'partner-domain' },
    })
  })

  it('updates only the profile fields provided, normalizing them', async () => {
    await service.updateProfile('partner-domain', {
      country: 'co',
      email: '  New@Example.COM ',
      name: '  Acme Corp  ',
    })

    expect(partner.update).toHaveBeenCalledWith({
      data: { country: 'CO', email: 'new@example.com', name: 'Acme Corp' },
      where: { id: 'partner-domain' },
    })
  })

  it('clears a profile field when explicitly passed null', async () => {
    await service.updateProfile('partner-domain', { phone: null })
    expect(partner.update).toHaveBeenCalledWith({
      data: { phone: null },
      where: { id: 'partner-domain' },
    })
  })

  it('rejects a profile update with no fields', async () => {
    await expect(service.updateProfile('partner-domain', {})).rejects
      .toThrow(new OpsPartnerValidationError('No partner profile fields were provided'))
    expect(partner.update).not.toHaveBeenCalled()
  })

  it('suspends a partner with an actor and reason, then restores it', async () => {
    await service.updateStatus('partner-domain', { disabled: true, reason: '  fraud review  ' }, 'ops@abroad.finance')
    expect(partner.update).toHaveBeenCalledWith({
      data: {
        disabledAt: expect.any(Date),
        disabledBy: 'ops@abroad.finance',
        disabledReason: 'fraud review',
      },
      where: { id: 'partner-domain' },
    })

    await service.updateStatus('partner-domain', { disabled: false }, 'ops@abroad.finance')
    expect(partner.update).toHaveBeenLastCalledWith({
      data: { disabledAt: null, disabledBy: null, disabledReason: null },
      where: { id: 'partner-domain' },
    })
  })

  it('accepts an https webhook URL and rejects anything else', async () => {
    await service.updateWebhookUrl('partner-domain', { webhookUrl: ' https://hooks.example.com/abroad ' })
    expect(partner.update).toHaveBeenCalledWith({
      data: { webhookUrl: 'https://hooks.example.com/abroad' },
      where: { id: 'partner-domain' },
    })

    await expect(service.updateWebhookUrl('partner-domain', { webhookUrl: 'http://insecure.example.com' }))
      .rejects.toThrow(/https/)
  })

  it('turns the partner KYC requirement on and off', async () => {
    await service.updateKycRequirement('partner-domain', { needsKyc: false })
    expect(partner.update).toHaveBeenCalledWith({
      data: { needsKyc: false },
      where: { id: 'partner-domain' },
    })

    await service.updateKycRequirement('partner-domain', { needsKyc: true })
    expect(partner.update).toHaveBeenLastCalledWith({
      data: { needsKyc: true },
      where: { id: 'partner-domain' },
    })
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
      data: {
        apiKey: null,
        previousApiKey: null,
        previousApiKeyExpiresAt: null,
      },
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

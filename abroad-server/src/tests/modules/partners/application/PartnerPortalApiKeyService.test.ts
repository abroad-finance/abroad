import 'reflect-metadata'

import type { PartnerApiKey, PrismaClient } from '@prisma/client'

import { PartnerApiKeyScope, PartnerPortalRole, Prisma } from '@prisma/client'

import { PartnerPortalApiKeyNotFoundError, PartnerPortalApiKeyService, PartnerPortalApiKeyValidationError } from '../../../../modules/partners/application/PartnerPortalApiKeyService'
import { PartnerPortalAuditService } from '../../../../modules/partners/application/PartnerPortalAuditService'
import { PartnerPortalPrincipal } from '../../../../modules/partners/application/PartnerPortalSessionService'
import { IDatabaseClientProvider } from '../../../../platform/persistence/IDatabaseClientProvider'

type TransactionCallback = (transaction: Prisma.TransactionClient) => Promise<unknown>

const principal: PartnerPortalPrincipal = {
  authenticationSource: 'PARTNER_PORTAL',
  email: 'admin@decaf.so',
  kind: 'partner_portal',
  mfaEnabled: true,
  mfaVerified: true,
  partner: {
    id: 'partner-1',
    name: 'Decaf',
  } as PartnerPortalPrincipal['partner'],
  role: PartnerPortalRole.ADMIN,
  userId: 'user-1',
}

const apiKey = (overrides: Partial<PartnerApiKey> = {}): PartnerApiKey => ({
  createdAt: new Date('2026-08-01T12:00:00.000Z'),
  createdByUserId: principal.userId,
  displayPrefix: 'partner_abcd',
  expiresAt: new Date('2027-08-01T12:00:00.000Z'),
  id: 'api-key-1',
  lastUsedAt: null,
  name: 'Production payments',
  partnerId: principal.partner.id,
  revokedAt: null,
  rotatedFromId: null,
  scopes: [PartnerApiKeyScope.TRANSACTIONS_READ, PartnerApiKeyScope.TRANSACTIONS_WRITE],
  secretHash: 'stored-hash',
  updatedAt: new Date('2026-08-01T12:00:00.000Z'),
  ...overrides,
})

const prismaError = (code: string): Prisma.PrismaClientKnownRequestError => (
  new Prisma.PrismaClientKnownRequestError('database conflict', {
    clientVersion: 'test',
    code,
  })
)

const buildHarness = () => {
  const create = jest.fn<Promise<PartnerApiKey>, [{ data: Record<string, unknown> }]>(
    async input => apiKey({
      displayPrefix: String(input.data.displayPrefix),
      expiresAt: input.data.expiresAt as Date | null,
      name: String(input.data.name),
      scopes: input.data.scopes as PartnerApiKeyScope[],
      secretHash: String(input.data.secretHash),
    }),
  )
  const findFirst = jest.fn<Promise<null | (PartnerApiKey & { rotatedTo: null | { id: string } })>, [unknown]>(
    async () => ({ ...apiKey(), rotatedTo: null }),
  )
  const findMany = jest.fn<Promise<PartnerApiKey[]>, [unknown]>(async () => [apiKey()])
  const update = jest.fn<Promise<PartnerApiKey>, [{ data: Record<string, unknown>, where: { id: string } }]>(
    async input => apiKey({
      expiresAt: input.data.expiresAt instanceof Date
        ? input.data.expiresAt
        : apiKey().expiresAt,
      id: input.where.id,
      revokedAt: input.data.revokedAt instanceof Date ? input.data.revokedAt : null,
    }),
  )
  const transactionClient = {
    partnerApiKey: { create, findFirst, update },
  }
  const databaseTransaction = jest.fn<Promise<unknown>, [TransactionCallback, unknown?]>(
    async callback => callback(transactionClient as unknown as Prisma.TransactionClient),
  )
  const partnerFindUnique = jest.fn(async () => ({ apiKey: 'legacy-key-hash' }))
  const outerFindFirst = jest.fn<
    Promise<null | (PartnerApiKey & { rotatedTo: null | { id: string } })>,
    [unknown]
  >(async () => ({ ...apiKey(), rotatedTo: null }))
  const databaseClient = {
    $transaction: databaseTransaction,
    partner: { findUnique: partnerFindUnique },
    partnerApiKey: { findFirst: outerFindFirst, findMany },
  }
  const databaseClientProvider: IDatabaseClientProvider = {
    getClient: jest.fn(async () => databaseClient as unknown as PrismaClient),
  }
  const auditService = {
    record: jest.fn<
      ReturnType<PartnerPortalAuditService['record']>,
      Parameters<PartnerPortalAuditService['record']>
    >(async () => undefined),
  }

  return {
    auditService,
    create,
    databaseTransaction,
    findFirst,
    findMany,
    outerFindFirst,
    partnerFindUnique,
    service: new PartnerPortalApiKeyService(
      databaseClientProvider,
      auditService as unknown as PartnerPortalAuditService,
    ),
    update,
  }
}

describe('PartnerPortalApiKeyService', () => {
  it('creates a named scoped key, persists only its hash, and reveals plaintext once', async () => {
    const harness = buildHarness()
    const expiresAt = new Date('2027-01-01T00:00:00.000Z')

    const result = await harness.service.create(principal, {
      expiresAt,
      name: '  Production payments  ',
      scopes: ['transactions:write', 'transactions:read', 'transactions:write'],
    })

    expect(result.secret).toMatch(/^partner_[A-Za-z0-9_-]{32}$/u)
    expect(harness.create).toHaveBeenCalledTimes(1)
    const persisted = harness.create.mock.calls[0][0].data
    expect(persisted).toEqual(expect.objectContaining({
      createdByUserId: principal.userId,
      expiresAt,
      name: 'Production payments',
      partnerId: principal.partner.id,
      scopes: [
        PartnerApiKeyScope.TRANSACTIONS_WRITE,
        PartnerApiKeyScope.TRANSACTIONS_READ,
      ],
    }))
    expect(persisted.secretHash).not.toBe(result.secret)
    expect(JSON.stringify(persisted)).not.toContain(result.secret)
    expect(result.apiKey).not.toHaveProperty('secretHash')
    expect(harness.auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'api_key.created',
        actorUserId: principal.userId,
        partnerId: principal.partner.id,
      }),
      expect.anything(),
    )
  })

  it('lists only the requested partner keys and reports the legacy migration state', async () => {
    const harness = buildHarness()

    const result = await harness.service.list(principal.partner.id)

    expect(harness.partnerFindUnique).toHaveBeenCalledWith({
      select: { apiKey: true },
      where: { id: principal.partner.id },
    })
    expect(harness.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { partnerId: principal.partner.id },
    }))
    expect(result.legacyKeyActive).toBe(true)
    expect(result.items).toEqual([
      expect.objectContaining({
        id: apiKey().id,
        scopes: ['transactions:read', 'transactions:write'],
        status: 'ACTIVE',
      }),
    ])
  })

  it('revokes a tenant-owned key immediately and does not duplicate its audit event', async () => {
    const harness = buildHarness()

    const revoked = await harness.service.revoke(principal, apiKey().id)

    expect(harness.findFirst).toHaveBeenCalledWith({
      where: { id: apiKey().id, partnerId: principal.partner.id },
    })
    expect(harness.update).toHaveBeenCalledWith({
      data: { revokedAt: expect.any(Date) },
      where: { id: apiKey().id },
    })
    expect(revoked.status).toBe('REVOKED')
    expect(harness.auditService.record).toHaveBeenCalledTimes(1)

    harness.findFirst.mockResolvedValueOnce({
      ...apiKey({ revokedAt: new Date('2026-08-01T13:00:00.000Z') }),
      rotatedTo: null,
    })
    await harness.service.revoke(principal, apiKey().id)
    expect(harness.auditService.record).toHaveBeenCalledTimes(1)
  })

  it('does not reveal whether another tenant owns a key', async () => {
    const harness = buildHarness()
    harness.findFirst.mockResolvedValueOnce(null)

    await expect(harness.service.revoke(principal, 'other-key')).rejects.toThrow(
      new PartnerPortalApiKeyNotFoundError(),
    )
    expect(harness.update).not.toHaveBeenCalled()
  })

  it('rotates under serializable isolation and preserves scopes with bounded overlap', async () => {
    const harness = buildHarness()
    harness.create.mockImplementationOnce(async input => apiKey({
      displayPrefix: String(input.data.displayPrefix),
      id: 'api-key-successor',
      name: String(input.data.name),
      rotatedFromId: String(input.data.rotatedFromId),
      secretHash: String(input.data.secretHash),
    }))

    const result = await harness.service.rotate(principal, apiKey().id)

    expect(harness.databaseTransaction).toHaveBeenCalledWith(
      expect.any(Function),
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    )
    expect(harness.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        name: 'Production payments (rotated)',
        partnerId: principal.partner.id,
        rotatedFromId: apiKey().id,
        scopes: apiKey().scopes,
      }),
    })
    expect(harness.update).toHaveBeenCalledWith({
      data: { expiresAt: expect.any(Date) },
      where: { id: apiKey().id },
    })
    expect(result.apiKey.id).toBe('api-key-successor')
    expect(result.secret).toMatch(/^partner_/u)
  })

  it('maps a concurrent rotation conflict to the explicit already-rotated result', async () => {
    const harness = buildHarness()
    harness.databaseTransaction.mockRejectedValueOnce(prismaError('P2034'))
    harness.outerFindFirst.mockResolvedValueOnce({
      ...apiKey(),
      rotatedTo: { id: 'api-key-successor' },
    })

    await expect(harness.service.rotate(principal, apiKey().id)).rejects.toThrow(
      new PartnerPortalApiKeyValidationError('API key has already been rotated'),
    )
  })

  it('returns bounded validation failures for invalid input and exhausted collisions', async () => {
    const harness = buildHarness()

    await expect(harness.service.create(principal, {
      name: 'invalid',
      scopes: [],
    })).rejects.toThrow('Select at least one valid API key scope')

    harness.databaseTransaction.mockRejectedValue(prismaError('P2002'))
    await expect(harness.service.create(principal, {
      name: 'Production',
      scopes: ['transactions:read'],
    })).rejects.toThrow('Could not generate a unique API key')
    expect(harness.databaseTransaction).toHaveBeenCalledTimes(5)
  })
})

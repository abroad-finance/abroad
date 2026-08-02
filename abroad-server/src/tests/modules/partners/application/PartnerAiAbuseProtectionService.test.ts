import 'reflect-metadata'

import type { PartnerPortalPublicRateLimit, PrismaClient } from '@prisma/client'

import { Prisma } from '@prisma/client'

import { PartnerAiAbuseProtectionService, PartnerAiRateLimitError } from '../../../../modules/partners/application/PartnerAiAbuseProtectionService'
import { IDatabaseClientProvider } from '../../../../platform/persistence/IDatabaseClientProvider'
import { ISecretManager } from '../../../../platform/secrets/ISecretManager'

type TransactionCallback = (transaction: Prisma.TransactionClient) => Promise<unknown>

const now = new Date('2026-08-02T18:00:00.000Z')

const buildHarness = () => {
  const states = new Map<string, PartnerPortalPublicRateLimit>()
  const findUnique = jest.fn(async (input: { where: { keyHash: string } }) => (
    states.get(input.where.keyHash) ?? null
  ))
  const create = jest.fn(async (input: {
    data: { attempts: number, keyHash: string, windowEndsAt: Date }
  }) => {
    const state: PartnerPortalPublicRateLimit = {
      attempts: input.data.attempts,
      keyHash: input.data.keyHash,
      updatedAt: now,
      windowEndsAt: input.data.windowEndsAt,
    }
    states.set(state.keyHash, state)
    return state
  })
  const update = jest.fn(async (input: {
    data: { attempts: number | { increment: number }, windowEndsAt?: Date }
    where: { keyHash: string }
  }) => {
    const existing = states.get(input.where.keyHash)
    if (!existing) throw new Error('Missing rate-limit state')
    const state: PartnerPortalPublicRateLimit = {
      ...existing,
      attempts: typeof input.data.attempts === 'number'
        ? input.data.attempts
        : existing.attempts + input.data.attempts.increment,
      updatedAt: now,
      windowEndsAt: input.data.windowEndsAt ?? existing.windowEndsAt,
    }
    states.set(state.keyHash, state)
    return state
  })
  const transactionClient = {
    partnerPortalPublicRateLimit: { create, findUnique, update },
  }
  const transaction = jest.fn<Promise<unknown>, [TransactionCallback, unknown?]>(
    async callback => callback(transactionClient as unknown as Prisma.TransactionClient),
  )
  const databaseClientProvider: IDatabaseClientProvider = {
    getClient: jest.fn(async () => ({
      $transaction: transaction,
      partnerPortalPublicRateLimit: {
        deleteMany: jest.fn(async () => ({ count: 0 })),
      },
    }) as unknown as PrismaClient),
  }
  const secretManager: ISecretManager = {
    getSecret: jest.fn(async () => 's'.repeat(64)),
    getSecrets: jest.fn(),
  }
  return {
    service: new PartnerAiAbuseProtectionService(databaseClientProvider, secretManager),
    states,
    transaction,
  }
}

describe('PartnerAiAbuseProtectionService', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    jest.setSystemTime(now)
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('rate-limits public client registration with a bounded retry time', async () => {
    const harness = buildHarness()
    for (let attempt = 0; attempt < 30; attempt += 1) {
      await harness.service.assertRegistrationAllowed('203.0.113.20')
    }

    await expect(harness.service.assertRegistrationAllowed('203.0.113.20')).rejects.toEqual(
      expect.objectContaining<Partial<PartnerAiRateLimitError>>({
        retryAfterSeconds: 3_600,
      }),
    )
  })

  it('persists only purpose-bound hashes, never IP addresses or public client IDs', async () => {
    const harness = buildHarness()

    await harness.service.assertAuthorizationAllowed('203.0.113.20', 'abroad_mcp_client_public')
    await harness.service.assertTokenRequestAllowed('203.0.113.20', 'abroad_mcp_client_public')

    const serialized = JSON.stringify([...harness.states.values()])
    expect(serialized).not.toContain('203.0.113.20')
    expect(serialized).not.toContain('abroad_mcp_client_public')
    expect(harness.states.size).toBe(4)
    for (const keyHash of harness.states.keys()) {
      expect(keyHash).toMatch(/^[A-Za-z0-9_-]{43}$/u)
    }
  })

  it('retries a concurrent rate-row insertion safely', async () => {
    const harness = buildHarness()
    harness.transaction.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError(
      'duplicate rate row',
      { clientVersion: 'test', code: 'P2002' },
    ))

    await expect(harness.service.assertRegistrationAllowed('203.0.113.20')).resolves.toBeUndefined()
    expect(harness.transaction).toHaveBeenCalledTimes(2)
  })
})

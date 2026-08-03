import 'reflect-metadata'

import type { PartnerPortalPublicRateLimit, PrismaClient } from '@prisma/client'

import { Prisma } from '@prisma/client'

import { PartnerPortalSignupProtectionError, PartnerPortalSignupProtectionService, PartnerPortalSignupRateLimitError } from '../../../../modules/partners/application/PartnerPortalSignupProtectionService'
import { IDatabaseClientProvider } from '../../../../platform/persistence/IDatabaseClientProvider'
import { ISecretManager } from '../../../../platform/secrets/ISecretManager'

type TransactionCallback = (transaction: Prisma.TransactionClient) => Promise<unknown>

const signingSecret = 's'.repeat(64)
const startTime = new Date('2026-08-02T12:00:00.000Z')

const buildHarness = () => {
  const states = new Map<string, PartnerPortalPublicRateLimit>()
  const create = jest.fn(async (input: {
    data: {
      attempts: number
      keyHash: string
      windowEndsAt: Date
    }
  }) => {
    const state: PartnerPortalPublicRateLimit = {
      attempts: input.data.attempts,
      keyHash: input.data.keyHash,
      updatedAt: new Date(),
      windowEndsAt: input.data.windowEndsAt,
    }
    states.set(state.keyHash, state)
    return state
  })
  const findUnique = jest.fn(async (input: { where: { keyHash: string } }) => (
    states.get(input.where.keyHash) ?? null
  ))
  const update = jest.fn(async (input: {
    data: {
      attempts: number | { increment: number }
      windowEndsAt?: Date
    }
    where: { keyHash: string }
  }) => {
    const existing = states.get(input.where.keyHash)
    if (!existing) {
      throw new Error('Rate-limit row does not exist')
    }
    const attempts = typeof input.data.attempts === 'number'
      ? input.data.attempts
      : existing.attempts + input.data.attempts.increment
    const state: PartnerPortalPublicRateLimit = {
      ...existing,
      attempts,
      updatedAt: new Date(),
      windowEndsAt: input.data.windowEndsAt ?? existing.windowEndsAt,
    }
    states.set(state.keyHash, state)
    return state
  })
  const transactionClient = {
    partnerPortalPublicRateLimit: { create, findUnique, update },
  }
  const databaseTransaction = jest.fn<Promise<unknown>, [TransactionCallback, unknown?]>(
    async callback => callback(transactionClient as unknown as Prisma.TransactionClient),
  )
  const deleteMany = jest.fn(async () => ({ count: 0 }))
  const databaseClient = {
    $transaction: databaseTransaction,
    partnerPortalPublicRateLimit: { deleteMany },
  }
  const databaseClientProvider: IDatabaseClientProvider = {
    getClient: jest.fn(async () => databaseClient as unknown as PrismaClient),
  }
  const secretManager: ISecretManager = {
    getSecret: jest.fn(async () => signingSecret),
    getSecrets: jest.fn(),
  }

  return {
    create,
    databaseTransaction,
    secretManager,
    service: new PartnerPortalSignupProtectionService(databaseClientProvider, secretManager),
    states,
  }
}

describe('PartnerPortalSignupProtectionService', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    jest.setSystemTime(startTime)
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('requires a signed challenge to dwell before accepting a signup', async () => {
    const harness = buildHarness()
    const challenge = await harness.service.createChallenge('203.0.113.10')

    expect(challenge.readyAt).toEqual(new Date(startTime.getTime() + 1_500))
    expect(challenge.expiresAt).toEqual(new Date(startTime.getTime() + 15 * 60 * 1_000))
    await expect(harness.service.assertSignupAllowed({
      challengeToken: challenge.challengeToken,
      clientIp: '203.0.113.10',
      email: 'admin@atlas.example',
      honeypot: '',
      organization: 'atlaspayments\u001fbr',
    })).rejects.toThrow(new PartnerPortalSignupProtectionError(
      'Signup request could not be verified',
    ))

    jest.advanceTimersByTime(1_500)
    await expect(harness.service.assertSignupAllowed({
      challengeToken: challenge.challengeToken,
      clientIp: '203.0.113.10',
      email: 'admin@atlas.example',
      honeypot: '',
      organization: 'atlaspayments\u001fbr',
    })).resolves.toBeUndefined()
  })

  it('rejects tampered challenges and filled honeypots with the same bounded error', async () => {
    const tamperedHarness = buildHarness()
    const challenge = await tamperedHarness.service.createChallenge('203.0.113.10')
    jest.advanceTimersByTime(1_500)

    await expect(tamperedHarness.service.assertSignupAllowed({
      challengeToken: `${challenge.challengeToken}tampered`,
      clientIp: '203.0.113.10',
      email: 'admin@atlas.example',
      honeypot: '',
      organization: 'atlaspayments\u001fbr',
    })).rejects.toThrow('Signup request could not be verified')

    const honeypotHarness = buildHarness()
    const secondChallenge = await honeypotHarness.service.createChallenge('203.0.113.10')
    jest.advanceTimersByTime(1_500)
    await expect(honeypotHarness.service.assertSignupAllowed({
      challengeToken: secondChallenge.challengeToken,
      clientIp: '203.0.113.10',
      email: 'admin@atlas.example',
      honeypot: 'https://bot.example',
      organization: 'atlaspayments\u001fbr',
    })).rejects.toThrow('Signup request could not be verified')
  })

  it('enforces the shared hourly challenge limit and returns a bounded retry time', async () => {
    const harness = buildHarness()
    for (let attempt = 0; attempt < 30; attempt += 1) {
      await harness.service.createChallenge('203.0.113.10')
    }

    await expect(harness.service.createChallenge('203.0.113.10')).rejects.toEqual(
      expect.objectContaining<Partial<PartnerPortalSignupRateLimitError>>({
        retryAfterSeconds: 3_600,
      }),
    )
  })

  it('protects resend recovery with independent IP and email quotas', async () => {
    const harness = buildHarness()
    const challenge = await harness.service.createChallenge('203.0.113.10')
    jest.advanceTimersByTime(1_500)

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await harness.service.assertResendAllowed({
        challengeToken: challenge.challengeToken,
        clientIp: '203.0.113.10',
        email: 'admin@atlas.example',
        honeypot: '',
      })
    }

    await expect(harness.service.assertResendAllowed({
      challengeToken: challenge.challengeToken,
      clientIp: '203.0.113.10',
      email: 'admin@atlas.example',
      honeypot: '',
    })).rejects.toBeInstanceOf(PartnerPortalSignupRateLimitError)
    expect(JSON.stringify([...harness.states.values()])).not.toContain('admin@atlas.example')
  })

  it('persists only purpose-bound HMACs, never raw abuse-control identifiers', async () => {
    const harness = buildHarness()
    const challenge = await harness.service.createChallenge('203.0.113.10')
    jest.advanceTimersByTime(1_500)
    await harness.service.assertSignupAllowed({
      challengeToken: challenge.challengeToken,
      clientIp: '203.0.113.10',
      email: 'admin@atlas.example',
      honeypot: '',
      organization: 'atlaspayments\u001fbr',
    })

    const serializedStates = JSON.stringify([...harness.states.values()])
    expect(serializedStates).not.toContain('203.0.113.10')
    expect(serializedStates).not.toContain('admin@atlas.example')
    expect(serializedStates).not.toContain('atlaspayments')
    for (const keyHash of harness.states.keys()) {
      expect(keyHash).toMatch(/^[A-Za-z0-9_-]{43}$/u)
    }
  })

  it('retries a concurrent rate-row insert and refuses a weak signing secret', async () => {
    const retryHarness = buildHarness()
    retryHarness.databaseTransaction.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('duplicate', {
        clientVersion: 'test',
        code: 'P2002',
      }),
    )
    await expect(retryHarness.service.createChallenge('203.0.113.10')).resolves.toEqual(
      expect.objectContaining({ challengeToken: expect.any(String) }),
    )
    expect(retryHarness.databaseTransaction).toHaveBeenCalledTimes(2)

    const weakSecretHarness = buildHarness()
    jest.mocked(weakSecretHarness.secretManager.getSecret).mockResolvedValueOnce('short')
    await expect(weakSecretHarness.service.createChallenge('198.51.100.8')).rejects.toThrow(
      'Partner portal signing secret is not configured securely',
    )
  })
})

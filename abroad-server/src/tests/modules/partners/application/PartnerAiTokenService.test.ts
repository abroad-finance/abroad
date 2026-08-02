import 'reflect-metadata'

import type { PrismaClient } from '@prisma/client'

import { PartnerAiAuthorizationOutcome, PartnerAiClientKind, PartnerAiScope, Prisma } from '@prisma/client'
import { createHash } from 'node:crypto'

import { PartnerAiAbuseProtectionService } from '../../../../modules/partners/application/PartnerAiAbuseProtectionService'
import { PartnerAiOAuthError } from '../../../../modules/partners/application/PartnerAiErrors'
import { PartnerAiTokenService } from '../../../../modules/partners/application/PartnerAiTokenService'
import { PartnerPortalAuditService } from '../../../../modules/partners/application/PartnerPortalAuditService'
import { IDatabaseClientProvider } from '../../../../platform/persistence/IDatabaseClientProvider'

type TransactionCallback = (transaction: Prisma.TransactionClient) => Promise<unknown>

const now = new Date('2026-08-02T18:00:00.000Z')
const verifier = 'v'.repeat(43)
const challenge = createHash('sha256').update(verifier, 'ascii').digest('base64url')
const authorizationCode = `abroad_mcp_code_${'c'.repeat(43)}`
const refreshCredential = `abroad_mcp_rt_${'r'.repeat(43)}`
const accessCredential = `abroad_mcp_at_${'a'.repeat(43)}`

const oauthClient = (overrides: Readonly<Record<string, unknown>> = {}) => ({
  clientId: 'abroad_mcp_client_public',
  clientName: 'Operations Assistant',
  disabledAt: null,
  id: 'oauth-client-1',
  verifiedKind: PartnerAiClientKind.GENERIC,
  ...overrides,
})

const connection = (overrides: Readonly<Record<string, unknown>> = {}) => ({
  activeGrantKey: 'active-grant',
  expiresAt: new Date('2026-09-01T18:00:00.000Z'),
  failedAt: null,
  id: 'connection-1',
  oauthClient: oauthClient(),
  oauthClientId: 'oauth-client-1',
  partner: { id: 'partner-1', name: 'Atlas Payments' },
  partnerId: 'partner-1',
  revokedAt: null,
  ...overrides,
})

const authorizationRequest = (overrides: Readonly<Record<string, unknown>> = {}) => ({
  codeChallenge: challenge,
  codeConsumedAt: null,
  codeExpiresAt: new Date('2026-08-02T18:02:00.000Z'),
  connection: connection(),
  connectionId: 'connection-1',
  id: 'authorization-request-1',
  oauthClient: oauthClient(),
  oauthClientId: 'oauth-client-1',
  outcome: PartnerAiAuthorizationOutcome.APPROVED,
  redirectUri: 'https://assistant.example/oauth/callback',
  resource: 'https://api.abroad.finance/mcp',
  scopes: [
    PartnerAiScope.ACCOUNT_READ,
    PartnerAiScope.TRANSACTIONS_READ,
    PartnerAiScope.OFFLINE_ACCESS,
  ],
  ...overrides,
})

const refreshToken = (overrides: Readonly<Record<string, unknown>> = {}) => ({
  connection: connection(),
  connectionId: 'connection-1',
  consumedAt: null,
  expiresAt: new Date('2026-09-01T18:00:00.000Z'),
  familyId: 'refresh-family-1',
  id: 'refresh-token-1',
  replacedById: null,
  revokedAt: null,
  scopes: [
    PartnerAiScope.ACCOUNT_READ,
    PartnerAiScope.TRANSACTIONS_READ,
    PartnerAiScope.OFFLINE_ACCESS,
  ],
  ...overrides,
})

const accessToken = (overrides: Readonly<Record<string, unknown>> = {}) => ({
  connection: connection(),
  connectionId: 'connection-1',
  expiresAt: new Date('2026-08-02T19:00:00.000Z'),
  id: 'access-token-1',
  lastUsedAt: null,
  revokedAt: null,
  scopes: [PartnerAiScope.ACCOUNT_READ, PartnerAiScope.TRANSACTIONS_READ],
  ...overrides,
})

const buildHarness = () => {
  const authorizationFindUnique = jest.fn(async () => authorizationRequest())
  const refreshFindUnique = jest.fn(async () => refreshToken())
  const accessFindUnique = jest.fn(async () => accessToken())
  const authorizationUpdateMany = jest.fn(async () => ({ count: 1 }))
  const accessCreate = jest.fn(async (input: { data: Readonly<Record<string, unknown>> }) => input.data)
  const accessUpdateMany = jest.fn(async () => ({ count: 1 }))
  const refreshCreate = jest.fn(async (input: { data: Readonly<Record<string, unknown>> }) => ({
    id: 'refresh-token-2',
    ...input.data,
  }))
  const refreshUpdate = jest.fn(async () => refreshToken({ id: 'refresh-token-1' }))
  const refreshUpdateMany = jest.fn(async () => ({ count: 1 }))
  const connectionUpdateMany = jest.fn(async () => ({ count: 1 }))
  const oauthUpdate = jest.fn(async () => oauthClient())
  const transactionClient = {
    partnerAiAccessToken: { create: accessCreate, updateMany: accessUpdateMany },
    partnerAiAuthorizationRequest: { updateMany: authorizationUpdateMany },
    partnerAiConnection: { updateMany: connectionUpdateMany },
    partnerAiOAuthClient: { update: oauthUpdate },
    partnerAiRefreshToken: {
      create: refreshCreate,
      update: refreshUpdate,
      updateMany: refreshUpdateMany,
    },
  }
  const transaction = jest.fn<Promise<unknown>, [TransactionCallback, unknown?]>(
    async callback => callback(transactionClient as unknown as Prisma.TransactionClient),
  )
  const databaseClientProvider: IDatabaseClientProvider = {
    getClient: jest.fn(async () => ({
      $transaction: transaction,
      partnerAiAccessToken: {
        findUnique: accessFindUnique,
        updateMany: accessUpdateMany,
      },
      partnerAiAuthorizationRequest: { findUnique: authorizationFindUnique },
      partnerAiConnection: { updateMany: connectionUpdateMany },
      partnerAiOAuthClient: { updateMany: oauthUpdate },
      partnerAiRefreshToken: {
        findUnique: refreshFindUnique,
        updateMany: refreshUpdateMany,
      },
    }) as unknown as PrismaClient),
  }
  const auditRecord = jest.fn(async () => undefined)
  const assertTokenRequestAllowed = jest.fn(async () => undefined)
  return {
    accessCreate,
    accessFindUnique,
    accessUpdateMany,
    assertTokenRequestAllowed,
    auditRecord,
    authorizationFindUnique,
    authorizationUpdateMany,
    connectionUpdateMany,
    oauthUpdate,
    refreshCreate,
    refreshFindUnique,
    refreshUpdate,
    refreshUpdateMany,
    service: new PartnerAiTokenService(
      databaseClientProvider,
      { record: auditRecord } as unknown as PartnerPortalAuditService,
      { assertTokenRequestAllowed } as unknown as PartnerAiAbuseProtectionService,
    ),
    transaction,
  }
}

describe('PartnerAiTokenService', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    jest.setSystemTime(now)
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('exchanges a single-use PKCE code and persists hashes instead of returned credentials', async () => {
    const harness = buildHarness()

    const result = await harness.service.exchange({
      client_id: 'abroad_mcp_client_public',
      code: authorizationCode,
      code_verifier: verifier,
      grant_type: 'authorization_code',
      redirect_uri: 'https://assistant.example/oauth/callback',
      resource: 'https://api.abroad.finance/mcp',
    }, '203.0.113.20')

    expect(harness.assertTokenRequestAllowed).toHaveBeenCalledWith(
      '203.0.113.20',
      'abroad_mcp_client_public',
    )
    expect(result.access_token).toMatch(/^abroad_mcp_at_[A-Za-z0-9_-]{43}$/u)
    expect(result.refresh_token).toMatch(/^abroad_mcp_rt_[A-Za-z0-9_-]{43}$/u)
    expect(result).toEqual(expect.objectContaining({
      expires_in: 3_600,
      scope: 'account:read transactions:read offline_access',
      token_type: 'Bearer',
    }))
    expect(harness.authorizationUpdateMany).toHaveBeenCalledWith({
      data: { codeConsumedAt: now },
      where: {
        codeConsumedAt: null,
        codeExpiresAt: { gt: now },
        id: 'authorization-request-1',
      },
    })
    const serializedWrites = JSON.stringify([
      harness.accessCreate.mock.calls,
      harness.refreshCreate.mock.calls,
    ])
    expect(serializedWrites).not.toContain(result.access_token)
    expect(serializedWrites).not.toContain(result.refresh_token)
    expect(serializedWrites).not.toContain(authorizationCode)
    expect(harness.accessCreate.mock.calls[0][0]).toEqual({
      data: expect.objectContaining({
        tokenHash: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/u),
      }),
    })
    expect(harness.refreshCreate.mock.calls[0][0]).toEqual({
      data: expect.objectContaining({
        familyId: expect.any(String),
        tokenHash: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/u),
      }),
    })
  })

  it.each([
    { code_verifier: 'x'.repeat(43) },
    { client_id: 'different_public_client' },
    { redirect_uri: 'https://assistant.example/other' },
    { resource: 'https://api.abroad.finance/other' },
  ])('rejects a code exchange when a bound PKCE or OAuth value changes', async (override) => {
    const harness = buildHarness()

    await expect(harness.service.exchange({
      client_id: 'abroad_mcp_client_public',
      code: authorizationCode,
      code_verifier: verifier,
      grant_type: 'authorization_code',
      redirect_uri: 'https://assistant.example/oauth/callback',
      resource: 'https://api.abroad.finance/mcp',
      ...override,
    }, '203.0.113.20')).rejects.toEqual(expect.objectContaining<Partial<PartnerAiOAuthError>>({
      code: 'invalid_grant',
    }))
    expect(harness.transaction).not.toHaveBeenCalled()
  })

  it('has one winner if two exchanges race for the same authorization code', async () => {
    const harness = buildHarness()
    harness.authorizationUpdateMany.mockResolvedValueOnce({ count: 0 })

    await expect(harness.service.exchange({
      client_id: 'abroad_mcp_client_public',
      code: authorizationCode,
      code_verifier: verifier,
      grant_type: 'authorization_code',
      redirect_uri: 'https://assistant.example/oauth/callback',
      resource: 'https://api.abroad.finance/mcp',
    }, '203.0.113.20')).rejects.toEqual(expect.objectContaining({ code: 'invalid_grant' }))
    expect(harness.accessCreate).not.toHaveBeenCalled()
    expect(harness.refreshCreate).not.toHaveBeenCalled()
  })

  it('rotates a refresh token and permits only a scope reduction', async () => {
    const harness = buildHarness()

    const result = await harness.service.exchange({
      client_id: 'abroad_mcp_client_public',
      grant_type: 'refresh_token',
      refresh_token: refreshCredential,
      resource: 'https://api.abroad.finance/mcp',
      scope: 'account:read transactions:read',
    }, '203.0.113.20')

    expect(result.scope).toBe('account:read transactions:read')
    expect(result.refresh_token).toMatch(/^abroad_mcp_rt_[A-Za-z0-9_-]{43}$/u)
    expect(harness.refreshUpdateMany).toHaveBeenCalledWith({
      data: { consumedAt: now },
      where: {
        consumedAt: null,
        expiresAt: { gt: now },
        id: 'refresh-token-1',
        revokedAt: null,
      },
    })
    expect(harness.refreshUpdate).toHaveBeenCalledWith({
      data: { replacedById: 'refresh-token-2' },
      where: { id: 'refresh-token-1' },
    })
    expect(harness.accessCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        scopes: [PartnerAiScope.ACCOUNT_READ, PartnerAiScope.TRANSACTIONS_READ],
      }),
    })
  })

  it('invalidates an active token family when a consumed refresh token is reused', async () => {
    const harness = buildHarness()
    harness.refreshFindUnique.mockResolvedValueOnce(refreshToken({ consumedAt: now }))

    await expect(harness.service.exchange({
      client_id: 'abroad_mcp_client_public',
      grant_type: 'refresh_token',
      refresh_token: refreshCredential,
      resource: 'https://api.abroad.finance/mcp',
    }, '203.0.113.20')).rejects.toEqual(expect.objectContaining({ code: 'invalid_grant' }))

    expect(harness.connectionUpdateMany).toHaveBeenCalledWith({
      data: {
        activeGrantKey: null,
        failedAt: now,
        failureCode: 'REFRESH_TOKEN_REUSE',
      },
      where: {
        activeGrantKey: { not: null },
        expiresAt: { gt: now },
        failedAt: null,
        id: 'connection-1',
        revokedAt: null,
      },
    })
    expect(harness.refreshUpdateMany).toHaveBeenCalledWith({
      data: { revokedAt: now },
      where: { familyId: 'refresh-family-1', revokedAt: null },
    })
    expect(harness.auditRecord).toHaveBeenCalledWith(expect.objectContaining({
      action: 'AI_CONNECTION_SECURITY_FAILED',
      metadata: {
        clientKind: PartnerAiClientKind.GENERIC,
        outcome: 'FAILED',
        reason: 'REFRESH_TOKEN_REUSE',
      },
    }), expect.anything())
  })

  it('does not misclassify a stale refresh after explicit revocation as a security failure', async () => {
    const harness = buildHarness()
    harness.refreshFindUnique.mockResolvedValueOnce(refreshToken({
      connection: connection({ activeGrantKey: null, revokedAt: now }),
      consumedAt: now,
      revokedAt: now,
    }))

    await expect(harness.service.exchange({
      client_id: 'abroad_mcp_client_public',
      grant_type: 'refresh_token',
      refresh_token: refreshCredential,
      resource: 'https://api.abroad.finance/mcp',
    }, '203.0.113.20')).rejects.toEqual(expect.objectContaining({ code: 'invalid_grant' }))
    expect(harness.transaction).not.toHaveBeenCalled()
    expect(harness.auditRecord).not.toHaveBeenCalled()
  })

  it('does not overwrite a concurrent explicit revocation with a refresh-reuse failure', async () => {
    const harness = buildHarness()
    harness.refreshFindUnique.mockResolvedValueOnce(refreshToken({ consumedAt: now }))
    harness.connectionUpdateMany.mockResolvedValueOnce({ count: 0 })

    await expect(harness.service.exchange({
      client_id: 'abroad_mcp_client_public',
      grant_type: 'refresh_token',
      refresh_token: refreshCredential,
      resource: 'https://api.abroad.finance/mcp',
    }, '203.0.113.20')).rejects.toEqual(expect.objectContaining({ code: 'invalid_grant' }))

    expect(harness.connectionUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        activeGrantKey: { not: null },
        revokedAt: null,
      }),
    }))
    expect(harness.auditRecord).not.toHaveBeenCalled()
  })

  it('authenticates only an active resource-bound connection and coalesces last-used writes', async () => {
    const harness = buildHarness()

    const result = await harness.service.authenticateAccessToken(accessCredential)

    expect(result).toEqual({
      accessTokenId: 'access-token-1',
      clientId: 'abroad_mcp_client_public',
      clientName: 'Operations Assistant',
      connectionExpiresAt: new Date('2026-09-01T18:00:00.000Z'),
      connectionId: 'connection-1',
      partnerId: 'partner-1',
      partnerName: 'Atlas Payments',
      scopes: ['account:read', 'transactions:read'],
      tokenExpiresAt: new Date('2026-08-02T19:00:00.000Z'),
    })
    expect(harness.accessUpdateMany).toHaveBeenCalledWith({
      data: { lastUsedAt: now },
      where: {
        id: 'access-token-1',
        OR: [{ lastUsedAt: null }, { lastUsedAt: { lt: new Date('2026-08-02T17:55:00.000Z') } }],
      },
    })

    harness.accessFindUnique.mockResolvedValueOnce(accessToken({
      connection: connection({ activeGrantKey: null, revokedAt: now }),
    }))
    await expect(harness.service.authenticateAccessToken(accessCredential)).rejects.toEqual(
      expect.objectContaining({ code: 'invalid_grant' }),
    )
  })

  it('makes OAuth revocation enumeration-safe and revokes a matching client grant once', async () => {
    const harness = buildHarness()

    await harness.service.revoke({
      client_id: 'different_public_client',
      token: accessCredential,
    })
    expect(harness.transaction).not.toHaveBeenCalled()

    await harness.service.revoke({
      client_id: 'abroad_mcp_client_public',
      token: accessCredential,
    })
    expect(harness.connectionUpdateMany).toHaveBeenCalledWith({
      data: { activeGrantKey: null, revokedAt: now },
      where: { id: 'connection-1', revokedAt: null },
    })
    expect(harness.auditRecord).toHaveBeenCalledWith(expect.objectContaining({
      action: 'AI_CONNECTION_REVOKED',
      metadata: expect.objectContaining({ source: 'OAUTH_CLIENT' }),
    }), expect.anything())
  })
})

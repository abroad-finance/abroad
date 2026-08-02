import 'reflect-metadata'

import type { PrismaClient } from '@prisma/client'

import {
  PartnerAiAuthorizationOutcome,
  PartnerAiClientKind,
  PartnerAiScope,
  PartnerPortalRole,
  Prisma,
} from '@prisma/client'

import { PartnerAiAbuseProtectionService } from '../../../../modules/partners/application/PartnerAiAbuseProtectionService'
import { PartnerAiAuthorizationService } from '../../../../modules/partners/application/PartnerAiAuthorizationService'
import { PartnerAiPortalError } from '../../../../modules/partners/application/PartnerAiErrors'
import { PartnerPortalAuditService } from '../../../../modules/partners/application/PartnerPortalAuditService'
import { PartnerPortalSecretEnvelopeService } from '../../../../modules/partners/application/PartnerPortalSecretEnvelopeService'
import { PartnerPortalPrincipal } from '../../../../modules/partners/application/PartnerPortalSessionService'
import { IDatabaseClientProvider } from '../../../../platform/persistence/IDatabaseClientProvider'

type TransactionCallback = (transaction: Prisma.TransactionClient) => Promise<unknown>

const now = new Date('2026-08-02T18:00:00.000Z')

const principal = (overrides: Partial<PartnerPortalPrincipal> = {}): PartnerPortalPrincipal => ({
  authenticationSource: 'PARTNER_PORTAL',
  email: 'admin@partner.example',
  kind: 'partner_portal',
  mfaEnabled: true,
  mfaVerified: true,
  partner: { id: 'partner-1', name: 'Atlas Payments' } as PartnerPortalPrincipal['partner'],
  role: PartnerPortalRole.ADMIN,
  userId: 'portal-user-1',
  ...overrides,
})

const oauthClient = (overrides: Readonly<Record<string, unknown>> = {}) => ({
  allowedScopes: [
    PartnerAiScope.ACCOUNT_READ,
    PartnerAiScope.DOCS_READ,
    PartnerAiScope.TRANSACTIONS_READ,
    PartnerAiScope.WEBHOOKS_READ,
    PartnerAiScope.OFFLINE_ACCESS,
  ],
  clientId: 'abroad_mcp_client_public',
  clientName: 'Operations Assistant',
  clientUri: null,
  createdAt: new Date('2026-08-02T17:00:00.000Z'),
  disabledAt: null,
  id: 'oauth-client-1',
  lastUsedAt: null,
  redirectUris: ['https://assistant.example/oauth/callback'],
  updatedAt: new Date('2026-08-02T17:00:00.000Z'),
  verifiedKind: PartnerAiClientKind.GENERIC,
  ...overrides,
})

const authorizationRequest = (overrides: Readonly<Record<string, unknown>> = {}) => ({
  actorUserId: null,
  codeChallenge: 'challenge',
  codeConsumedAt: null,
  codeExpiresAt: null,
  codeHash: null,
  connectionId: null,
  createdAt: new Date('2026-08-02T17:55:00.000Z'),
  expiresAt: new Date('2026-08-02T18:15:00.000Z'),
  fingerprintHash: 'fingerprint',
  id: '11111111-1111-4111-8111-111111111111',
  oauthClient: oauthClient(),
  oauthClientId: 'oauth-client-1',
  outcome: PartnerAiAuthorizationOutcome.PENDING,
  partnerId: null,
  redirectUri: 'https://assistant.example/oauth/callback',
  resolvedAt: null,
  resource: 'https://api.abroad.finance/mcp',
  scopes: [PartnerAiScope.ACCOUNT_READ, PartnerAiScope.TRANSACTIONS_READ],
  stateCiphertext: 'encrypted-state',
  updatedAt: new Date('2026-08-02T17:55:00.000Z'),
  ...overrides,
})

const buildHarness = () => {
  const currentClient = oauthClient()
  const currentAuthorizationRequest = authorizationRequest({ oauthClient: currentClient })
  const oauthFindUnique = jest.fn(async () => currentClient)
  const oauthCreate = jest.fn(async (input: {
    data: Readonly<Record<string, unknown>>
  }) => ({ ...currentClient, ...input.data }))
  const oauthUpdate = jest.fn(async () => currentClient)
  const authorizationFindUnique = jest.fn(async (input: {
    where: Readonly<Record<string, unknown>>
  }) => 'fingerprintHash' in input.where ? null : currentAuthorizationRequest)
  const authorizationCreate = jest.fn(async (input: {
    data: Readonly<Record<string, unknown>>
  }) => ({ ...currentAuthorizationRequest, ...input.data }))
  const authorizationUpdateMany = jest.fn(async () => ({ count: 1 }))
  const authorizationUpdate = jest.fn(async (input: {
    data: Readonly<Record<string, unknown>>
    where: Readonly<Record<string, unknown>>
  }) => ({ ...currentAuthorizationRequest, ...input.data }))
  const connectionCount = jest.fn(async () => 0)
  const connectionCreate = jest.fn(async (input: {
    data: Readonly<Record<string, unknown>>
  }) => input.data)
  const connectionUpdateMany = jest.fn(async () => ({ count: 0 }))
  const transactionClient = {
    partnerAiAuthorizationRequest: {
      update: authorizationUpdate,
      updateMany: authorizationUpdateMany,
    },
    partnerAiConnection: {
      create: connectionCreate,
      updateMany: connectionUpdateMany,
    },
  }
  const transaction = jest.fn<Promise<unknown>, [TransactionCallback, unknown?]>(
    async callback => callback(transactionClient as unknown as Prisma.TransactionClient),
  )
  const databaseClientProvider: IDatabaseClientProvider = {
    getClient: jest.fn(async () => ({
      $transaction: transaction,
      partnerAiAuthorizationRequest: {
        create: authorizationCreate,
        findUnique: authorizationFindUnique,
        update: authorizationUpdate,
        updateMany: authorizationUpdateMany,
      },
      partnerAiConnection: {
        count: connectionCount,
        create: connectionCreate,
        updateMany: connectionUpdateMany,
      },
      partnerAiOAuthClient: {
        create: oauthCreate,
        findUnique: oauthFindUnique,
        update: oauthUpdate,
      },
    }) as unknown as PrismaClient),
  }
  const encrypt = jest.fn(async () => 'encrypted-state')
  const decrypt = jest.fn(async () => 'opaque-client-state')
  const auditRecord = jest.fn(async () => undefined)
  const assertAuthorizationAllowed = jest.fn(async () => undefined)
  const assertRegistrationAllowed = jest.fn(async () => undefined)
  return {
    assertAuthorizationAllowed,
    assertRegistrationAllowed,
    auditRecord,
    authorizationCreate,
    authorizationFindUnique,
    authorizationUpdate,
    authorizationUpdateMany,
    connectionCount,
    connectionCreate,
    connectionUpdateMany,
    decrypt,
    encrypt,
    oauthCreate,
    oauthFindUnique,
    oauthUpdate,
    service: new PartnerAiAuthorizationService(
      databaseClientProvider,
      { decrypt, encrypt } as unknown as PartnerPortalSecretEnvelopeService,
      { record: auditRecord } as unknown as PartnerPortalAuditService,
      {
        assertAuthorizationAllowed,
        assertRegistrationAllowed,
      } as unknown as PartnerAiAbuseProtectionService,
    ),
    transaction,
  }
}

describe('PartnerAiAuthorizationService', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    jest.setSystemTime(now)
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('registers a constrained public client without creating a client secret', async () => {
    const harness = buildHarness()

    const result = await harness.service.registerClient({
      clientName: 'Operations Assistant',
      clientUri: 'https://assistant.example',
      redirectUris: [{
        destinationHost: 'assistant.example',
        uri: 'https://assistant.example/oauth/callback',
      }],
      scopes: ['account:read', 'docs:read', 'offline_access'],
    }, '203.0.113.20')

    expect(harness.assertRegistrationAllowed).toHaveBeenCalledWith('203.0.113.20')
    expect(harness.oauthCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        allowedScopes: [
          PartnerAiScope.ACCOUNT_READ,
          PartnerAiScope.DOCS_READ,
          PartnerAiScope.OFFLINE_ACCESS,
        ],
        clientName: 'Operations Assistant',
        redirectUris: ['https://assistant.example/oauth/callback'],
        verifiedKind: PartnerAiClientKind.GENERIC,
      }),
    })
    expect(result).toEqual(expect.objectContaining({
      client_id: expect.stringMatching(/^abroad_mcp_client_[A-Za-z0-9_-]{43}$/u),
      token_endpoint_auth_method: 'none',
    }))
    expect(JSON.stringify(result)).not.toContain('client_secret')
  })

  it('stores encrypted client state and returns only an opaque portal request URL', async () => {
    const harness = buildHarness()

    const portalUrl = await harness.service.createAuthorizationRequest({
      clientId: 'abroad_mcp_client_public',
      codeChallenge: 'a'.repeat(43),
      redirectUri: 'https://assistant.example/oauth/callback',
      resource: 'https://api.abroad.finance/mcp',
      scopes: ['account:read', 'transactions:read'],
      state: 'opaque-client-state',
    }, '203.0.113.20')

    expect(harness.assertAuthorizationAllowed).toHaveBeenCalledWith(
      '203.0.113.20',
      'abroad_mcp_client_public',
    )
    const requestId = new URL(portalUrl).searchParams.get('request')
    expect(requestId).toMatch(/^[0-9a-f-]{36}$/u)
    expect(harness.encrypt).toHaveBeenCalledWith(
      'opaque-client-state',
      `partner-ai-oauth-state:${requestId}`,
    )
    expect(harness.authorizationCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        redirectUri: 'https://assistant.example/oauth/callback',
        resource: 'https://api.abroad.finance/mcp',
        scopes: [PartnerAiScope.ACCOUNT_READ, PartnerAiScope.TRANSACTIONS_READ],
        stateCiphertext: 'encrypted-state',
      }),
    })
    expect(JSON.stringify(harness.authorizationCreate.mock.calls)).not.toContain('opaque-client-state')
    expect(portalUrl).not.toContain('opaque-client-state')
    expect(portalUrl).not.toContain('assistant.example')
  })

  it('reuses an identical pending authorization request and rejects a wrong MCP audience', async () => {
    const harness = buildHarness()
    harness.authorizationFindUnique.mockResolvedValueOnce(authorizationRequest())
    const input = {
      clientId: 'abroad_mcp_client_public',
      codeChallenge: 'a'.repeat(43),
      redirectUri: 'https://assistant.example/oauth/callback',
      resource: 'https://api.abroad.finance/mcp',
      scopes: ['account:read'] as const,
      state: 'opaque-client-state',
    }

    await expect(harness.service.createAuthorizationRequest(
      { ...input, scopes: [...input.scopes] },
      '203.0.113.20',
    )).resolves.toBe(
      'https://app.abroad.finance/partner/integration/ai/authorize?request=11111111-1111-4111-8111-111111111111',
    )
    expect(harness.authorizationCreate).not.toHaveBeenCalled()
    expect(harness.encrypt).not.toHaveBeenCalled()

    await expect(harness.service.createAuthorizationRequest({
      ...input,
      resource: 'https://api.abroad.finance/not-mcp',
      scopes: [...input.scopes],
    }, '203.0.113.20')).rejects.toEqual(new PartnerAiPortalError(
      'UNSUPPORTED_CLIENT',
      'The requested MCP resource is not supported',
    ))
    expect(harness.assertAuthorizationAllowed).toHaveBeenCalledTimes(1)
  })

  it('projects plain-language consent state without exposing redirects, encrypted state, or codes', async () => {
    const harness = buildHarness()
    harness.authorizationFindUnique.mockResolvedValueOnce(authorizationRequest({
      scopes: [PartnerAiScope.ACCOUNT_READ, PartnerAiScope.WEBHOOKS_READ],
    }))

    const result = await harness.service.getAuthorizationRequest(principal({
      mfaEnabled: false,
      mfaVerified: false,
    }), '11111111-1111-4111-8111-111111111111')

    expect(result).toEqual(expect.objectContaining({
      client: {
        destinationHost: 'assistant.example',
        name: 'Operations Assistant',
        verified: false,
      },
      organizationName: 'Atlas Payments',
      state: 'MFA_REQUIRED',
    }))
    expect(result.permissions).toEqual([
      expect.objectContaining({ scope: 'account:read' }),
      expect.objectContaining({ scope: 'webhooks:read' }),
    ])
    const serialized = JSON.stringify(result)
    expect(serialized).not.toContain('encrypted-state')
    expect(serialized).not.toContain('/oauth/callback')
    expect(serialized).not.toContain('codeHash')

    harness.authorizationFindUnique.mockResolvedValueOnce(authorizationRequest())
    await expect(harness.service.getAuthorizationRequest(
      principal({ role: PartnerPortalRole.MEMBER }),
      '11111111-1111-4111-8111-111111111111',
    )).resolves.toEqual(expect.objectContaining({ state: 'ADMIN_REQUIRED' }))
  })

  it('requires current MFA before approving webhook diagnostics', async () => {
    const harness = buildHarness()
    harness.authorizationFindUnique.mockResolvedValueOnce(authorizationRequest({
      scopes: [PartnerAiScope.ACCOUNT_READ, PartnerAiScope.WEBHOOKS_READ],
    }))

    await expect(harness.service.approve(principal({
      mfaEnabled: false,
      mfaVerified: false,
    }), '11111111-1111-4111-8111-111111111111')).rejects.toEqual(
      new PartnerAiPortalError('MFA_REQUIRED', 'Verify MFA before approving webhook diagnostics'),
    )
    expect(harness.transaction).not.toHaveBeenCalled()
  })

  it('atomically replaces an active grant and persists only a hash of the single-use code', async () => {
    const harness = buildHarness()

    const result = await harness.service.approve(
      principal(),
      '11111111-1111-4111-8111-111111111111',
    )

    expect(harness.connectionUpdateMany).toHaveBeenCalledWith({
      data: { activeGrantKey: null, revokedAt: now },
      where: { activeGrantKey: expect.any(String) },
    })
    expect(harness.connectionCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        activeGrantKey: expect.any(String),
        authorizedByUserId: 'portal-user-1',
        partnerId: 'partner-1',
      }),
    })
    const callbackUrl = new URL(result.returnToClientUrl)
    const returnedCode = callbackUrl.searchParams.get('code')
    expect(returnedCode).toMatch(/^abroad_mcp_code_[A-Za-z0-9_-]{43}$/u)
    expect(callbackUrl.searchParams.get('state')).toBe('opaque-client-state')
    const persistedResolution = harness.authorizationUpdate.mock.calls[0][0]
    expect(persistedResolution).toEqual(expect.objectContaining({
      data: expect.objectContaining({
        codeHash: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/u),
        outcome: PartnerAiAuthorizationOutcome.APPROVED,
        partnerId: 'partner-1',
      }),
    }))
    expect(JSON.stringify(persistedResolution)).not.toContain(returnedCode)
    expect(JSON.stringify(persistedResolution)).not.toContain('opaque-client-state')
    expect(harness.auditRecord).toHaveBeenCalledWith(expect.objectContaining({
      action: 'AI_CONNECTION_AUTHORIZED',
      metadata: {
        clientKind: PartnerAiClientKind.GENERIC,
        outcome: 'APPROVED',
        scopes: ['account:read', 'transactions:read'],
      },
      partnerId: 'partner-1',
    }), expect.anything())
    expect(JSON.stringify(harness.auditRecord.mock.calls)).not.toContain('Operations Assistant')
  })

  it('denies once, returns a bounded OAuth error redirect, and records no connection', async () => {
    const harness = buildHarness()

    const result = await harness.service.deny(
      principal(),
      '11111111-1111-4111-8111-111111111111',
    )

    const callbackUrl = new URL(result.returnToClientUrl)
    expect(callbackUrl.searchParams.get('error')).toBe('access_denied')
    expect(callbackUrl.searchParams.get('state')).toBe('opaque-client-state')
    expect(harness.connectionCreate).not.toHaveBeenCalled()
    expect(harness.auditRecord).toHaveBeenCalledWith(expect.objectContaining({
      action: 'AI_CONNECTION_DENIED',
      metadata: expect.objectContaining({ outcome: 'DENIED' }),
    }), expect.anything())
  })

  it('has one winner when concurrent approval already claimed the request', async () => {
    const harness = buildHarness()
    harness.authorizationUpdateMany.mockResolvedValueOnce({ count: 0 })

    await expect(harness.service.approve(
      principal(),
      '11111111-1111-4111-8111-111111111111',
    )).rejects.toEqual(new PartnerAiPortalError(
      'ALREADY_RESOLVED',
      'This authorization request was already completed',
    ))
    expect(harness.connectionCreate).not.toHaveBeenCalled()
    expect(harness.auditRecord).not.toHaveBeenCalled()
  })
})

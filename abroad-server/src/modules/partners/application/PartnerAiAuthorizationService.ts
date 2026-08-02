import { PartnerAiAuthorizationOutcome, PartnerAiClientKind, Prisma } from '@prisma/client'
import { inject, injectable } from 'inversify'
import { randomUUID } from 'node:crypto'

import type { PartnerAiAuthorizationInput, PartnerAiClientRegistrationInput } from './PartnerAiOAuthTypes'

import { TYPES } from '../../../app/container/types'
import { IDatabaseClientProvider } from '../../../platform/persistence/IDatabaseClientProvider'
import { PartnerAiAbuseProtectionService } from './PartnerAiAbuseProtectionService'
import {
  PARTNER_AI_ACCESS_TOKEN_TTL_MS,
  PARTNER_AI_AUTHORIZATION_CODE_TTL_MS,
  PARTNER_AI_AUTHORIZATION_REQUEST_TTL_MS,
  PARTNER_AI_MCP_RESOURCE_URL,
  PARTNER_AI_PORTAL_URL,
  PARTNER_AI_REFRESH_TOKEN_TTL_MS,
} from './partnerAiConfiguration'
import { buildPartnerAiFingerprint, generatePartnerAiCredential, hashPartnerAiCredential } from './partnerAiCredentials'
import { PartnerAiPortalError } from './PartnerAiErrors'
import {
  formatPartnerAiScope,
  partnerAiPermissionDescriptions,
  PartnerAiScopeName,
  requiresPartnerAiMfa,
  toDatabasePartnerAiScopes,
  toPartnerAiScopeNames,
} from './partnerAiScopes'
import { PartnerPortalAuditService } from './PartnerPortalAuditService'
import { PartnerPortalSecretEnvelopeService } from './PartnerPortalSecretEnvelopeService'
import { PartnerPortalPrincipal } from './PartnerPortalSessionService'

const STATE_ENVELOPE_CONTEXT_PREFIX = 'partner-ai-oauth-state'

export type PartnerAiAuthorizationRequestDto = {
  alreadyConnected: boolean
  client: {
    destinationHost: string
    name: string
    verified: boolean
  }
  expiresAt: Date
  organizationName: string
  permissions: Array<{
    description: string
    scope: PartnerAiScopeName
  }>
  requestId: string
  state: PartnerAiAuthorizationState
}

export type PartnerAiAuthorizationResolution = {
  clientName: string
  destinationHost: string
  returnToClientUrl: string
}

type PartnerAiAuthorizationState
  = | 'ADMIN_REQUIRED'
    | 'APPROVED'
    | 'DENIED'
    | 'EXPIRED'
    | 'MFA_REQUIRED'
    | 'READY'
    | 'UNSUPPORTED_CLIENT'

type PartnerAiClientRegistrationResult = {
  client_id: string
  client_id_issued_at: number
  client_name: string
  client_uri?: string
  grant_types: ['authorization_code', 'refresh_token']
  redirect_uris: string[]
  response_types: ['code']
  scope: string
  token_endpoint_auth_method: 'none'
}

@injectable()
export class PartnerAiAuthorizationService {
  public constructor(
    @inject(TYPES.IDatabaseClientProvider)
    private readonly databaseClientProvider: IDatabaseClientProvider,
    @inject(PartnerPortalSecretEnvelopeService)
    private readonly envelopeService: PartnerPortalSecretEnvelopeService,
    @inject(PartnerPortalAuditService)
    private readonly auditService: PartnerPortalAuditService,
    @inject(PartnerAiAbuseProtectionService)
    private readonly abuseProtectionService: PartnerAiAbuseProtectionService,
  ) {}

  public async approve(
    principal: PartnerPortalPrincipal,
    requestId: string,
  ): Promise<PartnerAiAuthorizationResolution> {
    this.assertAdministrator(principal)
    const prismaClient = await this.databaseClientProvider.getClient()
    const authorizationRequest = await prismaClient.partnerAiAuthorizationRequest.findUnique({
      include: { oauthClient: true },
      where: { id: requestId },
    })
    this.assertRequestCanResolve(authorizationRequest)
    if (authorizationRequest.oauthClient.disabledAt) {
      throw new PartnerAiPortalError('UNSUPPORTED_CLIENT', 'This AI client is no longer supported')
    }
    const scopes = toPartnerAiScopeNames(authorizationRequest.scopes)
    if (requiresPartnerAiMfa(scopes) && (!principal.mfaEnabled || !principal.mfaVerified)) {
      throw new PartnerAiPortalError('MFA_REQUIRED', 'Verify MFA before approving webhook diagnostics')
    }

    const state = await this.decryptState(
      authorizationRequest.id,
      authorizationRequest.stateCiphertext,
    )
    const now = new Date()
    const authorizationCode = generatePartnerAiCredential('abroad_mcp_code_')
    const connectionId = randomUUID()
    const activeGrantKey = buildPartnerAiFingerprint([
      principal.partner.id,
      authorizationRequest.oauthClientId,
    ])
    const connectionExpiresAt = new Date(now.getTime() + (
      scopes.includes('offline_access')
        ? PARTNER_AI_REFRESH_TOKEN_TTL_MS
        : PARTNER_AI_ACCESS_TOKEN_TTL_MS
    ))

    await prismaClient.$transaction(async (transaction) => {
      const claim = await transaction.partnerAiAuthorizationRequest.updateMany({
        data: { resolvedAt: now },
        where: {
          expiresAt: { gt: now },
          id: authorizationRequest.id,
          outcome: PartnerAiAuthorizationOutcome.PENDING,
          resolvedAt: null,
        },
      })
      if (claim.count !== 1) {
        throw new PartnerAiPortalError('ALREADY_RESOLVED', 'This authorization request was already completed')
      }

      await transaction.partnerAiConnection.updateMany({
        data: { activeGrantKey: null, revokedAt: now },
        where: { activeGrantKey },
      })
      await transaction.partnerAiConnection.create({
        data: {
          activeGrantKey,
          authorizedAt: now,
          authorizedByUserId: principal.userId,
          expiresAt: connectionExpiresAt,
          id: connectionId,
          oauthClientId: authorizationRequest.oauthClientId,
          partnerId: principal.partner.id,
          scopes: authorizationRequest.scopes,
        },
      })
      await transaction.partnerAiAuthorizationRequest.update({
        data: {
          actorUserId: principal.userId,
          codeExpiresAt: new Date(now.getTime() + PARTNER_AI_AUTHORIZATION_CODE_TTL_MS),
          codeHash: hashPartnerAiCredential(authorizationCode),
          connectionId,
          outcome: PartnerAiAuthorizationOutcome.APPROVED,
          partnerId: principal.partner.id,
        },
        where: { id: authorizationRequest.id },
      })
      await this.auditService.record({
        action: 'AI_CONNECTION_AUTHORIZED',
        actorUserId: principal.userId,
        metadata: {
          clientKind: authorizationRequest.oauthClient.verifiedKind,
          outcome: 'APPROVED',
          scopes,
        },
        partnerId: principal.partner.id,
        resourceId: connectionId,
        resourceType: 'AI_CONNECTION',
      }, transaction)
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })

    return {
      clientName: authorizationRequest.oauthClient.clientName,
      destinationHost: this.destinationHost(authorizationRequest.redirectUri),
      returnToClientUrl: this.buildClientReturnUrl(
        authorizationRequest.redirectUri,
        { code: authorizationCode, state },
      ),
    }
  }

  public async createAuthorizationRequest(
    input: PartnerAiAuthorizationInput,
    clientIp: string,
  ): Promise<string> {
    if (input.resource !== PARTNER_AI_MCP_RESOURCE_URL) {
      throw new PartnerAiPortalError('UNSUPPORTED_CLIENT', 'The requested MCP resource is not supported')
    }
    await this.abuseProtectionService.assertAuthorizationAllowed(clientIp, input.clientId)
    const prismaClient = await this.databaseClientProvider.getClient()
    const oauthClient = await prismaClient.partnerAiOAuthClient.findUnique({
      where: { clientId: input.clientId },
    })
    if (
      !oauthClient
      || oauthClient.disabledAt
      || !oauthClient.redirectUris.includes(input.redirectUri)
    ) {
      throw new PartnerAiPortalError('UNSUPPORTED_CLIENT', 'The AI client or redirect destination is not supported')
    }
    const requestedDatabaseScopes = toDatabasePartnerAiScopes(input.scopes)
    if (requestedDatabaseScopes.some(scope => !oauthClient.allowedScopes.includes(scope))) {
      throw new PartnerAiPortalError('UNSUPPORTED_CLIENT', 'The AI client requested an unregistered permission')
    }

    const fingerprintHash = buildPartnerAiFingerprint([
      oauthClient.id,
      input.redirectUri,
      input.codeChallenge,
      input.resource,
      formatPartnerAiScope(input.scopes),
      input.state ?? '',
    ])
    const existing = await prismaClient.partnerAiAuthorizationRequest.findUnique({
      where: { fingerprintHash },
    })
    if (existing) return this.buildPortalUrl(existing.id)

    const requestId = randomUUID()
    const stateCiphertext = input.state
      ? await this.envelopeService.encrypt(input.state, this.stateContext(requestId))
      : null
    try {
      await prismaClient.partnerAiAuthorizationRequest.create({
        data: {
          codeChallenge: input.codeChallenge,
          expiresAt: new Date(Date.now() + PARTNER_AI_AUTHORIZATION_REQUEST_TTL_MS),
          fingerprintHash,
          id: requestId,
          oauthClientId: oauthClient.id,
          redirectUri: input.redirectUri,
          resource: input.resource,
          scopes: requestedDatabaseScopes,
          stateCiphertext,
        },
      })
      await prismaClient.partnerAiOAuthClient.update({
        data: { lastUsedAt: new Date() },
        where: { id: oauthClient.id },
      })
      return this.buildPortalUrl(requestId)
    }
    catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const raced = await prismaClient.partnerAiAuthorizationRequest.findUnique({
          where: { fingerprintHash },
        })
        if (raced) return this.buildPortalUrl(raced.id)
      }
      throw error
    }
  }

  public async deny(
    principal: PartnerPortalPrincipal,
    requestId: string,
  ): Promise<PartnerAiAuthorizationResolution> {
    this.assertAdministrator(principal)
    const prismaClient = await this.databaseClientProvider.getClient()
    const authorizationRequest = await prismaClient.partnerAiAuthorizationRequest.findUnique({
      include: { oauthClient: true },
      where: { id: requestId },
    })
    this.assertRequestCanResolve(authorizationRequest)
    const state = await this.decryptState(
      authorizationRequest.id,
      authorizationRequest.stateCiphertext,
    )
    const now = new Date()
    await prismaClient.$transaction(async (transaction) => {
      const result = await transaction.partnerAiAuthorizationRequest.updateMany({
        data: {
          actorUserId: principal.userId,
          outcome: PartnerAiAuthorizationOutcome.DENIED,
          partnerId: principal.partner.id,
          resolvedAt: now,
        },
        where: {
          expiresAt: { gt: now },
          id: authorizationRequest.id,
          outcome: PartnerAiAuthorizationOutcome.PENDING,
          resolvedAt: null,
        },
      })
      if (result.count !== 1) {
        throw new PartnerAiPortalError('ALREADY_RESOLVED', 'This authorization request was already completed')
      }
      await this.auditService.record({
        action: 'AI_CONNECTION_DENIED',
        actorUserId: principal.userId,
        metadata: {
          clientKind: authorizationRequest.oauthClient.verifiedKind,
          outcome: 'DENIED',
          scopes: toPartnerAiScopeNames(authorizationRequest.scopes),
        },
        partnerId: principal.partner.id,
        resourceId: authorizationRequest.id,
        resourceType: 'AI_AUTHORIZATION_REQUEST',
      }, transaction)
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })

    return {
      clientName: authorizationRequest.oauthClient.clientName,
      destinationHost: this.destinationHost(authorizationRequest.redirectUri),
      returnToClientUrl: this.buildClientReturnUrl(authorizationRequest.redirectUri, {
        error: 'access_denied',
        error_description: 'The Abroad administrator denied this connection',
        state,
      }),
    }
  }

  public async getAuthorizationRequest(
    principal: PartnerPortalPrincipal,
    requestId: string,
  ): Promise<PartnerAiAuthorizationRequestDto> {
    const prismaClient = await this.databaseClientProvider.getClient()
    const authorizationRequest = await prismaClient.partnerAiAuthorizationRequest.findUnique({
      include: { oauthClient: true },
      where: { id: requestId },
    })
    if (!authorizationRequest) {
      throw new PartnerAiPortalError('NOT_FOUND', 'Authorization request not found')
    }
    const now = new Date()
    const expired = authorizationRequest.expiresAt <= now
    if (expired && authorizationRequest.outcome === PartnerAiAuthorizationOutcome.PENDING) {
      await prismaClient.partnerAiAuthorizationRequest.updateMany({
        data: { outcome: PartnerAiAuthorizationOutcome.EXPIRED, resolvedAt: now },
        where: {
          id: authorizationRequest.id,
          outcome: PartnerAiAuthorizationOutcome.PENDING,
        },
      })
    }
    const scopes = toPartnerAiScopeNames(authorizationRequest.scopes)
    const alreadyConnected = await prismaClient.partnerAiConnection.count({
      where: {
        activeGrantKey: { not: null },
        expiresAt: { gt: now },
        failedAt: null,
        oauthClientId: authorizationRequest.oauthClientId,
        partnerId: principal.partner.id,
        revokedAt: null,
      },
    }) > 0

    return {
      alreadyConnected,
      client: {
        destinationHost: this.destinationHost(authorizationRequest.redirectUri),
        name: authorizationRequest.oauthClient.clientName,
        verified: authorizationRequest.oauthClient.verifiedKind !== PartnerAiClientKind.GENERIC,
      },
      expiresAt: authorizationRequest.expiresAt,
      organizationName: principal.partner.name,
      permissions: scopes.map(scope => ({
        description: partnerAiPermissionDescriptions[scope],
        scope,
      })),
      requestId: authorizationRequest.id,
      state: this.resolveAuthorizationState({
        clientDisabled: Boolean(authorizationRequest.oauthClient.disabledAt),
        expired,
        outcome: authorizationRequest.outcome,
        principal,
        scopes,
      }),
    }
  }

  public async registerClient(
    input: PartnerAiClientRegistrationInput,
    clientIp: string,
  ): Promise<PartnerAiClientRegistrationResult> {
    await this.abuseProtectionService.assertRegistrationAllowed(clientIp)
    const prismaClient = await this.databaseClientProvider.getClient()
    const clientId = generatePartnerAiCredential('abroad_mcp_client_')
    const created = await prismaClient.partnerAiOAuthClient.create({
      data: {
        allowedScopes: toDatabasePartnerAiScopes(input.scopes),
        clientId,
        clientName: input.clientName,
        clientUri: input.clientUri,
        redirectUris: input.redirectUris.map(redirect => redirect.uri),
        verifiedKind: PartnerAiClientKind.GENERIC,
      },
    })
    return {
      client_id: created.clientId,
      client_id_issued_at: Math.floor(created.createdAt.getTime() / 1_000),
      client_name: created.clientName,
      client_uri: created.clientUri ?? undefined,
      grant_types: ['authorization_code', 'refresh_token'],
      redirect_uris: created.redirectUris,
      response_types: ['code'],
      scope: formatPartnerAiScope(toPartnerAiScopeNames(created.allowedScopes)),
      token_endpoint_auth_method: 'none',
    }
  }

  private assertAdministrator(principal: PartnerPortalPrincipal): void {
    if (principal.role !== 'ADMIN') {
      throw new PartnerAiPortalError('ADMIN_REQUIRED', 'An Abroad administrator must approve this connection')
    }
  }

  private assertRequestCanResolve<T extends {
    expiresAt: Date
    outcome: PartnerAiAuthorizationOutcome
    resolvedAt: Date | null
  }>(request: null | T): asserts request is T {
    if (!request) throw new PartnerAiPortalError('NOT_FOUND', 'Authorization request not found')
    if (request.expiresAt <= new Date()) {
      throw new PartnerAiPortalError('REQUEST_EXPIRED', 'This authorization request has expired')
    }
    if (request.outcome !== PartnerAiAuthorizationOutcome.PENDING || request.resolvedAt) {
      throw new PartnerAiPortalError('ALREADY_RESOLVED', 'This authorization request was already completed')
    }
  }

  private buildClientReturnUrl(
    redirectUri: string,
    parameters: Readonly<Record<string, null | string>>,
  ): string {
    const url = new URL(redirectUri)
    Object.entries(parameters).forEach(([key, value]) => {
      if (value !== null) url.searchParams.set(key, value)
    })
    return url.toString()
  }

  private buildPortalUrl(requestId: string): string {
    const url = new URL(PARTNER_AI_PORTAL_URL)
    url.searchParams.set('request', requestId)
    return url.toString()
  }

  private async decryptState(requestId: string, stateCiphertext: null | string): Promise<null | string> {
    if (!stateCiphertext) return null
    return this.envelopeService.decrypt(stateCiphertext, this.stateContext(requestId))
  }

  private destinationHost(redirectUri: string): string {
    const url = new URL(redirectUri)
    return url.protocol === 'http:' ? 'This device' : url.hostname
  }

  private resolveAuthorizationState(input: {
    clientDisabled: boolean
    expired: boolean
    outcome: PartnerAiAuthorizationOutcome
    principal: PartnerPortalPrincipal
    scopes: readonly PartnerAiScopeName[]
  }): PartnerAiAuthorizationState {
    if (input.clientDisabled) return 'UNSUPPORTED_CLIENT'
    if (input.outcome === PartnerAiAuthorizationOutcome.APPROVED) return 'APPROVED'
    if (input.outcome === PartnerAiAuthorizationOutcome.DENIED) return 'DENIED'
    if (input.expired || input.outcome === PartnerAiAuthorizationOutcome.EXPIRED) return 'EXPIRED'
    if (input.principal.role !== 'ADMIN') return 'ADMIN_REQUIRED'
    if (requiresPartnerAiMfa(input.scopes) && (!input.principal.mfaEnabled || !input.principal.mfaVerified)) {
      return 'MFA_REQUIRED'
    }
    return 'READY'
  }

  private stateContext(requestId: string): string {
    return `${STATE_ENVELOPE_CONTEXT_PREFIX}:${requestId}`
  }
}

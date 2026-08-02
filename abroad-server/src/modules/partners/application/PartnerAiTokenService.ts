import { PartnerAiAuthorizationOutcome, Prisma } from '@prisma/client'
import { inject, injectable } from 'inversify'
import { randomUUID } from 'node:crypto'

import type { PartnerAiAuthorizationCodeGrant, PartnerAiRefreshTokenGrant, PartnerAiTokenGrant, PartnerAiTokenRevocation } from './PartnerAiOAuthTypes'

import { TYPES } from '../../../app/container/types'
import { IDatabaseClientProvider } from '../../../platform/persistence/IDatabaseClientProvider'
import { PartnerAiAbuseProtectionService } from './PartnerAiAbuseProtectionService'
import { PARTNER_AI_ACCESS_TOKEN_TTL_MS, PARTNER_AI_LAST_USED_WRITE_INTERVAL_MS, PARTNER_AI_MCP_RESOURCE_URL, PARTNER_AI_REFRESH_TOKEN_TTL_MS } from './partnerAiConfiguration'
import { generatePartnerAiCredential, hashPartnerAiCredential, verifyPartnerAiPkce } from './partnerAiCredentials'
import { PartnerAiOAuthError } from './PartnerAiErrors'
import {
  formatPartnerAiScope,
  parsePartnerAiScopes,
  PartnerAiScopeName,
  toDatabasePartnerAiScopes,
  toPartnerAiScopeNames,
} from './partnerAiScopes'
import { PartnerPortalAuditService } from './PartnerPortalAuditService'

export type PartnerAiAccessPrincipal = {
  accessTokenId: string
  clientId: string
  clientName: string
  connectionExpiresAt: Date
  connectionId: string
  partnerId: string
  partnerName: string
  scopes: PartnerAiScopeName[]
  tokenExpiresAt: Date
}

type IssuedCredentials = {
  accessToken: string
  accessTokenExpiresAt: Date
  refreshToken: null | string
  scopes: PartnerAiScopeName[]
}

type PartnerAiTokenResponse = {
  access_token: string
  expires_in: number
  refresh_token?: string
  scope: string
  token_type: 'Bearer'
}

@injectable()
export class PartnerAiTokenService {
  public constructor(
    @inject(TYPES.IDatabaseClientProvider)
    private readonly databaseClientProvider: IDatabaseClientProvider,
    @inject(PartnerPortalAuditService)
    private readonly auditService: PartnerPortalAuditService,
    @inject(PartnerAiAbuseProtectionService)
    private readonly abuseProtectionService: PartnerAiAbuseProtectionService,
  ) {}

  public async authenticateAccessToken(accessToken: string): Promise<PartnerAiAccessPrincipal> {
    const prismaClient = await this.databaseClientProvider.getClient()
    const token = await prismaClient.partnerAiAccessToken.findUnique({
      include: {
        connection: {
          include: { oauthClient: true, partner: true },
        },
      },
      where: { tokenHash: hashPartnerAiCredential(accessToken) },
    })
    const now = new Date()
    if (
      !token
      || token.revokedAt
      || token.expiresAt <= now
      || token.connection.revokedAt
      || token.connection.failedAt
      || token.connection.expiresAt <= now
      || !token.connection.activeGrantKey
      || token.connection.oauthClient.disabledAt
    ) {
      throw new PartnerAiOAuthError('invalid_grant', 'The MCP access token is invalid or expired')
    }

    const writeThreshold = new Date(now.getTime() - PARTNER_AI_LAST_USED_WRITE_INTERVAL_MS)
    await Promise.all([
      prismaClient.partnerAiAccessToken.updateMany({
        data: { lastUsedAt: now },
        where: {
          id: token.id,
          OR: [{ lastUsedAt: null }, { lastUsedAt: { lt: writeThreshold } }],
        },
      }),
      prismaClient.partnerAiConnection.updateMany({
        data: { lastUsedAt: now },
        where: {
          id: token.connectionId,
          OR: [{ lastUsedAt: null }, { lastUsedAt: { lt: writeThreshold } }],
        },
      }),
      prismaClient.partnerAiOAuthClient.updateMany({
        data: { lastUsedAt: now },
        where: {
          id: token.connection.oauthClientId,
          OR: [{ lastUsedAt: null }, { lastUsedAt: { lt: writeThreshold } }],
        },
      }),
    ])

    return {
      accessTokenId: token.id,
      clientId: token.connection.oauthClient.clientId,
      clientName: token.connection.oauthClient.clientName,
      connectionExpiresAt: token.connection.expiresAt,
      connectionId: token.connectionId,
      partnerId: token.connection.partnerId,
      partnerName: token.connection.partner.name,
      scopes: toPartnerAiScopeNames(token.scopes),
      tokenExpiresAt: token.expiresAt,
    }
  }

  public async exchange(grant: PartnerAiTokenGrant, clientIp: string): Promise<PartnerAiTokenResponse> {
    await this.abuseProtectionService.assertTokenRequestAllowed(clientIp, grant.client_id)
    const issued = grant.grant_type === 'authorization_code'
      ? await this.exchangeAuthorizationCode(grant)
      : await this.rotateRefreshToken(grant)
    return {
      access_token: issued.accessToken,
      expires_in: Math.max(1, Math.floor((issued.accessTokenExpiresAt.getTime() - Date.now()) / 1_000)),
      refresh_token: issued.refreshToken ?? undefined,
      scope: formatPartnerAiScope(issued.scopes),
      token_type: 'Bearer',
    }
  }

  public async revoke(input: PartnerAiTokenRevocation): Promise<void> {
    const prismaClient = await this.databaseClientProvider.getClient()
    const tokenHash = hashPartnerAiCredential(input.token)
    const [accessToken, refreshToken] = await Promise.all([
      prismaClient.partnerAiAccessToken.findUnique({
        include: { connection: { include: { oauthClient: true } } },
        where: { tokenHash },
      }),
      prismaClient.partnerAiRefreshToken.findUnique({
        include: { connection: { include: { oauthClient: true } } },
        where: { tokenHash },
      }),
    ])
    const token = accessToken ?? refreshToken
    if (!token || token.connection.oauthClient.clientId !== input.client_id) return
    const now = new Date()
    await prismaClient.$transaction(async (transaction) => {
      const changed = await transaction.partnerAiConnection.updateMany({
        data: { activeGrantKey: null, revokedAt: now },
        where: { id: token.connectionId, revokedAt: null },
      })
      await Promise.all([
        transaction.partnerAiAccessToken.updateMany({
          data: { revokedAt: now },
          where: { connectionId: token.connectionId, revokedAt: null },
        }),
        transaction.partnerAiRefreshToken.updateMany({
          data: { revokedAt: now },
          where: { connectionId: token.connectionId, revokedAt: null },
        }),
      ])
      if (changed.count === 1) {
        await this.auditService.record({
          action: 'AI_CONNECTION_REVOKED',
          metadata: {
            clientKind: token.connection.oauthClient.verifiedKind,
            outcome: 'REVOKED',
            source: 'OAUTH_CLIENT',
          },
          partnerId: token.connection.partnerId,
          resourceId: token.connectionId,
          resourceType: 'AI_CONNECTION',
        }, transaction)
      }
    })
  }

  private async exchangeAuthorizationCode(
    grant: PartnerAiAuthorizationCodeGrant,
  ): Promise<IssuedCredentials> {
    if (grant.resource !== PARTNER_AI_MCP_RESOURCE_URL) throw this.invalidGrant()
    const prismaClient = await this.databaseClientProvider.getClient()
    const authorizationRequest = await prismaClient.partnerAiAuthorizationRequest.findUnique({
      include: { connection: true, oauthClient: true },
      where: { codeHash: hashPartnerAiCredential(grant.code) },
    })
    const now = new Date()
    if (
      !authorizationRequest
      || !authorizationRequest.connection
      || authorizationRequest.outcome !== PartnerAiAuthorizationOutcome.APPROVED
      || authorizationRequest.codeConsumedAt
      || !authorizationRequest.codeExpiresAt
      || authorizationRequest.codeExpiresAt <= now
      || authorizationRequest.oauthClient.clientId !== grant.client_id
      || authorizationRequest.redirectUri !== grant.redirect_uri
      || authorizationRequest.resource !== grant.resource
      || authorizationRequest.oauthClient.disabledAt
      || authorizationRequest.connection.revokedAt
      || authorizationRequest.connection.failedAt
      || authorizationRequest.connection.expiresAt <= now
      || !verifyPartnerAiPkce(grant.code_verifier, authorizationRequest.codeChallenge)
    ) {
      throw this.invalidGrant()
    }

    const connection = authorizationRequest.connection
    const scopes = toPartnerAiScopeNames(authorizationRequest.scopes)
    const accessToken = generatePartnerAiCredential('abroad_mcp_at_')
    const refreshToken = scopes.includes('offline_access')
      ? generatePartnerAiCredential('abroad_mcp_rt_')
      : null
    const accessTokenExpiresAt = new Date(Math.min(
      now.getTime() + PARTNER_AI_ACCESS_TOKEN_TTL_MS,
      connection.expiresAt.getTime(),
    ))

    await prismaClient.$transaction(async (transaction) => {
      const claimed = await transaction.partnerAiAuthorizationRequest.updateMany({
        data: { codeConsumedAt: now },
        where: {
          codeConsumedAt: null,
          codeExpiresAt: { gt: now },
          id: authorizationRequest.id,
        },
      })
      if (claimed.count !== 1) throw this.invalidGrant()
      await transaction.partnerAiAccessToken.create({
        data: {
          connectionId: connection.id,
          expiresAt: accessTokenExpiresAt,
          scopes: authorizationRequest.scopes,
          tokenHash: hashPartnerAiCredential(accessToken),
        },
      })
      if (refreshToken) {
        await transaction.partnerAiRefreshToken.create({
          data: {
            connectionId: connection.id,
            expiresAt: new Date(Math.min(
              now.getTime() + PARTNER_AI_REFRESH_TOKEN_TTL_MS,
              connection.expiresAt.getTime(),
            )),
            familyId: randomUUID(),
            scopes: authorizationRequest.scopes,
            tokenHash: hashPartnerAiCredential(refreshToken),
          },
        })
      }
      await transaction.partnerAiOAuthClient.update({
        data: { lastUsedAt: now },
        where: { id: authorizationRequest.oauthClientId },
      })
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })

    return { accessToken, accessTokenExpiresAt, refreshToken, scopes }
  }

  private invalidGrant(): PartnerAiOAuthError {
    return new PartnerAiOAuthError('invalid_grant', 'The authorization grant is invalid or expired')
  }

  private async markRefreshReuse(input: {
    clientKind: string
    connectionId: string
    familyId: string
    partnerId: string
  }): Promise<void> {
    const prismaClient = await this.databaseClientProvider.getClient()
    const now = new Date()
    await prismaClient.$transaction(async (transaction) => {
      const changed = await transaction.partnerAiConnection.updateMany({
        data: {
          activeGrantKey: null,
          failedAt: now,
          failureCode: 'REFRESH_TOKEN_REUSE',
        },
        where: {
          activeGrantKey: { not: null },
          expiresAt: { gt: now },
          failedAt: null,
          id: input.connectionId,
          revokedAt: null,
        },
      })
      await Promise.all([
        transaction.partnerAiAccessToken.updateMany({
          data: { revokedAt: now },
          where: { connectionId: input.connectionId, revokedAt: null },
        }),
        transaction.partnerAiRefreshToken.updateMany({
          data: { revokedAt: now },
          where: { familyId: input.familyId, revokedAt: null },
        }),
      ])
      if (changed.count === 1) {
        await this.auditService.record({
          action: 'AI_CONNECTION_SECURITY_FAILED',
          metadata: {
            clientKind: input.clientKind,
            outcome: 'FAILED',
            reason: 'REFRESH_TOKEN_REUSE',
          },
          partnerId: input.partnerId,
          resourceId: input.connectionId,
          resourceType: 'AI_CONNECTION',
        }, transaction)
      }
    })
  }

  private async rotateRefreshToken(grant: PartnerAiRefreshTokenGrant): Promise<IssuedCredentials> {
    if (grant.resource !== PARTNER_AI_MCP_RESOURCE_URL) throw this.invalidGrant()
    const prismaClient = await this.databaseClientProvider.getClient()
    const refreshToken = await prismaClient.partnerAiRefreshToken.findUnique({
      include: { connection: { include: { oauthClient: true } } },
      where: { tokenHash: hashPartnerAiCredential(grant.refresh_token) },
    })
    const now = new Date()
    if (!refreshToken || refreshToken.connection.oauthClient.clientId !== grant.client_id) {
      throw this.invalidGrant()
    }
    const reuseContext = {
      clientKind: refreshToken.connection.oauthClient.verifiedKind,
      connectionId: refreshToken.connectionId,
      familyId: refreshToken.familyId,
      partnerId: refreshToken.connection.partnerId,
    }
    if (
      refreshToken.revokedAt
      || refreshToken.expiresAt <= now
      || refreshToken.connection.revokedAt
      || refreshToken.connection.failedAt
      || refreshToken.connection.expiresAt <= now
      || refreshToken.connection.oauthClient.disabledAt
      || !refreshToken.connection.activeGrantKey
    ) {
      throw this.invalidGrant()
    }
    if (refreshToken.consumedAt) {
      await this.markRefreshReuse(reuseContext)
      throw this.invalidGrant()
    }

    const grantedScopes = toPartnerAiScopeNames(refreshToken.scopes)
    const requestedScopes = grant.scope ? parsePartnerAiScopes(grant.scope) : grantedScopes
    if (!requestedScopes || requestedScopes.some(scope => !grantedScopes.includes(scope))) {
      throw new PartnerAiOAuthError('invalid_scope', 'The requested refresh scope is invalid')
    }
    const databaseScopes = toDatabasePartnerAiScopes(requestedScopes)
    const nextAccessToken = generatePartnerAiCredential('abroad_mcp_at_')
    const nextRefreshToken = generatePartnerAiCredential('abroad_mcp_rt_')
    const accessTokenExpiresAt = new Date(Math.min(
      now.getTime() + PARTNER_AI_ACCESS_TOKEN_TTL_MS,
      refreshToken.connection.expiresAt.getTime(),
    ))
    const refreshTokenExpiresAt = new Date(Math.min(
      now.getTime() + PARTNER_AI_REFRESH_TOKEN_TTL_MS,
      refreshToken.connection.expiresAt.getTime(),
    ))
    let reusedDuringRotation = false

    await prismaClient.$transaction(async (transaction) => {
      const claimed = await transaction.partnerAiRefreshToken.updateMany({
        data: { consumedAt: now },
        where: {
          consumedAt: null,
          expiresAt: { gt: now },
          id: refreshToken.id,
          revokedAt: null,
        },
      })
      if (claimed.count !== 1) {
        reusedDuringRotation = true
        return
      }
      await transaction.partnerAiAccessToken.create({
        data: {
          connectionId: refreshToken.connectionId,
          expiresAt: accessTokenExpiresAt,
          scopes: databaseScopes,
          tokenHash: hashPartnerAiCredential(nextAccessToken),
        },
      })
      const replacement = await transaction.partnerAiRefreshToken.create({
        data: {
          connectionId: refreshToken.connectionId,
          expiresAt: refreshTokenExpiresAt,
          familyId: refreshToken.familyId,
          scopes: databaseScopes,
          tokenHash: hashPartnerAiCredential(nextRefreshToken),
        },
      })
      await transaction.partnerAiRefreshToken.update({
        data: { replacedById: replacement.id },
        where: { id: refreshToken.id },
      })
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })

    if (reusedDuringRotation) {
      await this.markRefreshReuse(reuseContext)
      throw this.invalidGrant()
    }
    return {
      accessToken: nextAccessToken,
      accessTokenExpiresAt,
      refreshToken: nextRefreshToken,
      scopes: requestedScopes,
    }
  }
}

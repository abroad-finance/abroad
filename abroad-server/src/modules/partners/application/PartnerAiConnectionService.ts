import { PartnerAiClientKind } from '@prisma/client'
import { inject, injectable } from 'inversify'

import type { PartnerAiAccessPrincipal } from './PartnerAiTokenService'

import { TYPES } from '../../../app/container/types'
import { IDatabaseClientProvider } from '../../../platform/persistence/IDatabaseClientProvider'
import { PARTNER_AI_MCP_RESOURCE_URL, PARTNER_AI_MCP_SERVER_VERSION } from './partnerAiConfiguration'
import { PartnerAiPortalError } from './PartnerAiErrors'
import { PartnerAiScopeName, toPartnerAiScopeNames } from './partnerAiScopes'
import { PartnerPortalAuditService } from './PartnerPortalAuditService'
import { PartnerPortalPrincipal } from './PartnerPortalSessionService'

export type PartnerAiAccountMetadata = {
  connectionId: string
  organizationName: string
  resource: string
  scopes: PartnerAiScopeName[]
  serverVersion: string
  status: 'ACTIVE'
}

export type PartnerAiConnectionDto = {
  clientName: string
  connectedAt: Date
  expiresAt: Date
  id: string
  lastTestedAt: Date | null
  lastUsedAt: Date | null
  scopes: PartnerAiScopeName[]
  status: PartnerAiConnectionStatus
  verifiedClient: boolean
}

type PartnerAiConnectionStatus = 'ACTIVE' | 'EXPIRED' | 'FAILED' | 'REVOKED'

@injectable()
export class PartnerAiConnectionService {
  public constructor(
    @inject(TYPES.IDatabaseClientProvider)
    private readonly databaseClientProvider: IDatabaseClientProvider,
    @inject(PartnerPortalAuditService)
    private readonly auditService: PartnerPortalAuditService,
  ) {}

  public getAccountMetadata(principal: PartnerAiAccessPrincipal): PartnerAiAccountMetadata {
    return {
      connectionId: principal.connectionId,
      organizationName: principal.partnerName,
      resource: PARTNER_AI_MCP_RESOURCE_URL,
      scopes: principal.scopes,
      serverVersion: PARTNER_AI_MCP_SERVER_VERSION,
      status: 'ACTIVE',
    }
  }

  public async list(principal: PartnerPortalPrincipal): Promise<PartnerAiConnectionDto[]> {
    const prismaClient = await this.databaseClientProvider.getClient()
    const connections = await prismaClient.partnerAiConnection.findMany({
      include: { oauthClient: true },
      orderBy: [{ authorizedAt: 'desc' }, { id: 'desc' }],
      take: 100,
      where: { partnerId: principal.partner.id },
    })
    const now = new Date()
    return connections.map(connection => ({
      clientName: connection.oauthClient.clientName,
      connectedAt: connection.authorizedAt,
      expiresAt: connection.expiresAt,
      id: connection.id,
      lastTestedAt: connection.lastTestedAt,
      lastUsedAt: connection.lastUsedAt,
      scopes: toPartnerAiScopeNames(connection.scopes),
      status: this.statusOf(connection, now),
      verifiedClient: connection.oauthClient.verifiedKind !== PartnerAiClientKind.GENERIC,
    }))
  }

  public async revoke(
    principal: PartnerPortalPrincipal,
    connectionId: string,
  ): Promise<PartnerAiConnectionDto> {
    this.assertMfaAdministrator(principal)
    const prismaClient = await this.databaseClientProvider.getClient()
    const connection = await prismaClient.partnerAiConnection.findFirst({
      include: { oauthClient: true },
      where: { id: connectionId, partnerId: principal.partner.id },
    })
    if (!connection) throw new PartnerAiPortalError('NOT_FOUND', 'Connected AI client not found')
    const now = new Date()
    if (!connection.revokedAt) {
      await prismaClient.$transaction(async (transaction) => {
        const changed = await transaction.partnerAiConnection.updateMany({
          data: { activeGrantKey: null, revokedAt: now },
          where: { id: connection.id, revokedAt: null },
        })
        await Promise.all([
          transaction.partnerAiAccessToken.updateMany({
            data: { revokedAt: now },
            where: { connectionId: connection.id, revokedAt: null },
          }),
          transaction.partnerAiRefreshToken.updateMany({
            data: { revokedAt: now },
            where: { connectionId: connection.id, revokedAt: null },
          }),
        ])
        if (changed.count === 1) {
          await this.auditService.record({
            action: 'AI_CONNECTION_REVOKED',
            actorUserId: principal.userId,
            metadata: {
              clientKind: connection.oauthClient.verifiedKind,
              outcome: 'REVOKED',
              source: 'PARTNER_PORTAL',
            },
            partnerId: principal.partner.id,
            resourceId: connection.id,
            resourceType: 'AI_CONNECTION',
          }, transaction)
        }
      })
    }
    return {
      clientName: connection.oauthClient.clientName,
      connectedAt: connection.authorizedAt,
      expiresAt: connection.expiresAt,
      id: connection.id,
      lastTestedAt: connection.lastTestedAt,
      lastUsedAt: connection.lastUsedAt,
      scopes: toPartnerAiScopeNames(connection.scopes),
      status: 'REVOKED',
      verifiedClient: connection.oauthClient.verifiedKind !== PartnerAiClientKind.GENERIC,
    }
  }

  public async test(
    principal: PartnerPortalPrincipal,
    connectionId: string,
  ): Promise<PartnerAiAccountMetadata> {
    const prismaClient = await this.databaseClientProvider.getClient()
    const connection = await prismaClient.partnerAiConnection.findFirst({
      where: { id: connectionId, partnerId: principal.partner.id },
    })
    const now = new Date()
    if (!connection) throw new PartnerAiPortalError('NOT_FOUND', 'Connected AI client not found')
    if (this.statusOf(connection, now) !== 'ACTIVE') {
      throw new PartnerAiPortalError('CONNECTION_INACTIVE', 'This AI client connection is not active')
    }
    await prismaClient.partnerAiConnection.update({
      data: { lastTestedAt: now },
      where: { id: connection.id },
    })
    return {
      connectionId: connection.id,
      organizationName: principal.partner.name,
      resource: PARTNER_AI_MCP_RESOURCE_URL,
      scopes: toPartnerAiScopeNames(connection.scopes),
      serverVersion: PARTNER_AI_MCP_SERVER_VERSION,
      status: 'ACTIVE',
    }
  }

  private assertMfaAdministrator(principal: PartnerPortalPrincipal): void {
    if (principal.role !== 'ADMIN') {
      throw new PartnerAiPortalError('ADMIN_REQUIRED', 'An Abroad administrator must revoke this connection')
    }
    if (!principal.mfaEnabled || !principal.mfaVerified) {
      throw new PartnerAiPortalError('MFA_REQUIRED', 'Verify MFA before revoking an AI client')
    }
  }

  private statusOf(connection: {
    expiresAt: Date
    failedAt: Date | null
    revokedAt: Date | null
  }, now: Date): PartnerAiConnectionStatus {
    if (connection.failedAt) return 'FAILED'
    if (connection.revokedAt) return 'REVOKED'
    if (connection.expiresAt <= now) return 'EXPIRED'
    return 'ACTIVE'
  }
}

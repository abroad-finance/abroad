import { OpsRole, Prisma } from '@prisma/client'
import { inject, injectable } from 'inversify'

import { TYPES } from '../../../app/container/types'
import { IDatabaseClientProvider } from '../../../platform/persistence/IDatabaseClientProvider'
import { IOpsIdentityProvider } from './contracts/IOpsIdentityProvider'
import { OpsAuditService } from './OpsAuditService'
import { OpsAuthenticationError, OpsExternalIdentity, OpsUserPrincipal } from './opsIdentity'
import { getOpsRolePermissions } from './opsPermissions'

const OPS_EMAIL_DOMAIN = 'abroad.finance'

export type OpsIdentitySession = {
  bootstrapRequired: boolean
  principal: OpsUserPrincipal
}

export class OpsBootstrapConflictError extends Error {
  public constructor(message = 'An Ops administrator already exists') {
    super(message)
    this.name = 'OpsBootstrapConflictError'
  }
}

export class OpsIdentityAdmissionError extends Error {
  public constructor(message = 'Use a verified Abroad organization account') {
    super(message)
    this.name = 'OpsIdentityAdmissionError'
  }
}

@injectable()
export class OpsIdentityService {
  public constructor(
    @inject(TYPES.IDatabaseClientProvider)
    private readonly databaseClientProvider: IDatabaseClientProvider,
    @inject(TYPES.IOpsIdentityProvider)
    private readonly identityProvider: IOpsIdentityProvider,
    @inject(OpsAuditService)
    private readonly auditService: OpsAuditService,
  ) {}

  public async admit(identity: OpsExternalIdentity): Promise<OpsIdentitySession> {
    this.assertOrganizationIdentity(identity)
    const prismaClient = await this.databaseClientProvider.getClient()
    const principal = await prismaClient.$transaction(async (transaction) => {
      const existingByEmail = await transaction.opsUser.findUnique({
        where: { email: identity.email },
      })
      if (existingByEmail?.firebaseUid && existingByEmail.firebaseUid !== identity.subject) {
        throw new OpsAuthenticationError()
      }

      const existingBySubject = await transaction.opsUser.findUnique({
        where: { firebaseUid: identity.subject },
      })
      if (existingBySubject && existingBySubject.email !== identity.email) {
        throw new OpsAuthenticationError()
      }

      const existing = existingByEmail ?? existingBySubject
      let user
      if (existing) {
        user = await transaction.opsUser.update({
          data: {
            displayName: identity.displayName,
            email: identity.email,
            firebaseUid: identity.subject,
            lastLoginAt: new Date(),
          },
          where: { id: existing.id },
        })
      }
      else {
        const administratorCount = await transaction.opsUser.count({
          where: {
            disabledAt: null,
            role: OpsRole.ADMINISTRATOR,
          },
        })
        if (administratorCount > 0) {
          throw new OpsIdentityAdmissionError('Ask an Ops administrator to grant access to this account')
        }
        user = await transaction.opsUser.create({
          data: {
            displayName: identity.displayName,
            email: identity.email,
            firebaseUid: identity.subject,
            lastLoginAt: new Date(),
            role: OpsRole.VIEWER,
          },
        })
      }
      if (
        user.disabledAt
        || (user.sessionsRevokedAt && identity.authTime <= user.sessionsRevokedAt)
      ) {
        throw new OpsAuthenticationError()
      }

      const admittedPrincipal = this.toPrincipal(user, identity.authTime)
      await this.auditService.record(admittedPrincipal, {
        action: existingByEmail || existingBySubject
          ? 'identity.session_started'
          : 'identity.user_admitted',
        resourceId: user.id,
        resourceType: 'ops_user',
      }, transaction)
      return admittedPrincipal
    })

    return {
      bootstrapRequired: await this.isBootstrapRequired(),
      principal,
    }
  }

  public async authenticate(idToken: string): Promise<OpsUserPrincipal> {
    const identity = await this.verifyOrganizationIdentity(idToken)
    const prismaClient = await this.databaseClientProvider.getClient()
    const user = await prismaClient.opsUser.findUnique({
      where: { firebaseUid: identity.subject },
    })
    if (
      !user
      || user.disabledAt
      || user.email !== identity.email
      || (user.sessionsRevokedAt && identity.authTime <= user.sessionsRevokedAt)
    ) {
      throw new OpsAuthenticationError()
    }
    return this.toPrincipal(user, identity.authTime)
  }

  public async bootstrapAdministrator(identity: OpsExternalIdentity): Promise<OpsIdentitySession> {
    this.assertOrganizationIdentity(identity)
    const prismaClient = await this.databaseClientProvider.getClient()
    const principal = await prismaClient.$transaction(async (transaction) => {
      const administratorCount = await transaction.opsUser.count({
        where: {
          disabledAt: null,
          role: OpsRole.ADMINISTRATOR,
        },
      })
      if (administratorCount > 0) {
        throw new OpsBootstrapConflictError()
      }

      const existingByEmail = await transaction.opsUser.findUnique({
        where: { email: identity.email },
      })
      if (existingByEmail?.firebaseUid && existingByEmail.firebaseUid !== identity.subject) {
        throw new OpsAuthenticationError()
      }

      const existingBySubject = await transaction.opsUser.findUnique({
        where: { firebaseUid: identity.subject },
      })
      if (existingBySubject && existingBySubject.email !== identity.email) {
        throw new OpsAuthenticationError()
      }

      const existing = existingByEmail ?? existingBySubject
      const user = existing
        ? await transaction.opsUser.update({
            data: {
              disabledAt: null,
              displayName: identity.displayName,
              email: identity.email,
              firebaseUid: identity.subject,
              lastLoginAt: new Date(),
              role: OpsRole.ADMINISTRATOR,
              sessionsRevokedAt: null,
              sessionVersion: { increment: 1 },
              version: { increment: 1 },
            },
            where: { id: existing.id },
          })
        : await transaction.opsUser.create({
            data: {
              displayName: identity.displayName,
              email: identity.email,
              firebaseUid: identity.subject,
              lastLoginAt: new Date(),
              role: OpsRole.ADMINISTRATOR,
            },
          })
      const administrator = this.toPrincipal(user, identity.authTime)
      await this.auditService.record(administrator, {
        action: 'identity.administrator_bootstrapped',
        resourceId: user.id,
        resourceType: 'ops_user',
      }, transaction)
      return administrator
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    })

    return {
      bootstrapRequired: false,
      principal,
    }
  }

  public async isBootstrapRequired(): Promise<boolean> {
    const prismaClient = await this.databaseClientProvider.getClient()
    const administratorCount = await prismaClient.opsUser.count({
      where: {
        disabledAt: null,
        role: OpsRole.ADMINISTRATOR,
      },
    })
    return administratorCount === 0
  }

  private assertOrganizationIdentity(identity: OpsExternalIdentity): void {
    const separatorIndex = identity.email.lastIndexOf('@')
    const domain = separatorIndex >= 0
      ? identity.email.slice(separatorIndex + 1).toLowerCase()
      : ''
    if (domain !== OPS_EMAIL_DOMAIN) {
      throw new OpsIdentityAdmissionError()
    }
  }

  private toPrincipal(
    user: {
      displayName: string
      email: string
      id: string
      role: OpsRole
      sessionVersion: number
    },
    authTime: Date,
  ): OpsUserPrincipal {
    return {
      authTime,
      displayName: user.displayName,
      email: user.email,
      kind: 'ops_user',
      permissions: getOpsRolePermissions(user.role),
      role: user.role,
      sessionVersion: user.sessionVersion,
      userId: user.id,
    }
  }

  private async verifyOrganizationIdentity(idToken: string): Promise<OpsExternalIdentity> {
    const identity = await this.identityProvider.verifyIdToken(idToken)
    this.assertOrganizationIdentity(identity)
    return identity
  }
}

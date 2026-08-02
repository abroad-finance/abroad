import type { Request as ExpressRequest } from 'express'
import type { TsoaResponse } from 'tsoa'

import { OpsRole } from '@prisma/client'

import { OpsAuthService } from '../../../../../app/http/OpsAuthService'
import { OpsIdentityService } from '../../../../../modules/operations/application/OpsIdentityService'
import { OpsIdentityController } from '../../../../../modules/operations/interfaces/http/OpsIdentityController'

const authenticatedAt = new Date('2026-08-02T15:00:00.000Z')

const externalIdentity = {
  authTime: authenticatedAt,
  displayName: 'Ana Operator',
  email: 'ana@abroad.finance',
  kind: 'ops_external' as const,
  provider: 'google.com' as const,
  subject: 'firebase-subject-1',
}

const principal = {
  authTime: authenticatedAt,
  displayName: externalIdentity.displayName,
  email: externalIdentity.email,
  kind: 'ops_user' as const,
  permissions: ['overview:read', 'administration:users'] as const,
  role: OpsRole.ADMINISTRATOR,
  sessionVersion: 2,
  userId: 'ops-user-1',
}

const buildController = () => {
  const identityService = {
    admit: jest.fn().mockResolvedValue({
      bootstrapRequired: true,
      principal: { ...principal, role: OpsRole.VIEWER },
    }),
    bootstrapAdministrator: jest.fn().mockResolvedValue({
      bootstrapRequired: false,
      principal,
    }),
    isBootstrapRequired: jest.fn().mockResolvedValue(false),
  }
  const opsAuthService = {
    verifyOpsApiKey: jest.fn().mockResolvedValue(undefined),
  }

  return {
    controller: new OpsIdentityController(
      identityService as unknown as OpsIdentityService,
      opsAuthService as unknown as OpsAuthService,
    ),
    identityService,
    opsAuthService,
  }
}

const requestWithUser = (user: ExpressRequest['user']): ExpressRequest => ({
  user,
} as ExpressRequest)

const unauthorized = jest.fn() as unknown as TsoaResponse<401, { reason: string }>
const conflict = jest.fn() as unknown as TsoaResponse<409, { reason: string }>

describe('OpsIdentityController', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('publishes only non-secret identity configuration', () => {
    const { controller } = buildController()

    expect(controller.getConfig()).toEqual(expect.objectContaining({
      allowedEmailDomain: 'abroad.finance',
      firebaseConfigPath: '/__/firebase/init.json',
      provider: 'google.com',
      stepUpMaxAgeSeconds: 600,
    }))
    expect(controller.getConfig().mutationPolicies).toEqual(expect.arrayContaining([
      expect.objectContaining({
        action: 'transaction.reconcile_hash',
        confirmation: 'RECONCILE HASH',
        expectedVersion: false,
        stepUpRequired: true,
      }),
      expect.objectContaining({
        action: 'configuration.definition.update',
        confirmation: 'UPDATE FLOW',
        expectedVersion: true,
      }),
    ]))
  })

  it('admits a verified external identity and returns a no-secret session DTO', async () => {
    const { controller, identityService } = buildController()

    const response = await controller.createSession(
      requestWithUser(externalIdentity),
      unauthorized,
    )

    expect(identityService.admit).toHaveBeenCalledWith(externalIdentity)
    expect(response).toEqual(expect.objectContaining({
      bootstrapRequired: true,
      email: externalIdentity.email,
      kind: 'ops_user',
      stepUpExpiresAt: new Date('2026-08-02T15:10:00.000Z'),
    }))
  })

  it('requires both verified identity and the legacy key for one-time bootstrap', async () => {
    const { controller, identityService, opsAuthService } = buildController()

    const response = await controller.bootstrapAdministrator(
      'legacy-key',
      requestWithUser(externalIdentity),
      unauthorized,
      conflict,
    )

    expect(opsAuthService.verifyOpsApiKey).toHaveBeenCalledWith('legacy-key')
    expect(identityService.bootstrapAdministrator).toHaveBeenCalledWith(externalIdentity)
    expect(response).toEqual(expect.objectContaining({
      bootstrapRequired: false,
      role: OpsRole.ADMINISTRATOR,
    }))
  })

  it('returns the current named session from server-authenticated context', async () => {
    const { controller } = buildController()

    const response = await controller.getSession(requestWithUser(principal))

    expect(response).toEqual(expect.objectContaining({
      kind: 'ops_user',
      permissions: [...principal.permissions],
      sessionVersion: 2,
      userId: principal.userId,
    }))
  })
})

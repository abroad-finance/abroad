import { OpsRole } from '@prisma/client'

import {
  OpsAuthorizationError,
  OpsPrincipal,
  OpsStepUpRequiredError,
  requireOpsPermission,
  requireOpsStepUp,
} from '../../../../modules/operations/application/opsIdentity'

const authenticatedAt = new Date('2026-08-02T15:00:00.000Z')

const userPrincipal: OpsPrincipal = {
  authTime: authenticatedAt,
  displayName: 'Ops User',
  email: 'ops@abroad.finance',
  kind: 'ops_user',
  permissions: ['transactions:read', 'transactions:reconcile'],
  role: OpsRole.OPERATIONS,
  sessionVersion: 1,
  userId: 'ops-user-1',
}

describe('Ops identity guards', () => {
  it('authorizes an explicit permission and rejects an absent permission', () => {
    expect(() => requireOpsPermission(userPrincipal, 'transactions:read')).not.toThrow()
    expect(() => requireOpsPermission(userPrincipal, 'kyc:reveal')).toThrow(
      OpsAuthorizationError,
    )
  })

  it('accepts a recent named-user authentication for step-up', () => {
    const principal = requireOpsStepUp(
      userPrincipal,
      10 * 60 * 1_000,
      new Date('2026-08-02T15:09:59.000Z'),
    )

    expect(principal).toBe(userPrincipal)
  })

  it('rejects an expired authentication or legacy key for step-up', () => {
    expect(() => requireOpsStepUp(
      userPrincipal,
      10 * 60 * 1_000,
      new Date('2026-08-02T15:10:01.000Z'),
    )).toThrow(OpsStepUpRequiredError)

    expect(() => requireOpsStepUp({
      authTime: null,
      displayName: 'Legacy Ops key',
      email: null,
      kind: 'ops_legacy',
      permissions: ['overview:read'],
      role: null,
      sessionVersion: null,
      userId: null,
    }, 10 * 60 * 1_000)).toThrow(OpsStepUpRequiredError)
  })
})

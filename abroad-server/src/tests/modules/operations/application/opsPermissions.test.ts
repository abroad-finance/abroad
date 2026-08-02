import { OpsRole } from '@prisma/client'

import { getOpsRolePermissions, hasOpsPermission, isOpsPermission, OPS_PERMISSIONS } from '../../../../modules/operations/application/opsPermissions'

describe('Ops permissions', () => {
  it('defines unique stable permission names', () => {
    expect(new Set(OPS_PERMISSIONS).size).toBe(OPS_PERMISSIONS.length)
    expect(OPS_PERMISSIONS.every(isOpsPermission)).toBe(true)
    expect(isOpsPermission('unknown:permission')).toBe(false)
  })

  it('keeps viewer access read-only', () => {
    const permissions = getOpsRolePermissions(OpsRole.VIEWER)

    expect(permissions).toEqual(expect.arrayContaining([
      'overview:read',
      'transactions:read',
      'treasury:read',
    ]))
    expect(permissions).not.toContain('transactions:reconcile')
    expect(permissions).not.toContain('configuration:manage')
    expect(permissions).not.toContain('credentials:manage')
  })

  it('grants the administrator every registered permission', () => {
    expect(getOpsRolePermissions(OpsRole.ADMINISTRATOR)).toEqual(OPS_PERMISSIONS)
  })

  it('keeps sensitive duties separated between specialist roles', () => {
    const compliance = getOpsRolePermissions(OpsRole.COMPLIANCE)
    const finance = getOpsRolePermissions(OpsRole.FINANCE)
    const operations = getOpsRolePermissions(OpsRole.OPERATIONS)

    expect(hasOpsPermission(compliance, 'kyc:decide')).toBe(true)
    expect(hasOpsPermission(compliance, 'treasury:read')).toBe(true)
    expect(hasOpsPermission(compliance, 'transactions:reconcile')).toBe(false)

    expect(hasOpsPermission(finance, 'transactions:reconcile')).toBe(true)
    expect(hasOpsPermission(finance, 'kyc:reveal')).toBe(false)

    expect(hasOpsPermission(operations, 'flows:recover')).toBe(true)
    expect(hasOpsPermission(operations, 'configuration:approve')).toBe(false)
  })
})

import { OpsRole } from '@prisma/client'

export const OPS_PERMISSIONS = [
  'administration:audit',
  'administration:integrations',
  'administration:users',
  'cases:manage',
  'configuration:approve',
  'configuration:manage',
  'configuration:read',
  'credentials:manage',
  'flows:raw',
  'flows:read',
  'flows:recover',
  'incidents:manage',
  'incidents:read',
  'kyc:decide',
  'kyc:read',
  'kyc:reveal',
  'overview:read',
  'partners:manage',
  'partners:read',
  'saved_views:manage',
  'search:read',
  'transactions:export',
  'transactions:proof',
  'transactions:read',
  'transactions:reconcile',
  'transactions:refund',
  'treasury:manage',
  'treasury:read',
] as const

export type OpsPermission = typeof OPS_PERMISSIONS[number]

const viewerPermissions = [
  'configuration:read',
  'flows:read',
  'incidents:read',
  'overview:read',
  'partners:read',
  'search:read',
  'transactions:read',
  'treasury:read',
] as const satisfies readonly OpsPermission[]

const rolePermissions: Readonly<Record<OpsRole, readonly OpsPermission[]>> = {
  [OpsRole.ADMINISTRATOR]: OPS_PERMISSIONS,
  [OpsRole.COMPLIANCE]: [
    ...viewerPermissions,
    'cases:manage',
    'kyc:decide',
    'kyc:read',
    'kyc:reveal',
    'saved_views:manage',
    'transactions:proof',
  ],
  [OpsRole.FINANCE]: [
    ...viewerPermissions,
    'cases:manage',
    'saved_views:manage',
    'transactions:export',
    'transactions:proof',
    'transactions:reconcile',
    'transactions:refund',
    'treasury:manage',
  ],
  [OpsRole.OPERATIONS]: [
    ...viewerPermissions,
    'cases:manage',
    'flows:raw',
    'flows:recover',
    'incidents:manage',
    'saved_views:manage',
    'transactions:export',
    'transactions:proof',
    'transactions:reconcile',
    'transactions:refund',
  ],
  [OpsRole.SUPPORT]: [
    ...viewerPermissions,
    'cases:manage',
    'saved_views:manage',
    'transactions:export',
    'transactions:proof',
  ],
  [OpsRole.VIEWER]: viewerPermissions,
}

const permissionNames = new Set<string>(OPS_PERMISSIONS)

export const getOpsRolePermissions = (role: OpsRole): readonly OpsPermission[] => (
  rolePermissions[role]
)

export const hasOpsPermission = (
  permissions: readonly OpsPermission[],
  permission: OpsPermission,
): boolean => permissions.includes(permission)

export const isOpsPermission = (value: string): value is OpsPermission => (
  permissionNames.has(value)
)

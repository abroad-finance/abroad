import type {
  CryptoAssetUpdateInput,
  FlowCorridorUpdateInput,
  FlowDefinitionInput,
} from './flowTypes'

export const opsConfigurationReleaseStatuses = [
  'DRAFT',
  'PENDING_APPROVAL',
  'APPROVED',
  'APPLIED',
  'REJECTED',
  'SUPERSEDED',
  'ROLLED_BACK',
] as const

export const opsConfigurationTargetTypes = [
  'FLOW_DEFINITION',
  'FLOW_CORRIDOR',
  'CRYPTO_ASSET',
] as const

export type OpsConfigurationDiffEntry = {
  after: null | string
  before: null | string
  field: string
}

export type OpsConfigurationDraftInput = {
  effectiveAt?: string
  payload: OpsConfigurationPayload
  title: string
}

export type OpsConfigurationPayload
  = | {
    definitionId?: string
    kind: 'FLOW_DEFINITION'
    operation: 'CREATE' | 'UPDATE'
    value: FlowDefinitionInput
  }
  | {
    kind: 'CRYPTO_ASSET'
    value: CryptoAssetUpdateInput
  }
  | {
    kind: 'FLOW_CORRIDOR'
    value: FlowCorridorUpdateInput
  }

export type OpsConfigurationRelease = {
  appliedAt: null | string
  appliedBy: null | OpsConfigurationReleaseUser
  appliedVersion: null | number
  approvedAt: null | string
  approvedBy: null | OpsConfigurationReleaseUser
  baseVersion: number
  createdAt: string
  diff: OpsConfigurationDiffEntry[]
  effectiveAt: null | string
  id: string
  impact: string[]
  payload: OpsConfigurationPayload
  reason: string
  reference: null | string
  rejectionReason: null | string
  requestedBy: OpsConfigurationReleaseUser
  rollbackOfId: null | string
  status: OpsConfigurationReleaseStatus
  targetKey: string
  targetType: OpsConfigurationTargetType
  title: string
  updatedAt: string
  version: number
}

export type OpsConfigurationReleaseList = {
  items: OpsConfigurationRelease[]
  page: number
  pageSize: number
  total: number
}

export type OpsConfigurationReleaseStatus = typeof opsConfigurationReleaseStatuses[number]

export type OpsConfigurationReleaseUser = {
  displayName: string
  id: string
}

export type OpsConfigurationTargetType = typeof opsConfigurationTargetTypes[number]

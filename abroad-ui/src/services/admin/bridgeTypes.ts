export type OpsBridgeBatch = {
  asset: string
  createdAt: string
  destNetwork: string
  expectedSlaAt: string
  failureCategory: 'BRIDGE_PROVIDER_FAILURE' | null
  grossAmount: number
  id: string
  incidentPath: string
  memberCount: number
  reconciliationState: OpsBridgeReconciliationState
  runbookPath: string
  settledAt: null | string
  slaState: OpsBridgeSlaState
  status: OpsBridgeBatchStatus
  withdrawFee: null | number
  withdrawId: null | string
}

export type OpsBridgeBatchDetail = {
  batch: OpsBridgeBatch
  members: OpsBridgeLeg[]
  providerReference: null | string
}

export type OpsBridgeBatchStatus = 'CREDITED' | 'FAILED' | 'OPEN' | 'SUBMITTED'

export type OpsBridgeFloat = {
  available: null | number
  cap: null | number
  deficit: number
  enabled: boolean
}

export type OpsBridgeLeg = {
  amount: number
  asset: string
  batchId: null | string
  createdAt: string
  destNetwork: string
  expectedSlaAt: string
  failureCategory: 'BRIDGE_LEG_FAILED' | null
  id: string
  incidentPath: string
  reconciliationState: OpsBridgeReconciliationState
  slaState: OpsBridgeSlaState
  status: OpsBridgeLegStatus
  transaction: null | {
    id: string
    partner: { id: string, name: string }
    status: string
  }
  updatedAt: string
}

export type OpsBridgeLegGroup = {
  amount: number
  count: number
  status: OpsBridgeLegStatus
}

export type OpsBridgeLegStatus = 'BATCHED' | 'FAILED' | 'PENDING' | 'SETTLED'
export type OpsBridgeOverview = {
  batches: OpsBridgeBatch[]
  float: OpsBridgeFloat
  legs: {
    byStatus: OpsBridgeLegGroup[]
    oldestPendingAt: null | string
    recent: OpsBridgeLeg[]
    total: number
  }
}

export type OpsBridgeReconciliationState = 'ACTION_REQUIRED' | 'AWAITING_PROVIDER' | 'COLLECTING' | 'RECONCILED'

export type OpsBridgeSlaState = 'BREACHED' | 'MET' | 'ON_TRACK'

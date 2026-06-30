export type OpsBridgeBatch = {
  asset: string
  createdAt: string
  destNetwork: string
  grossAmount: number
  id: string
  memberCount: number
  settledAt: null | string
  status: OpsBridgeBatchStatus
  withdrawFee: null | number
  withdrawId: null | string
}

export type OpsBridgeBatchStatus = 'CREDITED' | 'FAILED' | 'OPEN' | 'SUBMITTED'

export type OpsBridgeFloat = {
  available: null | number
  cap: null | number
  deficit: number
  enabled: boolean
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
    total: number
  }
}

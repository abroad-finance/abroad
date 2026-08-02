export type OpsTreasuryBalanceCell = {
  account: string
  amount: number
  availableAmount: null | number
  blockedAmount: null | number
  currency: string
  outstandingAmount: null | number
  posture: OpsTreasuryCellPosture
  reservedAmount: null | number
  usdRate: null | number
  usdValue: null | number
  venue: string
}

export type OpsTreasuryBalancesResponse = {
  capturedAt: string
  cells: OpsTreasuryBalanceCell[]
  errors: OpsTreasuryVenueError[]
  float: OpsTreasuryFloat
  freshness: {
    staleAt: string
    state: 'FRESH' | 'PARTIAL'
  }
  fxRates: OpsTreasuryFxRate[]
  totalUsd: number
  totalUsdIsPartial: boolean
}

export type OpsTreasuryCellPosture = {
  alertPath: string
  averageDailyOutflow: null | number
  ownerTeam: null | string
  runwayHours: null | number
  state: 'CRITICAL' | 'OK' | 'UNCONFIGURED' | 'WARNING'
  threshold: null | {
    criticalRunwayHours: null | number
    id: string
    minimumAvailable: null | number
    version: number
    warningRunwayHours: null | number
  }
}

export type OpsTreasuryFloat = {
  available: null | number
  cap: null | number
  deficit: number
  enabled: boolean
}

export type OpsTreasuryFxRate = {
  currency: string
  usdPerUnit: number
}

export type OpsTreasuryMovementBucket = {
  amount: number
  currency: string
}

export type OpsTreasuryMovementDay = {
  bridgeSettledUsdc: number
  date: string
  inboundCrypto: OpsTreasuryMovementBucket[]
  outboundFiat: OpsTreasuryMovementBucket[]
}

export type OpsTreasuryMovementEvent = {
  amount: number
  at: string
  currency: string
  direction: 'IN' | 'OUT'
  kind: 'BRIDGE_SETTLED' | 'CRYPTO_IN' | 'FIAT_PAYOUT'
  reference: string
}

export type OpsTreasuryMovementsResponse = {
  days: OpsTreasuryMovementDay[]
  recent: OpsTreasuryMovementEvent[]
}

export type OpsTreasurySnapshotPoint = {
  capturedAt: string
  usdValue: null | number
}

export type OpsTreasurySnapshotSeries = {
  points: OpsTreasurySnapshotPoint[]
  venue: string
}

export type OpsTreasurySnapshotsResponse = {
  from: string
  series: OpsTreasurySnapshotSeries[]
  to: string
}

export type OpsTreasuryThreshold = OpsTreasuryThresholdInput & {
  createdAt: string
  createdBy: { displayName: string, id: string }
  id: string
  updatedAt: string
  updatedBy: { displayName: string, id: string }
  version: number
}

export type OpsTreasuryThresholdInput = {
  criticalRunwayHours?: null | number
  currency: string
  minimumAvailable?: null | number
  ownerTeam: string
  venue: string
  warningRunwayHours?: null | number
}

export type OpsTreasuryVenueError = {
  message: string
  venue: string
}

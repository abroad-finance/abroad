export type OpsStablebondExecutionResult = {
  executionId: null | string
  onChainId: null | string
  outcome: string
  reason: null | string
  receivedAmount: null | number
  spreadBps: null | number
}

export type OpsStablebondPosition = {
  accruedFiat: number
  accruedUsd: number
  annualYieldBps: number
  assetCode: string
  effectiveAnnualBps: null | number
  entryNavFiat: null | number
  fiatCurrency: string
  heldTokens: number
  issuer: string
  jitUnwindCapUsdc: number
  maxSlippageBps: number
  navFiat: number
  navObservedAt: string
  navUsd: number
  openedAt: null | string
  principalFiat: null | number
  status: string
  symbol: string
  unwindable: OpsStablebondUnwindability
  valueFiat: number
  valueUsd: number
  venue: string
}

export type OpsStablebondResponse = {
  disabledReason: null | string
  enabled: boolean
  error: null | string
  position: null | OpsStablebondPosition
  recentUnwinds: OpsStablebondUnwind[]
}

export type OpsStablebondTrustline = {
  balance: null | number
  limit: null | number
  onChainId: null | string
  outcome: string
  reason: null | string
}

export type OpsStablebondUnwind = {
  direction: string
  failureReason: null | string
  id: string
  minReceive: number
  navUsdPerToken: number
  onChainId: null | string
  quotedAt: string
  quotedReceive: number
  receiveAsset: string
  receivedAmount: null | number
  sendAmount: number
  sendAsset: string
  settledAt: null | string
  spreadBps: null | number
  status: string
}

export type OpsStablebondUnwindability = {
  feasible: boolean
  reason: null | string
  spreadBps: null | number
  testedUsdc: number
}

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

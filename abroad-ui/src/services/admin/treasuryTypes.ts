export type OpsTreasuryBalanceCell = {
  account: string
  amount: number
  currency: string
  usdRate: null | number
  usdValue: null | number
  venue: string
}

export type OpsTreasuryBalancesResponse = {
  capturedAt: string
  cells: OpsTreasuryBalanceCell[]
  errors: OpsTreasuryVenueError[]
  float: OpsTreasuryFloat
  fxRates: OpsTreasuryFxRate[]
  totalUsd: number
  totalUsdIsPartial: boolean
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

export type OpsTreasuryVenueError = {
  message: string
  venue: string
}

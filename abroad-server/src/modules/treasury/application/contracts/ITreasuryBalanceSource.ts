/**
 * A read-only view over one venue's balances. Implementations may authenticate
 * with a provider credential but must only invoke read operations. Errors
 * should be thrown (not swallowed): the aggregator isolates per-venue failures
 * so one venue being down degrades, never blanks, the board.
 */
export interface ITreasuryBalanceSource {
  getBalances(): Promise<TreasuryBalance[]>
  readonly venue: TreasuryVenue
}

export type TreasuryBalance = {
  /** Sub-account / wallet address / provider account id ('' when the venue has a single account). */
  account: string
  amount: number
  /** Funds immediately usable for new operations, when the venue exposes the distinction. */
  availableAmount: null | number
  /** Funds held by the venue and not currently usable, when reported. */
  blockedAmount: null | number
  /** Currency or asset code as the venue reports it (USDC, USDT, BRL, COP, ...). */
  currency: string
  /** Debt or unsettled obligations reported by the venue, when available. */
  outstandingAmount: null | number
  /** Funds committed to in-flight processing or withdrawals, when reported. */
  reservedAmount: null | number
  venue: TreasuryVenue
}

export type TreasuryVenue
  = 'BINANCE'
    | 'CELO_HOT_WALLET'
    | 'MOVII'
    | 'SOLANA_HOT_WALLET'
    | 'STELLAR_HOT_WALLET'
    | 'TRANSFERO'

/**
 * A read-only view over one venue's balances. Implementations must never load
 * signing keys — address/read secrets only — so the ops dashboard path cannot
 * touch funds. Errors should be thrown (not swallowed): the aggregator isolates
 * per-venue failures so one venue being down degrades, never blanks, the board.
 */
export interface ITreasuryBalanceSource {
  getBalances(): Promise<TreasuryBalance[]>
  readonly venue: TreasuryVenue
}

export type TreasuryBalance = {
  /** Sub-account / wallet address / provider account id ('' when the venue has a single account). */
  account: string
  amount: number
  /** Currency or asset code as the venue reports it (USDC, USDT, BRL, COP, ...). */
  currency: string
  venue: TreasuryVenue
}

export type TreasuryVenue
  = 'BINANCE'
    | 'CELO_HOT_WALLET'
    | 'MOVII'
    | 'SOLANA_HOT_WALLET'
    | 'STELLAR_HOT_WALLET'
    | 'TRANSFERO'

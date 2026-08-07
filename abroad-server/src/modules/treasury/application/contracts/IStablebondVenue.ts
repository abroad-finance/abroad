import { Prisma, StablebondExecutionDirection } from '@prisma/client'

/**
 * A venue that can move the treasury into and out of a Stablebond position.
 *
 * The unwind is the thesis — a position is only float if it can be liquidated
 * inside a payout window — but with no issuer relationship the same venue is
 * also the only way in, so both directions live behind one port. They are the
 * same operation with the assets swapped, and they must share the slippage
 * bound, the durability and the reconciliation rules.
 *
 * Implementations lead with a permissionless venue, so no counterparty can
 * withhold either side.
 */
export interface IStablebondVenue {
  /**
   * Opens the trustline the position needs, if it is not already open.
   *
   * Separate from `execute` because it is a prerequisite rather than a trade:
   * it moves no value, it only commits a base reserve. Idempotent — an existing
   * trustline is reported, never re-created.
   */
  ensureTrustline(): Promise<StablebondTrustlineResult>

  /**
   * Spend exactly `sendAmount`, filling no worse than `minReceive`.
   *
   * `persistPrepared` is called with the execution's on-chain identity BEFORE
   * anything is submitted, and must durably commit it. That ordering is what
   * makes an ambiguous submission reconcilable rather than a guess: an execution
   * we cannot name is an execution we cannot check.
   */
  execute(
    params: StablebondExecuteParams,
    persistPrepared: (prepared: { onChainId: string }) => Promise<void>,
  ): Promise<StablebondExecutionResult>

  /** The asset the position is bought with and sold into, e.g. USDC. */
  readonly quoteAsset: string

  /** What receiving exactly `receiveAmount` would cost, or null when there is no path. */
  quoteByReceive(
    direction: StablebondExecutionDirection,
    receiveAmount: Prisma.Decimal,
  ): Promise<null | StablebondQuote>

  /**
   * What spending `sendAmount` would fetch, or null when the venue has no path
   * — which is itself a valid, actionable answer and must not be reported as a
   * zero-cost fill.
   */
  quoteBySend(
    direction: StablebondExecutionDirection,
    sendAmount: Prisma.Decimal,
  ): Promise<null | StablebondQuote>

  /** Whether the trustline exists, without attempting to open it. */
  readTrustline(): Promise<StablebondTrustlineResult>

  /** Read-only. The only safe response to an ambiguous execution. */
  reconcile(onChainId: string): Promise<StablebondReconciliation>
}

export type StablebondExecuteParams = {
  direction: StablebondExecutionDirection
  /** The floor the venue must fill at or above. This is the slippage bound. */
  minReceive: Prisma.Decimal
  sendAmount: Prisma.Decimal
}

export type StablebondExecutionResult
  /** The venue neither confirmed nor rejected. NEVER re-execute on this; reconcile by id. */
  = | { onChainId: null | string, outcome: 'ambiguous', reason: string }
    /** Nothing was submitted, or the venue rejected it outright. Safe to re-quote. */
    | { onChainId: null | string, outcome: 'failed', reason: string }
    /**
     * Settled. `receivedAmount` is null when the fill is known to have happened
     * but its exact size could not be read back yet — the money moved, the
     * measurement is pending, and a later reconcile fills it in.
     */
    | { onChainId: string, outcome: 'confirmed', receivedAmount: null | Prisma.Decimal }

/**
 * What the venue would fill right now.
 *
 * A quote is an observation, not a reservation — no venue reached here holds a
 * price. It is the input to the slippage bound, which is what actually protects
 * the execution.
 */
export type StablebondQuote = {
  direction: StablebondExecutionDirection
  observedAt: Date
  receiveAmount: Prisma.Decimal
  receiveAsset: string
  sendAmount: Prisma.Decimal
  sendAsset: string
}

export type StablebondReconciliation
  = | { onChainId: string, outcome: 'confirmed', receivedAmount: null | Prisma.Decimal }
    | { outcome: 'absent' }
    | { outcome: 'failed' }
    | { outcome: 'unavailable', reason: string }

export type StablebondTrustlineResult
  /** Already open. `limit` is the trustline's cap, `balance` what it holds. */
  = | { balance: Prisma.Decimal, limit: Prisma.Decimal, outcome: 'present' }
    | { onChainId: null | string, outcome: 'opened' }
    /** Submitted but unconfirmed. Re-read before deciding; never re-submit blindly. */
    | { onChainId: string, outcome: 'ambiguous', reason: string }
    /** No trustline yet, so the position cannot be held at all. */
    | { outcome: 'absent' }
    | { outcome: 'failed', reason: string }

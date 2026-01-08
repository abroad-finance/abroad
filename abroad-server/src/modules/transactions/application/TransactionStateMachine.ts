import { TransactionStatus } from '@prisma/client'

export type TransactionTransitionName =
  | 'deposit_received'
  | 'expired'
  | 'payment_completed'
  | 'payment_failed'
  | 'wrong_amount'

type AllowedTransition = {
  from: ReadonlyArray<TransactionStatus>
  to: TransactionStatus
}

const allowedTransitions: Record<TransactionTransitionName, AllowedTransition> = {
  deposit_received: {
    from: [TransactionStatus.AWAITING_PAYMENT],
    to: TransactionStatus.PROCESSING_PAYMENT,
  },
  expired: {
    from: [TransactionStatus.AWAITING_PAYMENT],
    to: TransactionStatus.PAYMENT_EXPIRED,
  },
  payment_completed: {
    from: [TransactionStatus.PROCESSING_PAYMENT],
    to: TransactionStatus.PAYMENT_COMPLETED,
  },
  payment_failed: {
    from: [TransactionStatus.PROCESSING_PAYMENT],
    to: TransactionStatus.PAYMENT_FAILED,
  },
  wrong_amount: {
    from: [TransactionStatus.PROCESSING_PAYMENT],
    to: TransactionStatus.WRONG_AMOUNT,
  },
}

export class InvalidTransactionTransitionError extends Error {
  public constructor(
    public readonly current: TransactionStatus,
    public readonly requested: TransactionTransitionName,
  ) {
    super(`Invalid transition: ${current} -> ${requested}`)
  }
}

export function resolveTransition(
  currentStatus: TransactionStatus,
  transition: TransactionTransitionName,
): TransactionStatus {
  const rule = allowedTransitions[transition]
  if (!rule) {
    throw new InvalidTransactionTransitionError(currentStatus, transition)
  }

  if (!rule.from.includes(currentStatus)) {
    throw new InvalidTransactionTransitionError(currentStatus, transition)
  }

  return rule.to
}

export function isTerminalStatus(status: TransactionStatus): boolean {
  return [
    TransactionStatus.PAYMENT_COMPLETED,
    TransactionStatus.PAYMENT_FAILED,
    TransactionStatus.PAYMENT_EXPIRED,
    TransactionStatus.WRONG_AMOUNT,
  ].includes(status)
}

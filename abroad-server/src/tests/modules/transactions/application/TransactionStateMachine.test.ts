import { TransactionStatus } from '@prisma/client'

import { InvalidTransactionTransitionError, isTerminalStatus, resolveTransition } from '../../../../modules/transactions/application/TransactionStateMachine'

describe('TransactionStateMachine', () => {
  it('identifies terminal transaction statuses', () => {
    const terminalStatuses = [
      TransactionStatus.PAYMENT_COMPLETED,
      TransactionStatus.PAYMENT_EXPIRED,
      TransactionStatus.PAYMENT_FAILED,
      TransactionStatus.WRONG_AMOUNT,
    ]

    terminalStatuses.forEach((status) => {
      expect(isTerminalStatus(status)).toBe(true)
    })
    expect(isTerminalStatus(TransactionStatus.AWAITING_PAYMENT)).toBe(false)
    expect(isTerminalStatus(TransactionStatus.PROCESSING_PAYMENT)).toBe(false)
  })

  it('rejects invalid transitions', () => {
    expect(resolveTransition(TransactionStatus.AWAITING_PAYMENT, 'deposit_received'))
      .toBe(TransactionStatus.PROCESSING_PAYMENT)

    expect(() => resolveTransition(TransactionStatus.PROCESSING_PAYMENT, 'expired'))
      .toThrow(InvalidTransactionTransitionError)
  })
})

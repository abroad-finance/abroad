import 'reflect-metadata'
import { BlockchainNetwork } from '@prisma/client'

import type { IWalletHandlerFactory } from '../../../../modules/payments/application/contracts/IWalletHandlerFactory'

import { DeliveryReconciler } from '../../../../modules/flows/application/DeliveryReconciler'
import { TransactionRepository } from '../../../../modules/transactions/application/TransactionRepository'
import { createMockLogger } from '../../../setup/mockFactories'

const TX = 'dddddddd-eeee-4fff-8aaa-bbbbbbbbbbbb'
const HASH = 'db452d25f610a86080dc83b2c994e0529c4d76dd79d93d71c31da6cfdf386f8c'

const buildHarness = (opts?: {
  attempts?: Array<Record<string, unknown>>
  onChainId?: null | string
  reconcile?: jest.Mock
  step?: null | Record<string, unknown>
}) => {
  const attempt = {
    id: 'attempt-1',
    transaction: {
      id: TX,
      onChainId: opts?.onChainId ?? null,
      quote: { network: BlockchainNetwork.STELLAR },
    },
    transactionHash: HASH,
  }
  const attemptFindMany = jest.fn() as jest.Mock<
    Promise<Array<Record<string, unknown>>>,
    [{ where: { expiresAt: { lt: Date }, status: string } }]
  >
  attemptFindMany.mockResolvedValue(opts?.attempts ?? [attempt])
  const attemptUpdate = jest.fn(async () => ({}))
  const stepFindFirst = jest.fn(async () => (
    opts?.step === undefined ? { id: 'step-1', stepOrder: 1 } : opts.step
  ))
  const stepUpdate = jest.fn(async () => ({}))
  const flowUpdateMany = jest.fn(async () => ({ count: 1 }))

  const prisma = {
    deliveryAttempt: { findMany: attemptFindMany, update: attemptUpdate },
    flowInstance: { updateMany: flowUpdateMany },
    flowStepInstance: { findFirst: stepFindFirst, update: stepUpdate },
  }

  const reconcileTransaction = opts?.reconcile ?? jest.fn(async () => ({ outcome: 'absent' as const }))
  const walletHandlerFactory = {
    getWalletHandler: jest.fn(() => ({ reconcileTransaction })),
  } as unknown as IWalletHandlerFactory

  const recordOnChainIdIfMissing = jest
    .spyOn(TransactionRepository.prototype, 'recordOnChainIdIfMissing')
    .mockResolvedValue(undefined as never)

  const reconciler = new DeliveryReconciler(
    { getClient: jest.fn(async () => prisma) } as never,
    walletHandlerFactory,
    createMockLogger(),
  )

  return {
    attemptFindMany,
    attemptUpdate,
    flowUpdateMany,
    reconciler,
    reconcileTransaction,
    recordOnChainIdIfMissing,
    stepUpdate,
  }
}

describe('DeliveryReconciler', () => {
  afterEach(() => {
    jest.restoreAllMocks()
  })

  /*
   * A prepared transaction can still be included right up to its timebound, so
   * treating one as dead early risks delivering twice. Only attempts past the
   * expiry plus a clock-skew allowance are even considered.
   */
  it('only considers attempts whose expiry has passed the skew allowance', async () => {
    const { attemptFindMany, reconciler } = buildHarness()
    const now = new Date('2026-08-05T20:30:00.000Z')

    await reconciler.runOnce(now)

    const where = attemptFindMany.mock.calls[0]![0].where
    expect(where.status).toBe('SUBMITTED')
    expect(where.expiresAt.lt.getTime()).toBe(now.getTime() - 15_000)
  })

  it('settles the delivery when the chain confirms the attempt', async () => {
    const reconcile = jest.fn(async () => ({ outcome: 'confirmed' as const, transactionId: HASH }))
    const { attemptUpdate, reconciler, recordOnChainIdIfMissing, stepUpdate } = buildHarness({ reconcile })

    await reconciler.runOnce()

    expect(recordOnChainIdIfMissing).toHaveBeenCalledWith(expect.anything(), TX, HASH)
    expect(attemptUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'CONFIRMED' }),
    }))
    // A confirmed delivery must never be retried.
    expect(stepUpdate).not.toHaveBeenCalled()
  })

  /*
   * This is the state that stranded a paying customer on 2026-08-05 and needed
   * an engineer with cluster access to resolve by hand.
   */
  it('releases the step for another attempt once the hash is proved absent', async () => {
    const { attemptUpdate, flowUpdateMany, reconciler, stepUpdate } = buildHarness()

    await reconciler.runOnce()

    expect(attemptUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ failureCode: 'never_included', status: 'EXPIRED' }),
    }))
    expect(stepUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'READY' }),
    }))
    expect(flowUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'IN_PROGRESS' }),
    }))
  })

  // An unreadable chain is not evidence of absence. Guessing here would either
  // stall a delivered payment or pay a second time.
  it('leaves an attempt alone when the chain cannot be read', async () => {
    const reconcile = jest.fn(async () => ({ outcome: 'unavailable' as const, reason: 'horizon_down' }))
    const { flowUpdateMany, reconciler, stepUpdate } = buildHarness({ reconcile })

    await reconciler.runOnce()

    expect(stepUpdate).not.toHaveBeenCalled()
    expect(flowUpdateMany).not.toHaveBeenCalled()
  })

  // Whatever settled it, the delivery is done; no further attempt may run.
  it('does not retry when the transaction is already settled', async () => {
    const { reconciler, reconcileTransaction, stepUpdate } = buildHarness({ onChainId: '0xalready' })

    await reconciler.runOnce()

    expect(reconcileTransaction).not.toHaveBeenCalled()
    expect(stepUpdate).not.toHaveBeenCalled()
  })

  it('keeps going when one attempt throws', async () => {
    const reconcile = jest.fn()
      .mockRejectedValueOnce(new Error('rpc exploded'))
      .mockResolvedValueOnce({ outcome: 'confirmed', transactionId: HASH })
    const { reconciler, recordOnChainIdIfMissing } = buildHarness({
      attempts: [
        { id: 'a1', transaction: { id: 'tx-1', onChainId: null, quote: { network: 'STELLAR' } }, transactionHash: 'h1' },
        { id: 'a2', transaction: { id: 'tx-2', onChainId: null, quote: { network: 'STELLAR' } }, transactionHash: HASH },
      ],
      reconcile,
    })

    await reconciler.runOnce()

    expect(recordOnChainIdIfMissing).toHaveBeenCalledWith(expect.anything(), 'tx-2', HASH)
  })
})

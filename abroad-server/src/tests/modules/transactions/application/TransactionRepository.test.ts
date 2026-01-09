import {
  BlockchainNetwork,
  CryptoCurrency,
  PaymentMethod,
  TargetCurrency,
  TransactionStatus,
} from '@prisma/client'

import { TransactionWithRelations } from '../../../../modules/transactions/application/transactionNotificationTypes'
import { TransactionRepository } from '../../../../modules/transactions/application/TransactionRepository'

type AsyncMock<T = unknown> = jest.Mock<Promise<T>, unknown[]>

type MockTransactionClient = {
  $transaction?: jest.Mock<Promise<unknown>, [(tx: MockTransactionClient) => Promise<unknown>]>
  transaction: {
    findUnique: AsyncMock<null | TransactionWithRelations>
    update: AsyncMock<TransactionWithRelations>
    updateMany: AsyncMock<{ count: number }>
  }
  transactionTransition: {
    create: AsyncMock
    findUnique: AsyncMock<null | { context?: unknown, fromStatus?: TransactionStatus, toStatus?: TransactionStatus }>
    update: AsyncMock
    upsert: AsyncMock
  }
}

const baseTransaction: TransactionWithRelations = {
  id: 'tx-1',
  onChainId: null,
  quote: {
    cryptoCurrency: CryptoCurrency.USDC,
    network: BlockchainNetwork.STELLAR,
    paymentMethod: PaymentMethod.PIX,
    sourceAmount: 1,
    targetCurrency: TargetCurrency.BRL,
  },
  refundOnChainId: null,
  status: TransactionStatus.AWAITING_PAYMENT,
} as TransactionWithRelations

const createRepository = (client: MockTransactionClient) => {
  const provider = { getClient: jest.fn(async () => client) }
  const repository = new TransactionRepository(provider as never)
  return { provider, repository }
}

const defaultTransactionMocks = (): MockTransactionClient['transaction'] => ({
  findUnique: jest.fn<ReturnType<MockTransactionClient['transaction']['findUnique']>, unknown[]>(async () => baseTransaction),
  update: jest.fn<ReturnType<MockTransactionClient['transaction']['update']>, unknown[]>(async () => ({
    ...baseTransaction,
    status: TransactionStatus.PROCESSING_PAYMENT,
  })),
  updateMany: jest.fn<ReturnType<MockTransactionClient['transaction']['updateMany']>, unknown[]>(async () => ({ count: 1 })),
})

const defaultTransitionMocks = (): MockTransactionClient['transactionTransition'] => ({
  create: jest.fn<ReturnType<MockTransactionClient['transactionTransition']['create']>, unknown[]>(async () => ({})),
  findUnique: jest.fn<ReturnType<MockTransactionClient['transactionTransition']['findUnique']>, unknown[]>(async () => null),
  update: jest.fn<ReturnType<MockTransactionClient['transactionTransition']['update']>, unknown[]>(async () => ({})),
  upsert: jest.fn<ReturnType<MockTransactionClient['transactionTransition']['upsert']>, unknown[]>(async () => ({})),
})

const createClient = (overrides: Partial<MockTransactionClient> = {}): MockTransactionClient => ({
  $transaction: overrides.$transaction,
  transaction: {
    ...defaultTransactionMocks(),
    ...(overrides.transaction ?? {}),
  },
  transactionTransition: {
    ...defaultTransitionMocks(),
    ...(overrides.transactionTransition ?? {}),
  },
})

describe('TransactionRepository transitions', () => {
  it('returns existing transitions without reapplying', async () => {
    const client = createClient({
      transactionTransition: {
        ...defaultTransitionMocks(),
        findUnique: jest.fn(async () => ({ context: undefined, fromStatus: undefined, toStatus: undefined })),
      },
    })
    const loadResult: TransactionWithRelations = { ...baseTransaction, id: 'tx-existing' }
    client.transaction.findUnique.mockResolvedValueOnce(loadResult)
    const { repository } = createRepository(client)

    const result = await repository.applyTransition(client as never, {
      idempotencyKey: 'idem-1',
      name: 'deposit_received',
      transactionId: baseTransaction.id,
    })

    expect(result).toBe(loadResult)
    expect(client.transaction.update).not.toHaveBeenCalled()
    expect(client.transactionTransition.create).not.toHaveBeenCalled()
  })

  it('returns null when transaction is missing or transition invalid', async () => {
    const missingTxClient = createClient({
      transaction: {
        ...defaultTransactionMocks(),
        findUnique: jest.fn(async () => null),
      },
      transactionTransition: {
        ...defaultTransitionMocks(),
        findUnique: jest.fn(async () => null),
      },
    })
    const { repository: missingRepository } = createRepository(missingTxClient)

    const missingResult = await missingRepository.applyTransition(missingTxClient as never, {
      idempotencyKey: 'idem-2',
      name: 'expired',
      transactionId: 'absent',
    })
    expect(missingResult).toBeNull()

    const invalidTx = { ...baseTransaction, status: TransactionStatus.PAYMENT_COMPLETED } as TransactionWithRelations
    const invalidClient = createClient({
      transaction: {
        ...defaultTransactionMocks(),
        findUnique: jest.fn(async () => invalidTx),
      },
    })
    const { repository: invalidRepository } = createRepository(invalidClient)

    const invalidResult = await invalidRepository.applyTransition(invalidClient as never, {
      idempotencyKey: 'idem-3',
      name: 'deposit_received',
      transactionId: invalidTx.id,
    })
    expect(invalidResult).toBeNull()
    expect(invalidClient.transaction.update).not.toHaveBeenCalled()
  })

  it('applies transitions inside transactional context', async () => {
    const innerClient = createClient()
    const clientWithTransaction: MockTransactionClient = {
      ...createClient(),
      $transaction: jest.fn(async (fn: (tx: MockTransactionClient) => Promise<unknown>) => fn(innerClient)),
    }
    const { repository } = createRepository(clientWithTransaction)

    const updated = await repository.applyTransition(clientWithTransaction as never, {
      data: { onChainId: 'chain-1' },
      idempotencyKey: 'idem-4',
      name: 'deposit_received',
      transactionId: baseTransaction.id,
    })

    expect(clientWithTransaction.$transaction).toHaveBeenCalled()
    expect(innerClient.transaction.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: TransactionStatus.PROCESSING_PAYMENT }),
      where: { id: baseTransaction.id },
    }))
    expect(innerClient.transactionTransition.create).toHaveBeenCalled()
    expect(updated?.status).toBe(TransactionStatus.PROCESSING_PAYMENT)
  })
})

describe('TransactionRepository refunds', () => {
  it('records refund outcomes with and without prior transitions', async () => {
    const client = createClient()
    client.transaction.findUnique.mockResolvedValueOnce({ refundOnChainId: null, status: TransactionStatus.PROCESSING_PAYMENT } as never)
    const { repository } = createRepository(client)

    await repository.recordRefundOutcome(client as never, {
      idempotencyKey: 'refund-1',
      refundResult: { success: true, transactionId: 'on-chain-1' },
      transactionId: baseTransaction.id,
    })

    expect(client.transactionTransition.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ idempotencyKey: 'refund-1', transactionId: baseTransaction.id }),
      where: { transactionId_idempotencyKey: { idempotencyKey: 'refund-1', transactionId: baseTransaction.id } },
    }))
    expect(client.transaction.updateMany).toHaveBeenCalledWith({
      data: { refundOnChainId: 'on-chain-1' },
      where: { id: baseTransaction.id, refundOnChainId: null },
    })

    const existingContext = { attempts: 2, lastError: 'previous', status: 'failed' }
    const clientWithExisting = createClient({
      transaction: {
        ...defaultTransactionMocks(),
        findUnique: jest.fn(async () => ({ refundOnChainId: null, status: TransactionStatus.PROCESSING_PAYMENT } as never)),
      },
      transactionTransition: {
        ...defaultTransitionMocks(),
        findUnique: jest.fn(async () => ({ context: existingContext })),
      },
    })
    const { repository: repoWithExisting } = createRepository(clientWithExisting)

    await repoWithExisting.recordRefundOutcome(clientWithExisting as never, {
      idempotencyKey: 'refund-2',
      refundResult: { reason: 'downstream error', success: false },
      transactionId: baseTransaction.id,
    })

    expect(clientWithExisting.transactionTransition.upsert).toHaveBeenCalledWith(expect.objectContaining({
      update: expect.objectContaining({
        context: expect.any(Object),
        fromStatus: TransactionStatus.PROCESSING_PAYMENT,
        toStatus: TransactionStatus.PROCESSING_PAYMENT,
      }),
    }))
    expect(clientWithExisting.transaction.updateMany).not.toHaveBeenCalled()
  })

  it('reserves refunds across multiple outcomes', async () => {
    const baseClient = createClient()
    const { repository } = createRepository(baseClient)

    baseClient.transaction.findUnique.mockResolvedValueOnce(null)
    await expect(repository.reserveRefund(baseClient as never, {
      idempotencyKey: 'res-1',
      reason: 'missing',
      transactionId: 'missing',
    })).resolves.toEqual({ outcome: 'missing' })

    baseClient.transaction.findUnique.mockResolvedValueOnce({ ...baseTransaction, refundOnChainId: 'refund-123' } as never)
    await expect(repository.reserveRefund(baseClient as never, {
      idempotencyKey: 'res-2',
      reason: 'already',
      transactionId: baseTransaction.id,
    })).resolves.toEqual({ outcome: 'already_refunded', refundOnChainId: 'refund-123' })

    const pendingClient = createClient({
      transaction: {
        ...defaultTransactionMocks(),
        findUnique: jest.fn(async () => ({ ...baseTransaction, refundOnChainId: null } as never)),
      },
      transactionTransition: {
        ...defaultTransitionMocks(),
        findUnique: jest.fn(async () => null),
      },
    })
    const { repository: pendingRepository } = createRepository(pendingClient)

    await expect(pendingRepository.reserveRefund(pendingClient as never, {
      idempotencyKey: 'res-3',
      reason: 'new',
      transactionId: baseTransaction.id,
    })).resolves.toEqual({ attempts: 1, outcome: 'reserved' })

    const inflightClient = createClient({
      transaction: {
        ...defaultTransactionMocks(),
        findUnique: jest.fn(async () => ({ ...baseTransaction, refundOnChainId: null } as never)),
      },
      transactionTransition: {
        ...defaultTransitionMocks(),
        findUnique: jest.fn(async () => ({ context: { attempts: 2, status: 'pending' } })),
      },
    })
    const { repository: inflightRepository } = createRepository(inflightClient)

    await expect(inflightRepository.reserveRefund(inflightClient as never, {
      idempotencyKey: 'res-4',
      reason: 'pending',
      transactionId: baseTransaction.id,
    })).resolves.toEqual({ attempts: 2, outcome: 'in_flight' })

    const succeededClient = createClient({
      transaction: {
        ...defaultTransactionMocks(),
        findUnique: jest.fn(async () => ({ ...baseTransaction, refundOnChainId: null } as never)),
      },
      transactionTransition: {
        ...defaultTransitionMocks(),
        findUnique: jest.fn(async () => ({ context: { attempts: 3, refundTransactionId: 'context-refund', status: 'succeeded' } })),
      },
    })
    const { repository: succeededRepository } = createRepository(succeededClient)

    await expect(succeededRepository.reserveRefund(succeededClient as never, {
      idempotencyKey: 'res-5',
      reason: 'done',
      transactionId: baseTransaction.id,
    })).resolves.toEqual({
      attempts: 3,
      outcome: 'already_refunded',
      refundOnChainId: 'context-refund',
    })

    const failedClient = createClient({
      transaction: {
        ...defaultTransactionMocks(),
        findUnique: jest.fn(async () => ({ ...baseTransaction, refundOnChainId: null } as never)),
      },
      transactionTransition: {
        ...defaultTransitionMocks(),
        findUnique: jest.fn(async () => ({ context: { attempts: 1, lastError: 'before', status: 'failed' } })),
      },
    })
    const { repository: failedRepository } = createRepository(failedClient)

    await expect(failedRepository.reserveRefund(failedClient as never, {
      idempotencyKey: 'res-6',
      reason: 'retry',
      transactionId: baseTransaction.id,
      trigger: 'manual',
    })).resolves.toEqual({ attempts: 2, outcome: 'reserved' })
    expect(failedClient.transactionTransition.update).toHaveBeenCalled()
  })
})

describe('TransactionRepository helpers', () => {
  it('records exchange handoff, external IDs, and refund metadata', async () => {
    const client = createClient()
    const { repository } = createRepository(client)

    await repository.markExchangeHandoff(client as never, baseTransaction.id)
    expect(client.transaction.updateMany).toHaveBeenCalledWith({
      data: { exchangeHandoffAt: expect.any(Date) },
      where: { exchangeHandoffAt: null, id: baseTransaction.id },
    })

    await repository.persistExternalId(client as never, baseTransaction.id, 'external-1')
    expect(client.transaction.update).toHaveBeenCalledWith({
      data: { externalId: 'external-1' },
      where: { id: baseTransaction.id },
    })

    await repository.recordRefundOnChainId(client as never, baseTransaction.id, 'refund-123')
    expect(client.transaction.updateMany).toHaveBeenCalledWith({
      data: { refundOnChainId: 'refund-123' },
      where: { id: baseTransaction.id, refundOnChainId: null },
    })
  })

  it('records on-chain IDs conditionally', async () => {
    const client = createClient()
    const { repository } = createRepository(client)

    client.transaction.updateMany.mockResolvedValueOnce({ count: 1 })
    await expect(repository.recordOnChainIdIfMissing(client as never, baseTransaction.id, 'on-chain-2')).resolves.toBe(true)

    client.transaction.updateMany.mockResolvedValueOnce({ count: 0 })
    await expect(repository.recordOnChainIdIfMissing(client as never, baseTransaction.id, 'on-chain-3')).resolves.toBe(false)
  })

  it('handles client passthrough helpers', async () => {
    const client = createClient()
    const { provider, repository } = createRepository(client)

    await repository.findByExternalId('external-x')
    expect(provider.getClient).toHaveBeenCalled()
    expect(client.transaction.findUnique).toHaveBeenCalledWith(expect.objectContaining({
      where: { externalId: 'external-x' },
    }))

    await repository.updateStatus(client as never, baseTransaction.id, TransactionStatus.WRONG_AMOUNT)
    expect(client.transaction.update).toHaveBeenCalledWith(expect.objectContaining({
      data: { status: TransactionStatus.WRONG_AMOUNT },
      where: { id: baseTransaction.id },
    }))
  })
})

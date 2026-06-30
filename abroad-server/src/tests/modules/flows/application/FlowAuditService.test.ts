import 'reflect-metadata'

import type { IDatabaseClientProvider } from '../../../../platform/persistence/IDatabaseClientProvider'

import { FlowAuditService, FlowInstanceNotFoundError, FlowStepActionError } from '../../../../modules/flows/application/FlowAuditService'

type PrismaMock = {
  $transaction: jest.Mock
  flowInstance: { count: jest.Mock, findMany: jest.Mock, findUnique: jest.Mock, update: jest.Mock }
  flowStepInstance: { findFirst: jest.Mock, findUnique: jest.Mock, update: jest.Mock }
  transaction: { findFirst: jest.Mock, findMany: jest.Mock, findUnique: jest.Mock }
}

const makePrisma = (): PrismaMock => ({
  $transaction: jest.fn(async (operations: Promise<unknown>[]) => Promise.all(operations)),
  flowInstance: {
    count: jest.fn(async () => 0),
    findMany: jest.fn(async () => []),
    findUnique: jest.fn(),
    update: jest.fn(async () => ({})),
  },
  flowStepInstance: {
    findFirst: jest.fn(async () => null),
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  transaction: {
    findFirst: jest.fn(async () => null),
    findMany: jest.fn(async () => []),
    findUnique: jest.fn(),
  },
})

const makeStep = (overrides: Record<string, unknown> = {}) => ({
  attempts: 1,
  correlation: null,
  createdAt: new Date('2026-01-01'),
  endedAt: null,
  error: null,
  flowInstanceId: 'flow-1',
  id: 'step-1',
  input: null,
  maxAttempts: 3,
  output: null,
  startedAt: null,
  status: 'FAILED',
  stepOrder: 2,
  stepType: 'PAYOUT_SEND',
  updatedAt: new Date('2026-01-01'),
  ...overrides,
})

const makeService = (
  prisma: PrismaMock,
  orchestrator: { run: jest.Mock } = { run: jest.fn(async () => undefined) },
): FlowAuditService => {
  const dbProvider: IDatabaseClientProvider = {
    getClient: jest.fn(async () => prisma as unknown as import('@prisma/client').PrismaClient),
  }
  return new FlowAuditService(dbProvider, orchestrator as never)
}

describe('FlowAuditService.list on-chain id filter', () => {
  it('resolves an on-chain id to its transaction id and filters flows by it', async () => {
    const prisma = makePrisma()
    prisma.transaction.findFirst.mockResolvedValueOnce({ id: 'tx-123' })

    await makeService(prisma).list({ onChainId: '0xabc' })

    expect(prisma.transaction.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { onChainId: '0xabc' } }),
    )
    expect(prisma.flowInstance.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ transactionId: 'tx-123' }) }),
    )
  })

  it('matches no flows when no transaction has the given on-chain id', async () => {
    const prisma = makePrisma()
    prisma.transaction.findFirst.mockResolvedValueOnce(null)

    const result = await makeService(prisma).list({ onChainId: 'missing' })

    expect(prisma.flowInstance.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ transactionId: { in: [] } }) }),
    )
    expect(result.items).toEqual([])
  })
})

describe('FlowAuditService.resumeInstance', () => {
  it('retries the lowest-order FAILED step of an instance and runs the orchestrator', async () => {
    const prisma = makePrisma()
    const orchestrator = { run: jest.fn(async () => undefined) }
    prisma.flowInstance.findUnique.mockResolvedValue({ id: 'flow-1' })
    prisma.flowStepInstance.findFirst.mockResolvedValue(makeStep({ id: 'step-2', stepOrder: 3 }))
    prisma.flowStepInstance.findUnique.mockResolvedValue(makeStep({ id: 'step-2', stepOrder: 3 }))
    prisma.flowStepInstance.update.mockResolvedValue(makeStep({ id: 'step-2', status: 'READY', stepOrder: 3 }))

    const result = await makeService(prisma, orchestrator).resumeInstance('flow-1')

    expect(prisma.flowStepInstance.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: { stepOrder: 'asc' },
        where: { flowInstanceId: 'flow-1', status: 'FAILED' },
      }),
    )
    expect(result.id).toBe('step-2')
    expect(result.status).toBe('READY')
    expect(orchestrator.run).toHaveBeenCalledWith('flow-1')
  })

  it('throws when the instance does not exist', async () => {
    const prisma = makePrisma()
    prisma.flowInstance.findUnique.mockResolvedValue(null)

    await expect(makeService(prisma).resumeInstance('missing'))
      .rejects.toBeInstanceOf(FlowInstanceNotFoundError)
  })

  it('throws when the instance has no FAILED step to resume', async () => {
    const prisma = makePrisma()
    prisma.flowInstance.findUnique.mockResolvedValue({ id: 'flow-1' })
    prisma.flowStepInstance.findFirst.mockResolvedValue(null)

    await expect(makeService(prisma).resumeInstance('flow-1'))
      .rejects.toBeInstanceOf(FlowStepActionError)
  })
})

describe('FlowAuditService.bulkRetry', () => {
  it('resumes each instance and reports per-instance success and failure', async () => {
    const prisma = makePrisma()
    prisma.flowInstance.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) =>
      where.id === 'flow-bad' ? null : { id: where.id })
    prisma.flowStepInstance.findFirst.mockImplementation(async ({ where }: { where: { flowInstanceId: string } }) =>
      makeStep({ flowInstanceId: where.flowInstanceId, id: `${where.flowInstanceId}-step` }))
    prisma.flowStepInstance.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) =>
      makeStep({ flowInstanceId: where.id.replace('-step', ''), id: where.id }))
    prisma.flowStepInstance.update.mockImplementation(async ({ where }: { where: { id: string } }) =>
      makeStep({ id: where.id, status: 'READY' }))

    const results = await makeService(prisma).bulkRetry(['flow-1', 'flow-bad', 'flow-2'])

    expect(results).toEqual([
      expect.objectContaining({ flowInstanceId: 'flow-1', ok: true }),
      expect.objectContaining({ flowInstanceId: 'flow-bad', ok: false }),
      expect.objectContaining({ flowInstanceId: 'flow-2', ok: true }),
    ])
    expect(results[1].error).toBeTruthy()
  })
})

describe('FlowAuditService.resetStep force', () => {
  it('rejects a RUNNING step without the force option', async () => {
    const prisma = makePrisma()
    prisma.flowStepInstance.findUnique.mockResolvedValue(makeStep({ status: 'RUNNING' }))

    await expect(makeService(prisma).resetStep('flow-1', 'step-1', 'retry'))
      .rejects.toBeInstanceOf(FlowStepActionError)
  })

  it('force-resets a RUNNING step when force is set', async () => {
    const prisma = makePrisma()
    const orchestrator = { run: jest.fn(async () => undefined) }
    prisma.flowStepInstance.findUnique.mockResolvedValue(makeStep({ status: 'RUNNING' }))
    prisma.flowStepInstance.update.mockResolvedValue(makeStep({ status: 'READY' }))

    const result = await makeService(prisma, orchestrator).resetStep('flow-1', 'step-1', 'retry', { force: true })

    expect(result.status).toBe('READY')
    expect(orchestrator.run).toHaveBeenCalledWith('flow-1')
  })
})

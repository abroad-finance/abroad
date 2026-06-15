import 'reflect-metadata'
import { FlowStepCompletionPolicy, FlowStepStatus, FlowStepType } from '@prisma/client'

import type { IDatabaseClientProvider } from '../../../../platform/persistence/IDatabaseClientProvider'

import { FlowExecutorRegistry } from '../../../../modules/flows/application/FlowExecutorRegistry'
import { FlowOrchestrator } from '../../../../modules/flows/application/FlowOrchestrator'
import { createMockLogger } from '../../../setup/mockFactories'

type MockPrisma = {
  $queryRawUnsafe: jest.Mock
  $transaction: jest.Mock
  flowCorridor: { findFirst: jest.Mock }
  flowDefinition: { findFirst: jest.Mock }
  flowInstance: {
    create: jest.Mock
    findUnique: jest.Mock
    update: jest.Mock
    updateMany: jest.Mock
  }
  flowSignal: { create: jest.Mock, update: jest.Mock }
  flowStepInstance: {
    findFirst: jest.Mock
    findMany: jest.Mock
    update: jest.Mock
    updateMany: jest.Mock
  }
  transaction: {
    findUnique: jest.Mock
  }
}

type PrismaClientLike = Awaited<ReturnType<IDatabaseClientProvider['getClient']>>

const buildMockPrisma = (): MockPrisma => {
  const mock: MockPrisma = {
    $queryRawUnsafe: jest.fn(),
    $transaction: jest.fn(),
    flowCorridor: { findFirst: jest.fn().mockResolvedValue(null) },
    flowDefinition: { findFirst: jest.fn() },
    flowInstance: {
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    flowSignal: { create: jest.fn(), update: jest.fn() },
    flowStepInstance: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    transaction: {
      findUnique: jest.fn(),
    },
  }
  mock.$transaction.mockImplementation(async (callback: (tx: MockPrisma) => Promise<unknown>) => callback(mock))
  return mock
}

const buildFlowDefinition = () => ({
  blockchain: 'STELLAR',
  createdAt: new Date(),
  cryptoCurrency: 'USDC',
  enabled: true,
  exchangeFeePct: 0,
  fixedFee: 0,
  id: 'def-1',
  maxAmount: null,
  minAmount: null,
  name: 'Test Flow',
  payoutProvider: 'BREB',
  pricingProvider: 'BINANCE',
  steps: [
    {
      completionPolicy: FlowStepCompletionPolicy.SYNC,
      config: { paymentMethod: 'BREB' },
      createdAt: new Date(),
      flowDefinitionId: 'def-1',
      id: 'step-def-1',
      signalMatch: null,
      stepOrder: 1,
      stepType: FlowStepType.PAYOUT_SEND,
      updatedAt: new Date(),
    },
    {
      completionPolicy: FlowStepCompletionPolicy.SYNC,
      config: { provider: 'binance' },
      createdAt: new Date(),
      flowDefinitionId: 'def-1',
      id: 'step-def-2',
      signalMatch: null,
      stepOrder: 2,
      stepType: FlowStepType.EXCHANGE_SEND,
      updatedAt: new Date(),
    },
  ],
  targetCurrency: 'COP',
  updatedAt: new Date(),
  userSteps: [],
})

const buildTransaction = () => ({
  accountNumber: '3043675952',
  bankCode: '',
  externalId: null,
  id: 'tx-1',
  onChainId: 'onchain-1',
  partnerUser: { id: 'pu-1', partner: { id: 'p-1' }, partnerId: 'p-1' },
  partnerUserId: 'pu-1',
  qrCode: null,
  quote: {
    cryptoCurrency: 'USDC',
    network: 'STELLAR',
    paymentMethod: 'BREB',
    sourceAmount: 100,
    targetAmount: 350000,
    targetCurrency: 'COP',
  },
  quoteId: 'q-1',
  taxId: null,
})

describe('FlowOrchestrator', () => {
  let orchestrator: FlowOrchestrator
  let mockPrisma: MockPrisma

  beforeEach(() => {
    mockPrisma = buildMockPrisma()
    const dbProvider: IDatabaseClientProvider = {
      getClient: jest.fn(async () => mockPrisma as unknown as PrismaClientLike),
    }
    const executorRegistry = new FlowExecutorRegistry([])
    const logger = createMockLogger()
    orchestrator = new FlowOrchestrator(dbProvider, executorRegistry, logger)
  })

  describe('startFlow - step creation statuses', () => {
    it('creates the first step as READY and subsequent steps as NOT_STARTED', async () => {
      mockPrisma.flowInstance.findUnique.mockResolvedValue(null)
      mockPrisma.transaction.findUnique.mockResolvedValue(buildTransaction())
      mockPrisma.flowDefinition.findFirst.mockResolvedValue(buildFlowDefinition())
      mockPrisma.flowInstance.create.mockImplementation(async (args: { data: Record<string, unknown> }) => {
        return { id: 'fi-1', ...args.data, steps: [] }
      })
      // run() will be called after create — make it a no-op via lock skip
      mockPrisma.$queryRawUnsafe.mockResolvedValue([])

      await orchestrator.startFlow('tx-1')

      const createCall = mockPrisma.flowInstance.create.mock.calls[0][0]
      const steps = createCall.data.steps.create
      expect(steps[0].status).toBe(FlowStepStatus.READY)
      expect(steps[1].status).toBe(FlowStepStatus.NOT_STARTED)
    })
  })

  describe('run - pessimistic lock', () => {
    it('skips execution when the lock cannot be acquired', async () => {
      mockPrisma.$queryRawUnsafe.mockResolvedValue([])

      await orchestrator.run('fi-1')

      expect(mockPrisma.flowStepInstance.findFirst).not.toHaveBeenCalled()
    })

    it('proceeds with execution when the lock is acquired', async () => {
      mockPrisma.$queryRawUnsafe.mockResolvedValue([{ id: 'fi-1' }])
      mockPrisma.flowInstance.updateMany.mockResolvedValue({ count: 1 })
      mockPrisma.flowStepInstance.findFirst.mockResolvedValue(null)
      mockPrisma.flowInstance.update.mockResolvedValue({})

      await orchestrator.run('fi-1')

      expect(mockPrisma.flowStepInstance.findFirst).toHaveBeenCalled()
    })
  })

  describe('run - step promotion', () => {
    it('promotes the next step to READY after current step succeeds', async () => {
      const mockExecutor = {
        execute: jest.fn().mockResolvedValue({
          outcome: 'succeeded',
          output: { result: 'ok' },
        }),
        stepType: FlowStepType.PAYOUT_SEND,
      }
      // Recreate orchestrator with the mock executor
      const dbProvider: IDatabaseClientProvider = {
        getClient: jest.fn(async () => mockPrisma as unknown as PrismaClientLike),
      }
      const executorRegistry = new FlowExecutorRegistry(
        [mockExecutor] as unknown as ConstructorParameters<typeof FlowExecutorRegistry>[0],
      )
      orchestrator = new FlowOrchestrator(dbProvider, executorRegistry, createMockLogger())

      const flowSnapshot = {
        definition: {
          blockchain: 'STELLAR',
          cryptoCurrency: 'USDC',
          exchangeFeePct: 0,
          fixedFee: 0,
          id: 'def-1',
          maxAmount: null,
          minAmount: null,
          name: 'Test Flow',
          payoutProvider: 'BREB',
          pricingProvider: 'BINANCE',
          targetCurrency: 'COP',
        },
        steps: [
          { completionPolicy: 'SYNC', config: {}, signalMatch: null, stepOrder: 1, stepType: 'PAYOUT_SEND' },
          { completionPolicy: 'SYNC', config: {}, signalMatch: null, stepOrder: 2, stepType: 'EXCHANGE_SEND' },
        ],
      }

      mockPrisma.$queryRawUnsafe.mockResolvedValue([{ id: 'fi-1' }])
      mockPrisma.flowInstance.updateMany.mockResolvedValue({ count: 1 })

      mockPrisma.flowStepInstance.findFirst
        .mockResolvedValueOnce({
          attempts: 0, flowInstanceId: 'fi-1', id: 'fsi-1',
          maxAttempts: 3, status: FlowStepStatus.READY,
          stepOrder: 1, stepType: FlowStepType.PAYOUT_SEND,
        })
        .mockResolvedValueOnce(null)

      mockPrisma.flowStepInstance.updateMany.mockResolvedValue({ count: 1 })

      mockPrisma.flowInstance.findUnique.mockResolvedValue({
        flowSnapshot: JSON.parse(JSON.stringify(flowSnapshot)),
        id: 'fi-1',
        steps: [],
        transactionId: 'tx-1',
      })
      mockPrisma.transaction.findUnique.mockResolvedValue(buildTransaction())

      mockPrisma.flowStepInstance.update.mockResolvedValue({})
      mockPrisma.flowInstance.update.mockResolvedValue({})

      await orchestrator.run('fi-1')

      const promotionCalls = mockPrisma.flowStepInstance.updateMany.mock.calls
      const promotionCall = promotionCalls.find(call =>
        call[0].data?.status === FlowStepStatus.READY
        && call[0].where?.stepOrder === 2
        && call[0].where?.status === FlowStepStatus.NOT_STARTED,
      )
      expect(promotionCall).toBeDefined()
    })
  })
})

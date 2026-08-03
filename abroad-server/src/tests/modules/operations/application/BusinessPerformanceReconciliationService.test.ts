import {
  BlockchainNetwork,
  CryptoCurrency,
  EconomicConversionStatus,
  EconomicFactCoverageStatus,
  FlowStepStatus,
  FlowStepType,
  PaymentMethod,
  Prisma,
  TargetCurrency,
  TransactionEconomicCostKind,
  TransactionEconomicCostStatus,
  TransactionStatus,
} from '@prisma/client'

import { ILogger } from '../../../../core/logging/types'
import { BusinessPerformanceCostReconciler } from '../../../../modules/operations/application/BusinessPerformanceCostReconciler'
import { BusinessPerformanceReconciliationService } from '../../../../modules/operations/application/BusinessPerformanceReconciliationService'
import { BusinessPerformanceCandidate, BusinessPerformanceClient } from '../../../../modules/operations/application/BusinessPerformanceReconciliationTypes'
import { IPaymentServiceFactory } from '../../../../modules/payments/application/contracts/IPaymentServiceFactory'
import { IWalletHandlerFactory } from '../../../../modules/payments/application/contracts/IWalletHandlerFactory'
import { IExchangeProviderFactory } from '../../../../modules/treasury/application/contracts/IExchangeProviderFactory'
import { IDatabaseClientProvider } from '../../../../platform/persistence/IDatabaseClientProvider'

describe('BusinessPerformanceReconciliationService', () => {
  it('uses the same deterministic upsert identities across duplicate reconciliation', async () => {
    const candidate = {
      createdAt: new Date('2026-08-01T00:00:00.000Z'),
      economics: null,
      externalId: null,
      id: 'transaction-1',
      quote: {
        cryptoCurrency: CryptoCurrency.USDC,
        network: BlockchainNetwork.STELLAR,
        paymentMethod: PaymentMethod.PIX,
        sourceAmount: 10,
        targetAmount: 50,
        targetCurrency: TargetCurrency.BRL,
      },
      refundOnChainId: null,
      status: TransactionStatus.PAYMENT_FAILED,
      transitions: [],
    }
    const costUpsert = jest.fn().mockResolvedValue({})
    const client = {
      bridgePendingTransfer: { findFirst: jest.fn().mockResolvedValue(null) },
      businessPerformanceState: { upsert: jest.fn().mockResolvedValue({}) },
      flowInstance: { findUnique: jest.fn().mockResolvedValue(null) },
      transaction: {
        findMany: jest.fn()
          .mockResolvedValueOnce([candidate])
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([candidate])
          .mockResolvedValueOnce([]),
      },
      transactionEconomicCost: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: costUpsert,
      },
      transactionEconomics: {
        update: jest.fn().mockResolvedValue({}),
        upsert: jest.fn().mockResolvedValue({}),
      },
    }
    const service = new BusinessPerformanceReconciliationService(
      { getClient: jest.fn().mockResolvedValue(client) } as unknown as IDatabaseClientProvider,
      { getExchangeProviderById: jest.fn() } as unknown as IExchangeProviderFactory,
      new BusinessPerformanceCostReconciler(
        { getPaymentService: jest.fn() } as unknown as IPaymentServiceFactory,
        { getWalletHandler: jest.fn() } as unknown as IWalletHandlerFactory,
      ),
      { error: jest.fn(), info: jest.fn(), warn: jest.fn() } as ILogger,
    )

    await service.runBatch()
    await service.runBatch()

    expect(client.transactionEconomics.upsert).toHaveBeenCalledTimes(2)
    expect(client.transactionEconomics.upsert).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ where: { transactionId: candidate.id } }),
    )
    expect(client.transactionEconomics.upsert).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ where: { transactionId: candidate.id } }),
    )
    expect(client.transactionEconomics.upsert).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        update: expect.not.objectContaining({ customerPayoutNative: expect.anything() }),
      }),
    )
    expect(client.businessPerformanceState.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.not.objectContaining({ quoteMetricsFrom: expect.anything() }),
    }))
    const operationIdentities = costUpsert.mock.calls.map(([call]) => (
      JSON.stringify(call.where.transactionId_kind_operationKey)
    ))
    expect(new Set(operationIdentities).size).toBe(4)
    expect(operationIdentities).toHaveLength(8)
  })

  it('converts a pending BRL provider fee with the transaction locked rate', async () => {
    const candidate = {
      createdAt: new Date('2026-08-01T00:00:00.000Z'),
      economics: {
        conversionStatus: EconomicConversionStatus.SETTLED,
        lastReconciledAt: null,
        lockedRateNativePerUsd: new Prisma.Decimal(5),
        proceedsCoverage: EconomicFactCoverageStatus.COMPLETE,
        providerOperationId: null,
        providerProceedsNative: new Prisma.Decimal(51),
      },
      externalId: null,
      id: 'transaction-locked-rate',
      quote: {
        cryptoCurrency: CryptoCurrency.USDC,
        network: BlockchainNetwork.STELLAR,
        paymentMethod: PaymentMethod.PIX,
        sourceAmount: 10,
        targetAmount: 50,
        targetCurrency: TargetCurrency.BRL,
      },
      refundOnChainId: null,
      status: TransactionStatus.PAYMENT_COMPLETED,
      transitions: [],
    }
    const costUpdate = jest.fn().mockResolvedValue({})
    const pendingPayoutCost = {
      nativeAmount: new Prisma.Decimal(5),
      nativeCurrency: 'BRL',
      status: TransactionEconomicCostStatus.PENDING,
    }
    const client = {
      bridgePendingTransfer: { findFirst: jest.fn().mockResolvedValue(null) },
      businessPerformanceState: { upsert: jest.fn().mockResolvedValue({}) },
      flowInstance: {
        findUnique: jest.fn().mockResolvedValue({ flowSnapshot: { steps: [] }, steps: [] }),
      },
      transaction: {
        findMany: jest.fn().mockResolvedValueOnce([candidate]).mockResolvedValueOnce([]),
      },
      transactionEconomicCost: {
        findMany: jest.fn().mockResolvedValue([{
          id: 'payout-cost',
          kind: TransactionEconomicCostKind.PAYOUT_PROVIDER_FEE,
          nativeAmount: pendingPayoutCost.nativeAmount,
          nativeCurrency: pendingPayoutCost.nativeCurrency,
          observedAt: candidate.createdAt,
          status: pendingPayoutCost.status,
        }]),
        findUnique: jest.fn().mockImplementation((input: {
          where: {
            transactionId_kind_operationKey: { kind: TransactionEconomicCostKind }
          }
        }) => {
          const { where } = input
          const kind = where.transactionId_kind_operationKey.kind as TransactionEconomicCostKind
          return Promise.resolve(kind === TransactionEconomicCostKind.PAYOUT_PROVIDER_FEE
            ? pendingPayoutCost
            : { status: TransactionEconomicCostStatus.VOID })
        }),
        update: costUpdate,
        upsert: jest.fn().mockResolvedValue({}),
      },
      transactionEconomics: {
        findUnique: jest.fn().mockResolvedValue({ lockedRateNativePerUsd: new Prisma.Decimal(5) }),
        update: jest.fn().mockResolvedValue({}),
        upsert: jest.fn().mockResolvedValue({}),
      },
    }
    const service = new BusinessPerformanceReconciliationService(
      { getClient: jest.fn().mockResolvedValue(client) } as unknown as IDatabaseClientProvider,
      { getExchangeProviderById: jest.fn() } as unknown as IExchangeProviderFactory,
      new BusinessPerformanceCostReconciler(
        { getPaymentService: jest.fn() } as unknown as IPaymentServiceFactory,
        { getWalletHandler: jest.fn() } as unknown as IWalletHandlerFactory,
      ),
      { error: jest.fn(), info: jest.fn(), warn: jest.fn() } as ILogger,
    )

    await service.runBatch()

    const update = costUpdate.mock.calls[0]?.[0] as undefined | {
      data: {
        status: TransactionEconomicCostStatus
        usdAmount: Prisma.Decimal
        usdRate: Prisma.Decimal
      }
      where: { id: string }
    }
    expect(update).toEqual(expect.objectContaining({
      data: expect.objectContaining({ status: TransactionEconomicCostStatus.CONFIRMED }),
      where: { id: 'payout-cost' },
    }))
    expect(update?.data.usdAmount.toString()).toBe('1')
    expect(update?.data.usdRate.toString()).toBe('0.2')
  })

  it('allocates a submitted bridge fee by the transaction share of the batch', async () => {
    const candidate = {
      createdAt: new Date('2026-08-01T00:00:00.000Z'),
      economics: null,
      externalId: null,
      id: 'transaction-bridge-cost',
      quote: {
        cryptoCurrency: CryptoCurrency.USDC,
        network: BlockchainNetwork.STELLAR,
        paymentMethod: PaymentMethod.PIX,
        sourceAmount: 25,
        targetAmount: 125,
        targetCurrency: TargetCurrency.BRL,
      },
      refundOnChainId: null,
      status: TransactionStatus.PAYMENT_COMPLETED,
      transitions: [],
    } as BusinessPerformanceCandidate
    const costUpsert = jest.fn().mockResolvedValue({})
    const client = {
      bridgePendingTransfer: {
        findFirst: jest.fn().mockResolvedValue({
          amount: 25,
          batch: {
            asset: CryptoCurrency.USDC,
            grossAmount: 100,
            settledAt: null,
            status: 'SUBMITTED',
            updatedAt: new Date('2026-08-01T00:10:00.000Z'),
            withdrawFee: 1,
            withdrawId: 'provider-withdrawal-id',
          },
          createdAt: new Date('2026-08-01T00:05:00.000Z'),
        }),
      },
      transactionEconomicCost: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue({ status: TransactionEconomicCostStatus.VOID }),
        upsert: costUpsert,
      },
    } as unknown as BusinessPerformanceClient
    const reconciler = new BusinessPerformanceCostReconciler(
      { getPaymentService: jest.fn() } as unknown as IPaymentServiceFactory,
      { getWalletHandler: jest.fn() } as unknown as IWalletHandlerFactory,
    )

    await reconciler.reconcile({
      candidate,
      client,
      configuredProvider: 'transfero',
      steps: [],
    })

    const bridgeWrite = costUpsert.mock.calls.find(([call]) => (
      call.create.kind === TransactionEconomicCostKind.BRIDGE_FEE
    ))?.[0]
    expect(bridgeWrite).toMatchObject({
      create: {
        nativeCurrency: CryptoCurrency.USDC,
        status: TransactionEconomicCostStatus.CONFIRMED,
      },
    })
    expect(bridgeWrite?.create.nativeAmount.toString()).toBe('0.25')
    expect(bridgeWrite?.create.usdAmount.toString()).toBe('0.25')
  })

  it('does not reread an Ultra trade after settlement was durably reconciled', async () => {
    const providerOperationId = '11111111-1111-4111-8111-111111111111'
    const candidate = {
      createdAt: new Date('2026-08-01T00:00:00.000Z'),
      economics: {
        conversionStatus: EconomicConversionStatus.SETTLED,
        lastReconciledAt: null,
        lockedRateNativePerUsd: new Prisma.Decimal(5),
        proceedsCoverage: EconomicFactCoverageStatus.COMPLETE,
        providerOperationId,
        providerProceedsNative: new Prisma.Decimal(51),
      },
      externalId: null,
      id: 'transaction-settled',
      quote: {
        cryptoCurrency: CryptoCurrency.USDC,
        network: BlockchainNetwork.STELLAR,
        paymentMethod: PaymentMethod.PIX,
        sourceAmount: 10,
        targetAmount: 50,
        targetCurrency: TargetCurrency.BRL,
      },
      refundOnChainId: null,
      status: TransactionStatus.PAYMENT_COMPLETED,
      transitions: [],
    }
    const getExchangeProviderById = jest.fn()
    const client = {
      bridgePendingTransfer: { findFirst: jest.fn().mockResolvedValue(null) },
      businessPerformanceState: { upsert: jest.fn().mockResolvedValue({}) },
      flowInstance: {
        findUnique: jest.fn().mockResolvedValue({
          flowSnapshot: {
            steps: [{
              config: { provider: 'transfero' },
              stepOrder: 1,
              stepType: 'EXCHANGE_CONVERT',
            }],
          },
          steps: [{
            endedAt: new Date('2026-08-01T00:05:00.000Z'),
            output: { amount: 10, provider: 'transfero' },
            status: FlowStepStatus.SUCCEEDED,
            stepOrder: 1,
            stepType: FlowStepType.EXCHANGE_CONVERT,
          }],
        }),
      },
      transaction: {
        findMany: jest.fn().mockResolvedValueOnce([candidate]).mockResolvedValueOnce([]),
      },
      transactionEconomicCost: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue({ status: TransactionEconomicCostStatus.VOID }),
        upsert: jest.fn().mockResolvedValue({}),
      },
      transactionEconomics: {
        update: jest.fn().mockResolvedValue({}),
        upsert: jest.fn().mockResolvedValue({}),
      },
    }
    const service = new BusinessPerformanceReconciliationService(
      { getClient: jest.fn().mockResolvedValue(client) } as unknown as IDatabaseClientProvider,
      { getExchangeProviderById } as unknown as IExchangeProviderFactory,
      new BusinessPerformanceCostReconciler(
        { getPaymentService: jest.fn() } as unknown as IPaymentServiceFactory,
        { getWalletHandler: jest.fn() } as unknown as IWalletHandlerFactory,
      ),
      { error: jest.fn(), info: jest.fn(), warn: jest.fn() } as ILogger,
    )

    await service.runBatch()

    expect(getExchangeProviderById).not.toHaveBeenCalled()
  })
})

import { EconomicConversionStatus, EconomicFactCoverageStatus, FlowStepStatus, FlowStepType } from '@prisma/client'
import { inject, injectable } from 'inversify'

import { TYPES } from '../../../app/container/types'
import { createScopedLogger, ScopedLogger } from '../../../core/logging/scopedLogger'
import { ILogger } from '../../../core/logging/types'
import { IDatabaseClientProvider } from '../../../platform/persistence/IDatabaseClientProvider'
import { IExchangeProviderFactory } from '../../treasury/application/contracts/IExchangeProviderFactory'
import { BusinessPerformanceCostReconciler } from './BusinessPerformanceCostReconciler'
import { businessPerformanceFlowSnapshotSchema, businessPerformanceSettlementOutputSchema } from './BusinessPerformanceFlowSchemas'
import {
  BusinessPerformanceCandidate,
  businessPerformanceCandidateSelect,
  BusinessPerformanceClient,
  BusinessPerformanceFlowStep,
  toBusinessPerformanceDecimal,
} from './BusinessPerformanceReconciliationTypes'

const BATCH_SIZE = 25
const RECONCILE_AFTER_MS = 6 * 60 * 60_000

/**
 * Normalizes durable flow/provider facts into the exact reporting journal.
 * Provider reads are bounded, read-only, and run only in the worker process;
 * report requests never invoke this service or any external dependency.
 */
@injectable()
export class BusinessPerformanceReconciliationService {
  private readonly logger: ScopedLogger

  public constructor(
    @inject(TYPES.IDatabaseClientProvider)
    private readonly dbProvider: IDatabaseClientProvider,
    @inject(TYPES.IExchangeProviderFactory)
    private readonly exchangeProviderFactory: IExchangeProviderFactory,
    @inject(BusinessPerformanceCostReconciler)
    private readonly costReconciler: BusinessPerformanceCostReconciler,
    @inject(TYPES.ILogger)
    baseLogger: ILogger,
  ) {
    this.logger = createScopedLogger(baseLogger, { scope: 'BusinessPerformanceReconciliation' })
  }

  public async runBatch(): Promise<{ complete: boolean, processed: number }> {
    const client = await this.dbProvider.getClient()
    const cutoff = new Date(Date.now() - RECONCILE_AFTER_MS)
    const backfillCandidates = await client.transaction.findMany({
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      select: businessPerformanceCandidateSelect,
      take: BATCH_SIZE,
      where: {
        OR: [
          { economics: { is: null } },
          { economics: { is: { lastReconciledAt: null } } },
        ],
      },
    })
    const staleCandidates = backfillCandidates.length < BATCH_SIZE
      ? await client.transaction.findMany({
          orderBy: [{ economics: { lastReconciledAt: 'asc' } }, { id: 'asc' }],
          select: businessPerformanceCandidateSelect,
          take: BATCH_SIZE - backfillCandidates.length,
          where: { economics: { is: { lastReconciledAt: { lt: cutoff } } } },
        })
      : []
    const candidates = [...backfillCandidates, ...staleCandidates]

    let processed = 0
    for (const candidate of candidates) {
      try {
        await this.reconcileTransaction(client, candidate)
        processed += 1
      }
      catch (error) {
        this.logger.warn('Business performance transaction reconciliation failed', {
          error: error instanceof Error ? error.message : 'unknown_error',
          transactionId: candidate.id,
        })
        await this.deferCandidate(client, candidate)
      }
    }

    const now = new Date()
    const complete = backfillCandidates.length < BATCH_SIZE
    await client.businessPerformanceState.upsert({
      create: {
        ...(complete ? { backfillCompletedAt: now } : {}),
        id: 'singleton',
        lastReconciledAt: now,
      },
      update: {
        ...(complete ? { backfillCompletedAt: now } : {}),
        lastReconciledAt: now,
      },
      where: { id: 'singleton' },
    })
    return { complete, processed }
  }

  private async deferCandidate(
    client: BusinessPerformanceClient,
    candidate: BusinessPerformanceCandidate,
  ): Promise<void> {
    try {
      await client.transactionEconomics.upsert({
        create: {
          customerPayoutNative: toBusinessPerformanceDecimal(candidate.quote.targetAmount),
          lastReconciledAt: new Date(),
          payoutCurrency: candidate.quote.targetCurrency,
          sourceAmountUsd: toBusinessPerformanceDecimal(candidate.quote.sourceAmount),
          sourceCurrency: candidate.quote.cryptoCurrency,
          transactionId: candidate.id,
        },
        update: { lastReconciledAt: new Date() },
        where: { transactionId: candidate.id },
      })
    }
    catch (persistenceError) {
      this.logger.error('Business performance reconciliation deferral failed', {
        error: persistenceError instanceof Error ? persistenceError.message : 'unknown_error',
        transactionId: candidate.id,
      })
    }
  }

  private async reconcileTransaction(
    client: BusinessPerformanceClient,
    candidate: BusinessPerformanceCandidate,
  ): Promise<void> {
    const flow = await client.flowInstance.findUnique({
      select: {
        flowSnapshot: true,
        steps: {
          orderBy: { stepOrder: 'asc' },
          select: {
            endedAt: true,
            output: true,
            status: true,
            stepOrder: true,
            stepType: true,
          },
        },
      },
      where: { transactionId: candidate.id },
    })
    const snapshot = businessPerformanceFlowSnapshotSchema.safeParse(flow?.flowSnapshot)
    const configuredConversion = snapshot.success
      ? snapshot.data.steps.find(step => step.stepType === FlowStepType.EXCHANGE_CONVERT)
      : undefined
    const configuredProvider = typeof configuredConversion?.config.provider === 'string'
      ? configuredConversion.config.provider
      : undefined

    await client.transactionEconomics.upsert({
      create: {
        conversionProvider: configuredProvider,
        conversionStatus: configuredProvider
          ? EconomicConversionStatus.PENDING
          : EconomicConversionStatus.NOT_APPLICABLE,
        customerPayoutNative: toBusinessPerformanceDecimal(candidate.quote.targetAmount),
        payoutCurrency: candidate.quote.targetCurrency,
        proceedsCoverage: configuredProvider
          ? EconomicFactCoverageStatus.PENDING
          : EconomicFactCoverageStatus.UNAVAILABLE,
        proceedsUnavailableReason: configuredProvider ? undefined : 'conversion_not_configured',
        sourceAmountUsd: toBusinessPerformanceDecimal(candidate.quote.sourceAmount),
        sourceCurrency: candidate.quote.cryptoCurrency,
        transactionId: candidate.id,
      },
      update: {
        conversionProvider: configuredProvider,
        payoutCurrency: candidate.quote.targetCurrency,
        sourceAmountUsd: toBusinessPerformanceDecimal(candidate.quote.sourceAmount),
        sourceCurrency: candidate.quote.cryptoCurrency,
      },
      where: { transactionId: candidate.id },
    })

    const conversionStep = configuredConversion
      ? flow?.steps.find(step => step.stepOrder === configuredConversion.stepOrder)
      : undefined
    if (configuredProvider === 'transfero') {
      await this.reconcileUltraConversion(client, candidate, conversionStep)
    }
    else if (configuredProvider) {
      await this.reconcileUnsupportedConversion(client, candidate.id, conversionStep)
    }

    await this.costReconciler.reconcile({
      candidate,
      client,
      configuredProvider,
      steps: (flow?.steps ?? []) satisfies BusinessPerformanceFlowStep[],
    })
    await client.transactionEconomics.update({
      data: { lastReconciledAt: new Date() },
      where: { transactionId: candidate.id },
    })
  }

  private async reconcileUltraConversion(
    client: BusinessPerformanceClient,
    candidate: BusinessPerformanceCandidate,
    step: BusinessPerformanceFlowStep | undefined,
  ): Promise<void> {
    const output = businessPerformanceSettlementOutputSchema.safeParse(step?.output)
    const reconciliation = output.success ? output.data.reconciliation : undefined
    const expectedAmount = output.success ? output.data.amount : candidate.quote.sourceAmount
    let economics = reconciliation?.economics ?? (
      candidate.economics?.lockedRateNativePerUsd
      && candidate.economics.providerProceedsNative
        ? {
            lockedRateNativePerUsd: candidate.economics.lockedRateNativePerUsd.toString(),
            payoutCurrency: candidate.quote.targetCurrency,
            providerProceedsNative: candidate.economics.providerProceedsNative.toString(),
          }
        : undefined
    )
    let settledSourceAmount = reconciliation?.settledSourceAmount
      ?? (candidate.economics?.conversionStatus === EconomicConversionStatus.SETTLED
        ? String(expectedAmount)
        : undefined)
    let authoritativeReadSucceeded = false
    let reconciliationReason: string | undefined
    const providerOperationId = reconciliation?.providerOperationId
      ?? candidate.economics?.providerOperationId
    const settlementCoversExpectedAmount = settledSourceAmount !== undefined
      && toBusinessPerformanceDecimal(settledSourceAmount)
        .plus('0.00000001')
        .gte(toBusinessPerformanceDecimal(expectedAmount))

    if (
      providerOperationId
      && (!economics || !settlementCoversExpectedAmount)
      && candidate.economics?.proceedsCoverage !== EconomicFactCoverageStatus.UNAVAILABLE
    ) {
      const provider = this.exchangeProviderFactory.getExchangeProviderById('transfero')
      const facts = await provider.getSettlementFacts?.({
        providerOperationId,
        requestedAmount: expectedAmount,
        sourceCurrency: candidate.quote.cryptoCurrency,
      })
      if (facts?.success) {
        authoritativeReadSucceeded = true
        economics = facts.economics ?? economics
        settledSourceAmount = facts.settledSourceAmount
      }
      else {
        reconciliationReason = facts?.reason ?? 'provider_settlement_reader_unavailable'
      }
    }

    const settled = settledSourceAmount !== undefined
      && toBusinessPerformanceDecimal(settledSourceAmount)
        .plus('0.00000001')
        .gte(toBusinessPerformanceDecimal(expectedAmount))
    const conversionStatus = settled
      ? EconomicConversionStatus.SETTLED
      : step?.status === FlowStepStatus.FAILED
        ? EconomicConversionStatus.FAILED
        : EconomicConversionStatus.PENDING
    const proceedsCoverage = economics
      ? EconomicFactCoverageStatus.COMPLETE
      : settled && authoritativeReadSucceeded
        ? EconomicFactCoverageStatus.UNAVAILABLE
        : EconomicFactCoverageStatus.PENDING

    await client.transactionEconomics.update({
      data: {
        conversionProvider: 'transfero',
        conversionStatus,
        lockedRateNativePerUsd: economics
          ? toBusinessPerformanceDecimal(economics.lockedRateNativePerUsd)
          : undefined,
        proceedsCoverage,
        proceedsUnavailableReason: proceedsCoverage === EconomicFactCoverageStatus.UNAVAILABLE
          ? 'provider_trade_detail_omits_economics'
          : proceedsCoverage === EconomicFactCoverageStatus.PENDING
            ? reconciliationReason ?? (providerOperationId
              ? 'provider_settlement_pending'
              : 'provider_operation_pending')
            : null,
        providerOperationId,
        providerProceedsNative: economics
          ? toBusinessPerformanceDecimal(economics.providerProceedsNative)
          : undefined,
        settledAt: settled ? step?.endedAt ?? new Date() : null,
      },
      where: { transactionId: candidate.id },
    })
  }

  private async reconcileUnsupportedConversion(
    client: BusinessPerformanceClient,
    transactionId: string,
    step: BusinessPerformanceFlowStep | undefined,
  ): Promise<void> {
    await client.transactionEconomics.update({
      data: {
        conversionStatus: step?.status === FlowStepStatus.SUCCEEDED
          ? EconomicConversionStatus.SETTLED
          : step?.status === FlowStepStatus.FAILED
            ? EconomicConversionStatus.FAILED
            : EconomicConversionStatus.PENDING,
        proceedsCoverage: EconomicFactCoverageStatus.UNAVAILABLE,
        proceedsUnavailableReason: 'non_ultra_economics_not_supported',
        settledAt: step?.status === FlowStepStatus.SUCCEEDED ? step.endedAt : null,
      },
      where: { transactionId },
    })
  }
}

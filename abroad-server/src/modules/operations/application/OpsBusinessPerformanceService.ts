import { QuoteRequestOutcome } from '@prisma/client'
import { inject, injectable } from 'inversify'

import { TYPES } from '../../../app/container/types'
import { IDatabaseClientProvider } from '../../../platform/persistence/IDatabaseClientProvider'
import { buildOpsBusinessPerformanceMetrics } from './OpsBusinessPerformanceMetrics'
import { performanceTransactionSelect, summarizeBusinessPerformancePeriod } from './OpsBusinessPerformancePeriod'
import { OpsBusinessPerformanceCoverageStatus, OpsBusinessPerformancePeriodFacts, OpsBusinessPerformanceRange, OpsBusinessPerformanceResponse } from './OpsBusinessPerformanceTypes'

const RECONCILIATION_STALE_MS = 15 * 60_000

/**
 * Produces a provider-free, aggregate-only operating and transaction-economics
 * report. All range predicates are half-open UTC instants supplied by the
 * controller; external reconciliation is deliberately owned by the worker.
 */
@injectable()
export class OpsBusinessPerformanceService {
  public constructor(
    @inject(TYPES.IDatabaseClientProvider)
    private readonly dbProvider: IDatabaseClientProvider,
  ) {}

  public async getReport(params: {
    comparison: OpsBusinessPerformanceRange
    primary: OpsBusinessPerformanceRange
  }): Promise<OpsBusinessPerformanceResponse> {
    const client = await this.dbProvider.getClient()
    const generatedAt = new Date()
    const state = await client.businessPerformanceState.findUnique({ where: { id: 'singleton' } })
    const quoteMetricsFrom = state?.quoteMetricsFrom ?? null
    const effectiveQuoteMetricsFrom = quoteMetricsFrom ?? generatedAt

    const [currentFacts, comparisonFacts] = await Promise.all([
      this.readPeriod(client, params.primary, effectiveQuoteMetricsFrom),
      this.readPeriod(client, params.comparison, effectiveQuoteMetricsFrom),
    ])
    const earningsCoverage = this.buildEarningsCoverage({
      comparisonFacts,
      currentFacts,
      generatedAt,
      state: {
        historicalBackfillCompletedAt: state?.backfillCompletedAt ?? null,
        reconciledAt: state?.lastReconciledAt ?? null,
      },
    })

    return {
      comparison: comparisonFacts.summary,
      coverage: {
        earnings: earningsCoverage.earnings,
        economicFactsReconciledAt: earningsCoverage.reconciledAt,
        quotes: {
          complete: quoteMetricsFrom !== null
            && params.primary.from >= quoteMetricsFrom
            && params.comparison.from >= quoteMetricsFrom,
          from: quoteMetricsFrom,
          pendingRequestCount: currentFacts.pendingQuoteRequestCount
            + comparisonFacts.pendingQuoteRequestCount,
          warnings: quoteMetricsFrom === null
            ? ['Quote-attempt coverage has not started.']
            : params.primary.from < quoteMetricsFrom || params.comparison.from < quoteMetricsFrom
              ? ['Quote failures before the quote-attempt coverage boundary are unavailable.']
              : [],
        },
      },
      current: currentFacts.summary,
      generatedAt,
      metrics: buildOpsBusinessPerformanceMetrics(currentFacts.summary, comparisonFacts.summary),
      ranges: params,
    }
  }

  private buildEarningsCoverage(params: {
    comparisonFacts: OpsBusinessPerformancePeriodFacts
    currentFacts: OpsBusinessPerformancePeriodFacts
    generatedAt: Date
    state: {
      historicalBackfillCompletedAt: Date | null
      reconciledAt: Date | null
    }
  }): {
    earnings: OpsBusinessPerformanceResponse['coverage']['earnings']
    reconciledAt: Date | null
  } {
    const warnings = new Set([
      ...params.comparisonFacts.warnings,
      ...params.currentFacts.warnings,
    ])
    const missingCostCount = params.currentFacts.missingCostCount
      + params.comparisonFacts.missingCostCount
    const missingEconomicFactCount = params.currentFacts.missingEconomicFactCount
      + params.comparisonFacts.missingEconomicFactCount
    const excludedCompletedPayoutCount = params.currentFacts.summary.excludedCompletedPayouts.count
      + params.comparisonFacts.summary.excludedCompletedPayouts.count
    const realizedTransactionCount = params.currentFacts.realizedTransactionCount
      + params.comparisonFacts.realizedTransactionCount
    const reconciliationIsFresh = params.state.reconciledAt !== null
      && params.generatedAt.getTime() - params.state.reconciledAt.getTime() <= RECONCILIATION_STALE_MS

    if (!params.state.historicalBackfillCompletedAt) {
      warnings.add('Historical economic-fact backfill is still in progress.')
    }
    if (!reconciliationIsFresh) {
      warnings.add('Economic facts have not been reconciled within the last 15 minutes.')
    }
    const status: OpsBusinessPerformanceCoverageStatus = missingCostCount === 0
      && missingEconomicFactCount === 0
      && excludedCompletedPayoutCount === 0
      && params.state.historicalBackfillCompletedAt !== null
      && reconciliationIsFresh
      ? 'COMPLETE'
      : realizedTransactionCount > 0 ? 'PARTIAL' : 'UNAVAILABLE'

    return {
      earnings: {
        historicalBackfillCompletedAt: params.state.historicalBackfillCompletedAt,
        missingCostCount,
        missingEconomicFactCount,
        status,
        warnings: [...warnings],
      },
      reconciledAt: params.state.reconciledAt,
    }
  }

  private async readPeriod(
    client: Awaited<ReturnType<IDatabaseClientProvider['getClient']>>,
    range: OpsBusinessPerformanceRange,
    quoteMetricsFrom: Date,
  ): Promise<OpsBusinessPerformancePeriodFacts> {
    const historicalQuoteTo = range.to < quoteMetricsFrom ? range.to : quoteMetricsFrom
    const metricFrom = range.from > quoteMetricsFrom ? range.from : quoteMetricsFrom
    const [transactions, historicalSuccessfulQuotes, quoteMetricGroups] = await Promise.all([
      client.transaction.findMany({
        select: performanceTransactionSelect,
        where: { createdAt: { gte: range.from, lt: range.to } },
      }),
      range.from < historicalQuoteTo
        ? client.quote.count({ where: { createdAt: { gte: range.from, lt: historicalQuoteTo } } })
        : Promise.resolve(0),
      metricFrom < range.to
        ? client.quoteRequestMetric.groupBy({
            _count: { _all: true },
            by: ['outcome'],
            where: { requestedAt: { gte: metricFrom, lt: range.to } },
          })
        : Promise.resolve([]),
    ])
    const recordedSuccessfulQuotes = quoteMetricGroups.find(
      group => group.outcome === QuoteRequestOutcome.SUCCESS,
    )?._count._all ?? 0

    return summarizeBusinessPerformancePeriod({
      quoteMetricGroups,
      successfulQuotes: historicalSuccessfulQuotes + recordedSuccessfulQuotes,
      transactions,
    })
  }
}

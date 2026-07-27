import 'reflect-metadata'

import { TransparencyMetricsService } from '../../../../../modules/transparency/application/TransparencyMetricsService'
import { TransparencyMetricsController } from '../../../../../modules/transparency/interfaces/http/TransparencyMetricsController'

describe('TransparencyMetricsController', () => {
  it('returns service metrics with public revalidation headers', async () => {
    const response = {
      generatedAt: '2026-07-27T12:00:00.000Z',
      openSource: {
        asOf: null,
        cache: 'unavailable' as const,
        commitsLast90Days: null,
        contributors: null,
        defaultBranch: null,
        forks: null,
        openIssues: null,
        openPullRequests: null,
        pushedAt: null,
        repository: 'abroad-finance/abroad',
        stars: null,
      },
      platform: {
        cache: 'fresh' as const,
        coverage: {
          corridors: 0,
          networks: [],
          payoutCurrencies: [],
          payoutMethods: [],
          sourceAssets: [],
        },
        dailyOutcomes: [],
        generatedAt: '2026-07-27T12:00:00.000Z',
        rolling30Days: {
          acceptedTransactions: 0,
          activePartnerOrganizations: 0,
          activeUserRecords: 0,
          completedSourceVolume: [],
          completedTransactions: 0,
          completionRate: null,
          statusBreakdown: [],
        },
        totals: {
          acceptedTransactions: 0,
          completedSourceVolume: [],
          completedTransactions: 0,
          completionRate: null,
          partnerOrganizations: 0,
          statusBreakdown: [],
          userRecords: 0,
        },
      },
      refreshAfterSeconds: 60,
      schemaVersion: '1.0' as const,
    }
    const metricsService = {
      getMetrics: jest.fn(async () => response),
    } as unknown as TransparencyMetricsService
    const controller = new TransparencyMetricsController(metricsService)
    const setHeader = jest.spyOn(controller, 'setHeader')

    await expect(controller.getMetrics()).resolves.toEqual(response)
    expect(setHeader).toHaveBeenCalledWith(
      'Cache-Control',
      'public, max-age=30, stale-while-revalidate=120',
    )
  })
})

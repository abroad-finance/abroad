import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'

import type { TransparencyMetricsResponse } from '../api'

import TransparencyDashboard from '../pages/Transparency/TransparencyDashboard'

const mocked = vi.hoisted(() => ({
  fetchTransparencyMetrics: vi.fn(),
}))

vi.mock('../services/public/transparencyApi', async (importOriginal) => {
  const original = await importOriginal<typeof import('../services/public/transparencyApi')>()
  return {
    ...original,
    fetchTransparencyMetrics: mocked.fetchTransparencyMetrics,
  }
})

const buildMetrics = (
  acceptedTransactions = 1_234,
): TransparencyMetricsResponse => ({
  generatedAt: '2026-07-27T12:00:00.000Z',
  openSource: {
    asOf: '2026-07-27T11:58:00.000Z',
    cache: 'fresh',
    commitsLast90Days: 51,
    contributors: 10,
    defaultBranch: 'main',
    forks: 3,
    openIssues: 2,
    openPullRequests: 7,
    pushedAt: '2026-07-27T10:00:00.000Z',
    repository: 'abroad-finance/abroad',
    stars: 4,
  },
  platform: {
    cache: 'fresh',
    coverage: {
      corridors: 2,
      networks: ['CELO', 'STELLAR'],
      payoutCurrencies: ['BRL', 'COP'],
      payoutMethods: ['BREB', 'PIX'],
      sourceAssets: ['USDC', 'USDT'],
    },
    dailyOutcomes: [{
      accepted: 4,
      completed: 3,
      date: '2026-07-26',
      failed: 1,
      inFlight: 0,
      otherTerminal: 0,
    }, {
      accepted: 8,
      completed: 6,
      date: '2026-07-27',
      failed: 1,
      inFlight: 1,
      otherTerminal: 0,
    }],
    generatedAt: '2026-07-27T11:59:30.000Z',
    rolling30Days: {
      acceptedTransactions: 120,
      activePartnerOrganizations: 9,
      activeUserRecords: 42,
      completedSourceVolume: [{ amount: 980.5, asset: 'USDC' }, { amount: 20, asset: 'USDT' }],
      completedTransactions: 108,
      completionRate: 90,
      statusBreakdown: [],
    },
    totals: {
      acceptedTransactions,
      completedSourceVolume: [{ amount: 12_340.75, asset: 'USDC' }, { amount: 300, asset: 'USDT' }],
      completedTransactions: 1_050,
      completionRate: 88.5,
      partnerOrganizations: 51,
      statusBreakdown: [],
      userRecords: 538,
    },
  },
  refreshAfterSeconds: 60,
  schemaVersion: '1.0',
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('TransparencyDashboard', () => {
  it('renders live aggregate metrics, definitions, and source freshness', async () => {
    mocked.fetchTransparencyMetrics.mockResolvedValue(buildMetrics())

    render(<TransparencyDashboard />)

    expect(screen.getByRole('heading', { name: 'Every number comes with a receipt.' })).toBeInTheDocument()
    expect(await screen.findByText('1,234')).toBeInTheDocument()
    expect(screen.getByText('1,050')).toBeInTheDocument()
    expect(screen.getByText('88.5%')).toBeInTheDocument()
    expect(screen.getByText('abroad-finance/abroad')).toBeInTheDocument()
    expect(screen.getByText('What is—and is not—published.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /View machine-readable JSON/ })).toHaveAttribute(
      'href',
      'https://api.abroad.finance/public/transparency',
    )
  })

  it('shows an actionable error and recovers without reloading the page', async () => {
    mocked.fetchTransparencyMetrics
      .mockRejectedValueOnce(new Error('Network unavailable'))
      .mockResolvedValueOnce(buildMetrics())

    render(<TransparencyDashboard />)

    expect(await screen.findByText('Network unavailable')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))

    expect(await screen.findByText('1,234')).toBeInTheDocument()
    expect(mocked.fetchTransparencyMetrics).toHaveBeenCalledTimes(2)
  })

  it('refreshes displayed values on demand', async () => {
    mocked.fetchTransparencyMetrics
      .mockResolvedValueOnce(buildMetrics())
      .mockResolvedValueOnce(buildMetrics(1_235))

    render(<TransparencyDashboard />)
    expect(await screen.findByText('1,234')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Refresh now' }))

    await waitFor(() => {
      expect(screen.getByText('1,235')).toBeInTheDocument()
    })
  })
})

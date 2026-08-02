import {
  render, screen, waitFor, within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'

import type { OpsOverviewRange, OpsOverviewResponse } from '../services/admin/overviewTypes'

import OpsControlTower from '../pages/Ops/OpsControlTower'
import { clearOpsApiKey, setOpsApiKey } from '../services/admin/opsAuthStore'

const mocked = vi.hoisted(() => ({
  getOpsOverview: vi.fn(),
}))

vi.mock('../services/admin/overviewAdminApi', () => ({
  getOpsOverview: mocked.getOpsOverview,
}))

const buildOverview = (range: OpsOverviewRange = '24h'): OpsOverviewResponse => ({
  activity: {
    current: {
      completedTransactions: 6,
      payoutVolume: [{ amount: 5_500, currency: 'BRL' }],
      sourceVolume: [{ amount: 900, currency: 'USDC' }, { amount: 100, currency: 'USDT' }],
      statusCounts: [
        { count: 2, status: 'AWAITING_PAYMENT' },
        { count: 0, status: 'PROCESSING_PAYMENT' },
        { count: 6, status: 'PAYMENT_COMPLETED' },
        { count: 1, status: 'PAYMENT_FAILED' },
        { count: 1, status: 'PAYMENT_EXPIRED' },
        { count: 0, status: 'WRONG_AMOUNT' },
      ],
      successRatePct: 75,
      totalTransactions: 10,
    },
    previous: {
      completedTransactions: 5,
      payoutVolume: [{ amount: 4_000, currency: 'BRL' }],
      sourceVolume: [{ amount: 800, currency: 'USDC' }],
      statusCounts: [
        { count: 1, status: 'AWAITING_PAYMENT' },
        { count: 0, status: 'PROCESSING_PAYMENT' },
        { count: 5, status: 'PAYMENT_COMPLETED' },
        { count: 1, status: 'PAYMENT_FAILED' },
        { count: 1, status: 'PAYMENT_EXPIRED' },
        { count: 0, status: 'WRONG_AMOUNT' },
      ],
      successRatePct: 71.43,
      totalTransactions: 8,
    },
    series: [
      {
        at: '2026-08-01T09:00:00.000Z',
        completedTransactions: 2,
        expiredTransactions: 0,
        failedTransactions: 0,
        openTransactions: 1,
        totalTransactions: 3,
      },
      {
        at: '2026-08-01T10:00:00.000Z',
        completedTransactions: 1,
        expiredTransactions: 1,
        failedTransactions: 1,
        openTransactions: 0,
        totalTransactions: 3,
      },
      {
        at: '2026-08-01T11:00:00.000Z',
        completedTransactions: 3,
        expiredTransactions: 0,
        failedTransactions: 0,
        openTransactions: 1,
        totalTransactions: 4,
      },
    ],
    seriesUnit: 'HOUR',
  },
  bridge: {
    failedLegs: { amount: 12, count: 1 },
    float: {
      available: 700,
      cap: 1_000,
      deficit: 300,
      enabled: true,
    },
    oldestPendingAt: '2026-08-01T10:00:00.000Z',
    outstandingLegs: { amount: 220, count: 2 },
  },
  execution: {
    oldestWaitingAt: '2026-08-01T10:30:00.000Z',
    statusCounts: [
      { count: 1, status: 'NOT_STARTED' },
      { count: 3, status: 'IN_PROGRESS' },
      { count: 2, status: 'WAITING' },
      { count: 1, status: 'FAILED' },
      { count: 13, status: 'COMPLETED' },
    ],
    totalFlows: 20,
  },
  generatedAt: '2026-08-01T12:00:00.000Z',
  incidents: {
    critical: 1,
    high: 1,
    open: 2,
    top: [{
      acknowledgedAt: null,
      affectedCount: 3,
      ageSeconds: 7_200,
      context: { affected: [], dimensions: [], filters: [] },
      firstSeenAt: '2026-08-01T10:00:00.000Z',
      id: 'incident-1',
      kind: 'LIQUIDITY',
      lastSeenAt: '2026-08-01T11:45:00.000Z',
      occurrenceCount: 4,
      owner: null,
      resolvedAt: null,
      runbook: null,
      severity: 'CRITICAL',
      status: 'OPEN',
      summary: 'Liquidity checks are failing.',
      team: 'Operations',
      title: 'BRZ liquidity unavailable',
      updatedAt: '2026-08-01T11:45:00.000Z',
      version: 1,
    }],
    unowned: 1,
  },
  partners: {
    activePartners: 2,
    top: [{
      completedTransactions: 5,
      id: 'partner-high',
      name: 'High Volume',
      sourceVolume: [{ amount: 850, currency: 'USDC' }],
      stablecoinAmount: 850,
      totalTransactions: 7,
    }, {
      completedTransactions: 1,
      id: 'partner-low',
      name: 'Lower Volume',
      sourceVolume: [{ amount: 50, currency: 'USDC' }, { amount: 100, currency: 'USDT' }],
      stablecoinAmount: 150,
      totalTransactions: 3,
    }],
    totalPartners: 9,
  },
  treasury: {
    capturedAt: '2026-08-01T11:59:30.000Z',
    totalUsd: 12_345.67,
    totalUsdIsPartial: true,
    venues: { reporting: 4, total: 5, unavailable: 1 },
  },
  window: {
    from: '2026-07-31T12:00:00.000Z',
    previousFrom: '2026-07-30T12:00:00.000Z',
    previousTo: '2026-07-31T12:00:00.000Z',
    range,
    to: '2026-08-01T12:00:00.000Z',
  },
})

afterEach(() => {
  clearOpsApiKey()
  vi.clearAllMocks()
})

describe('OpsControlTower', () => {
  it('renders the operating picture with accessible visuals and drill-downs', async () => {
    setOpsApiKey('ops_key')
    mocked.getOpsOverview.mockResolvedValue(buildOverview())

    render(
      <MemoryRouter initialEntries={['/ops']}>
        <OpsControlTower />
      </MemoryRouter>,
    )

    expect(await screen.findByRole('heading', { name: 'Control Tower' })).toBeInTheDocument()
    expect(mocked.getOpsOverview).toHaveBeenCalledWith('24h')
    expect(screen.getByRole('link', { name: 'Home' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('img', {
      name: 'Transaction outcomes: 6 completed, 2 open, 1 failed, 1 expired',
    })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Transaction activity chart with 10 transactions' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Incident pulse' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /BRZ liquidity unavailable/ })).toHaveAttribute('href', '/ops/incidents/incident-1')
    expect(screen.getByText('Partial valuation')).toBeInTheDocument()
    expect(screen.getByRole('progressbar', { name: 'Float utilization' })).toHaveAttribute('aria-valuenow', '30')

    const rankedPartners = within(screen.getByRole('list', {
      name: 'Partners ranked by completed volume',
    })).getAllByRole('listitem')
    expect(within(rankedPartners[0]).getByText('High Volume')).toBeInTheDocument()
    expect(within(rankedPartners[1]).getByText('Lower Volume')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Waiting flows' })).toHaveAttribute('href', '/ops/flows?failure=STUCK_WAITING')
    expect(screen.getByRole('link', { name: /Open partner directory/ })).toHaveAttribute('href', '/ops/partners')
    expect(screen.getByRole('navigation', { name: 'Operations quick links' })).toBeInTheDocument()
  })

  it('loads a new range and ignores an older response that finishes afterward', async () => {
    setOpsApiKey('ops_key')
    let resolveFirst: ((overview: OpsOverviewResponse) => void) | undefined
    mocked.getOpsOverview
      .mockImplementationOnce(() => new Promise<OpsOverviewResponse>((resolve) => {
        resolveFirst = resolve
      }))
      .mockResolvedValueOnce(buildOverview('30d'))

    render(
      <MemoryRouter initialEntries={['/ops']}>
        <OpsControlTower />
      </MemoryRouter>,
    )

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: '30 days' }))

    await screen.findByText(/Rolling 30 days/)
    expect(mocked.getOpsOverview).toHaveBeenNthCalledWith(1, '24h')
    expect(mocked.getOpsOverview).toHaveBeenNthCalledWith(2, '30d')

    resolveFirst?.(buildOverview('24h'))
    await waitFor(() => {
      expect(screen.getByText(/Rolling 30 days/)).toBeInTheDocument()
    })
  })

  it('waits for an ops key before requesting data', () => {
    render(
      <MemoryRouter initialEntries={['/ops']}>
        <OpsControlTower />
      </MemoryRouter>,
    )

    expect(screen.getByText('Ops API key required to load the Control Tower.')).toBeInTheDocument()
    expect(mocked.getOpsOverview).not.toHaveBeenCalled()
  })
})

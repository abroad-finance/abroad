import {
  fireEvent, render, screen, waitFor,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'

import type { BusinessPerformanceResponse } from '../services/admin/businessPerformanceTypes'

import BusinessPerformance from '../pages/Ops/BusinessPerformance'
import { clearOpsApiKey, setOpsApiKey } from '../services/admin/opsAuthStore'

const mocked = vi.hoisted(() => ({
  getBusinessPerformance: vi.fn(),
}))

vi.mock('../services/admin/businessPerformanceAdminApi', () => ({
  getBusinessPerformance: mocked.getBusinessPerformance,
}))

const buildReport = (overrides: Partial<BusinessPerformanceResponse> = {}): BusinessPerformanceResponse => ({
  comparison: {
    acceptedTransactions: 4,
    acceptedUsdVolume: 80,
    activeUsers: 3,
    allocatedBridgeCostsUsd: 0.2,
    blockchainAndRefundGasUsd: 0.01,
    completedTransactions: 3,
    completedUsdVolume: 60,
    costCoverageComplete: true,
    excludedCompletedPayouts: { count: 0, valueUsd: 0 },
    failedQuotes: 1,
    failedTransactions: 1,
    grossTransactionMarginUsd: 2,
    inFlightTransactions: 0,
    nativeCompletedPayouts: [{ amount: 300, currency: 'BRL' }],
    netTransactionEarningsUsd: 1.79,
    providerPayoutCostsUsd: 0,
    quoteRequests: 10,
    quoteSuccessRate: 90,
    settledUltraConversionCount: 3,
    successfulQuotes: 9,
    terminalCompletionRate: 75,
    transactionConversionRate: 75,
    ultraCustomerPayouts: [{ amount: 300, currency: 'BRL' }],
    ultraProceeds: [{ amount: 310, currency: 'BRL' }],
  },
  coverage: {
    earnings: {
      historicalBackfillCompletedAt: '2026-08-02T15:00:00.000Z',
      missingCostCount: 2,
      missingEconomicFactCount: 0,
      status: 'PARTIAL',
      warnings: ['Two required external costs are unavailable.'],
    },
    economicFactsReconciledAt: '2026-08-02T15:29:00.000Z',
    quotes: {
      complete: true,
      from: '2026-07-28T00:00:00.000Z',
      pendingRequestCount: 0,
      warnings: [],
    },
  },
  current: {
    acceptedTransactions: 5,
    acceptedUsdVolume: 100,
    activeUsers: 4,
    allocatedBridgeCostsUsd: 0.3,
    blockchainAndRefundGasUsd: 0.02,
    completedTransactions: 4,
    completedUsdVolume: 90,
    costCoverageComplete: false,
    excludedCompletedPayouts: { count: 1, valueUsd: 10 },
    failedQuotes: 2,
    failedTransactions: 1,
    grossTransactionMarginUsd: 3,
    inFlightTransactions: 0,
    nativeCompletedPayouts: [{ amount: 450, currency: 'BRL' }, { amount: 210_000, currency: 'COP' }],
    netTransactionEarningsUsd: 2.68,
    providerPayoutCostsUsd: 0,
    quoteRequests: 12,
    quoteSuccessRate: 83.33,
    settledUltraConversionCount: 3,
    successfulQuotes: 10,
    terminalCompletionRate: 80,
    transactionConversionRate: 80,
    ultraCustomerPayouts: [{ amount: 450, currency: 'BRL' }],
    ultraProceeds: [{ amount: 465, currency: 'BRL' }],
  },
  generatedAt: '2026-08-02T15:30:00.000Z',
  metrics: [
    {
      change: 20,
      changeKind: 'PERCENT',
      comparisonValue: 10,
      currentValue: 12,
      id: 'quote-requests',
      label: 'Quote requests',
      unit: 'COUNT',
    },
    {
      change: 49.72,
      changeKind: 'PERCENT',
      comparisonValue: 1.79,
      currency: 'USD',
      currentValue: 2.68,
      id: 'net-transaction-earnings',
      label: 'Net transaction earnings',
      unit: 'USD',
    },
    {
      change: 10,
      changeKind: 'PERCENT',
      comparisonValue: 300,
      currency: 'BRL',
      currentValue: 330,
      id: 'payout-brl',
      label: 'Completed payout total (BRL)',
      unit: 'NATIVE',
    },
    {
      change: 5,
      changeKind: 'PERCENTAGE_POINT',
      comparisonValue: 75,
      currentValue: 80,
      id: 'terminal-rate',
      label: 'Terminal completion rate',
      unit: 'RATE',
    },
  ],
  ranges: {
    comparison: { from: '2026-08-01T00:00:00.000Z', to: '2026-08-02T00:00:00.000Z' },
    primary: { from: '2026-08-02T00:00:00.000Z', to: '2026-08-03T00:00:00.000Z' },
  },
  ...overrides,
})

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  vi.setSystemTime(new Date('2026-08-02T15:30:45.000Z'))
  setOpsApiKey('ops_key')
})

afterEach(() => {
  clearOpsApiKey()
  vi.clearAllMocks()
  vi.useRealTimers()
})

describe('BusinessPerformance', () => {
  it('renders aggregate units, exact UTC metadata, partial coverage, and sortable values', async () => {
    mocked.getBusinessPerformance.mockResolvedValue(buildReport())
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    render(<MemoryRouter initialEntries={['/ops/business-performance']}><BusinessPerformance /></MemoryRouter>)

    expect(await screen.findByRole('heading', { name: 'Business Performance' })).toBeInTheDocument()
    expect(screen.getAllByText(/inclusive → .* exclusive/)).toHaveLength(2)
    expect(screen.getByText('Partial earnings coverage')).toBeInTheDocument()
    expect(screen.getByText('Two required external costs are unavailable.')).toBeInTheDocument()
    expect(screen.getByText(/unresolved required costs are excluded—not treated as zero/i)).toBeInTheDocument()
    expect(screen.getByText('BRL', { selector: 'span' })).toBeInTheDocument()
    expect(screen.getByText('USD', { selector: 'span' })).toBeInTheDocument()
    expect(screen.getByText('+5.00 pp')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Current/ }))
    expect(screen.getByRole('columnheader', { name: /Current/ })).toHaveAttribute('aria-sort', 'descending')
  })

  it('applies independent custom UTC primary and comparison ranges', async () => {
    mocked.getBusinessPerformance.mockResolvedValue(buildReport())
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    render(<MemoryRouter><BusinessPerformance /></MemoryRouter>)
    await screen.findByText('Business performance')

    await user.selectOptions(screen.getByLabelText('Primary preset'), 'CUSTOM')
    await user.selectOptions(screen.getByLabelText('Comparison'), 'CUSTOM')
    const fromInputs = screen.getAllByLabelText('From (UTC)')
    const toInputs = screen.getAllByLabelText('To (UTC)')
    fireEvent.change(fromInputs[0], { target: { value: '2026-08-01T00:00' } })
    fireEvent.change(toInputs[0], { target: { value: '2026-08-02T00:00' } })
    fireEvent.change(fromInputs[1], { target: { value: '2026-07-01T00:00' } })
    fireEvent.change(toInputs[1], { target: { value: '2026-07-08T00:00' } })
    await user.click(screen.getByRole('button', { name: 'Apply ranges' }))

    await waitFor(() => expect(mocked.getBusinessPerformance).toHaveBeenLastCalledWith({
      comparison: { from: '2026-07-01T00:00:00.000Z', to: '2026-07-08T00:00:00.000Z' },
      primary: { from: '2026-08-01T00:00:00.000Z', to: '2026-08-02T00:00:00.000Z' },
    }))
  })

  it('shows explicit loading, empty, and error states', async () => {
    let resolveReport: ((report: BusinessPerformanceResponse) => void) | undefined
    mocked.getBusinessPerformance.mockImplementationOnce(() => new Promise((resolve) => {
      resolveReport = resolve
    }))
    const { unmount } = render(<MemoryRouter><BusinessPerformance /></MemoryRouter>)
    expect(screen.getByText('Aggregating business performance…')).toBeInTheDocument()
    resolveReport?.(buildReport({
      comparison: {
        ...buildReport().comparison,
        acceptedTransactions: 0,
        quoteRequests: 0,
      },
      current: { ...buildReport().current, acceptedTransactions: 0, quoteRequests: 0 },
      metrics: [],
    }))
    expect(await screen.findByText(/No quote or transaction activity/)).toBeInTheDocument()
    unmount()

    mocked.getBusinessPerformance.mockRejectedValueOnce(new Error('report unavailable'))
    render(<MemoryRouter><BusinessPerformance /></MemoryRouter>)
    expect(await screen.findByText('report unavailable')).toBeInTheDocument()
  })

  it('keeps comparison values visible when only the primary range is empty', async () => {
    mocked.getBusinessPerformance.mockResolvedValue(buildReport({
      current: { ...buildReport().current, acceptedTransactions: 0, quoteRequests: 0 },
    }))
    render(<MemoryRouter><BusinessPerformance /></MemoryRouter>)

    expect(await screen.findByText(/primary range has no quote or transaction activity/i)).toBeInTheDocument()
    expect(screen.getByRole('table', { name: /Business performance/i })).toBeInTheDocument()
  })
})

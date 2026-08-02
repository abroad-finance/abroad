import {
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  MemoryRouter,
  Route,
  Routes,
} from 'react-router-dom'
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from 'vitest'

import type { OpsSession } from '../services/admin/opsAuthStore'
import type {
  OpsPartnerDirectoryResponse,
  OpsPartnerScorecard,
} from '../services/admin/partnerAnalyticsTypes'

import OpsPartners from '../pages/Ops/OpsPartners'
import OpsPartnerScorecardPage from '../pages/Ops/OpsPartnerScorecard'
import { setOpsSession } from '../services/admin/opsAuthStore'

const analyticsMocks = vi.hoisted(() => ({
  getOpsPartnerScorecard: vi.fn(),
  listOpsPartnerDirectory: vi.fn(),
}))

vi.mock('../services/admin/partnerAnalyticsAdminApi', () => analyticsMocks)

const session: OpsSession = {
  authenticatedAt: '2026-08-02T15:00:00.000Z',
  bootstrapRequired: false,
  displayName: 'Support Operator',
  email: 'support@abroad.finance',
  kind: 'ops_user',
  permissions: ['partners:read', 'transactions:read'],
  role: 'SUPPORT',
  sessionVersion: 1,
  stepUpExpiresAt: null,
  userId: 'ops-user-1',
}

const directory: OpsPartnerDirectoryResponse = {
  filterOptions: { countries: ['BR', 'CO'] },
  from: '2026-07-03T12:00:00.000Z',
  items: [{
    completedTransactions: 8,
    country: 'CO',
    createdAt: '2026-01-01T00:00:00.000Z',
    failedTransactions: 2,
    id: 'partner-1',
    lifecycle: 'LIVE',
    name: 'High Volume Partner',
    payoutVolume: [{ amount: 500, currency: 'BRL' }],
    sourceVolume: [{ amount: 100, currency: 'USDC' }],
    stablecoinAmount: 100,
    successRatePct: 80,
    totalTransactions: 10,
  }],
  maximumStablecoinAmount: 100,
  page: 1,
  pageSize: 20,
  range: '30d',
  to: '2026-08-02T12:00:00.000Z',
  total: 1,
}

const scorecard: OpsPartnerScorecard = {
  activity: {
    completedTransactions: 8,
    failedTransactions: 2,
    payoutVolume: [{ amount: 500, currency: 'BRL' }],
    sourceVolume: [{ amount: 100, currency: 'USDC' }],
    stablecoinAmount: 100,
    statusCounts: [{ count: 8, status: 'PAYMENT_COMPLETED' }, { count: 2, status: 'PAYMENT_FAILED' }],
    successRatePct: 80,
    totalTransactions: 10,
  },
  cases: [{ count: 1, status: 'OPEN' }],
  corridors: [{
    blockchain: 'POLYGON',
    completedTransactions: 8,
    cryptoCurrency: 'USDC',
    sharePct: 100,
    stablecoinAmount: 100,
    targetCurrency: 'BRL',
  }],
  from: directory.from,
  incidents: [{
    href: '/ops/incidents/incident-1',
    id: 'incident-1',
    severity: 'HIGH',
    status: 'OPEN',
    title: 'Webhook degradation',
  }],
  partner: {
    country: 'CO',
    createdAt: '2026-01-01T00:00:00.000Z',
    id: 'partner-1',
    lifecycle: 'LIVE',
    name: 'High Volume Partner',
  },
  range: '30d',
  to: directory.to,
  transactionPath: '/ops/transactions?partnerId=partner-1',
  trend: [{
    at: '2026-08-01T00:00:00.000Z',
    completed: 8,
    failed: 2,
    open: 0,
    total: 10,
  }],
  trendUnit: 'DAY',
  webhook: {
    delivered: 9,
    failed: 1,
    lastDeliveredAt: '2026-08-02T10:00:00.000Z',
    pending: 0,
    successRatePct: 90,
    total: 10,
  },
}

beforeEach(() => {
  setOpsSession(session)
  analyticsMocks.listOpsPartnerDirectory.mockResolvedValue(directory)
  analyticsMocks.getOpsPartnerScorecard.mockResolvedValue(scorecard)
})

afterEach(() => {
  setOpsSession(null)
  vi.clearAllMocks()
})

describe('partner analytics', () => {
  test('supports explicit URL-backed directory filters and read-only scorecard drill-down', async () => {
    const user = userEvent.setup()
    render(
      <MemoryRouter initialEntries={['/ops/partners']}>
        <OpsPartners />
      </MemoryRouter>,
    )

    expect(await screen.findByRole('heading', { name: 'High Volume Partner' })).toBeInTheDocument()
    expect(screen.getByLabelText('100 stablecoin volume')).toBeInTheDocument()
    expect(screen.getByText('500.00 BRL')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Open scorecard/ })).toHaveAttribute('href', '/ops/partners/partner-1?range=30d')
    expect(screen.queryByRole('link', { name: 'Manage credentials' })).not.toBeInTheDocument()

    await user.selectOptions(screen.getByRole('combobox', { name: 'Time window' }), '7d')
    await user.type(screen.getByRole('textbox', { name: 'Partner search' }), 'High')
    await user.click(screen.getByRole('button', { name: 'Apply' }))
    await waitFor(() => expect(analyticsMocks.listOpsPartnerDirectory).toHaveBeenLastCalledWith(expect.objectContaining({
      query: 'High',
      range: '7d',
    })))
  })

  test('shows volume, trend data, webhook health, concentration, incidents, and cases', async () => {
    render(
      <MemoryRouter initialEntries={['/ops/partners/partner-1']}>
        <Routes>
          <Route element={<OpsPartnerScorecardPage />} path="/ops/partners/:partnerId" />
        </Routes>
      </MemoryRouter>,
    )

    expect(await screen.findByRole('heading', { name: 'High Volume Partner' })).toBeInTheDocument()
    expect(screen.getByText('80%')).toBeInTheDocument()
    expect(screen.getByText('Failures detected')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Partner activity trend with 10 transactions' })).toBeInTheDocument()
    const table = screen.getByRole('table', { name: 'Partner transaction outcomes over time' })
    expect(within(table).getByText('8')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Corridor concentration' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Webhook degradation/ })).toHaveAttribute('href', '/ops/incidents/incident-1')
    expect(screen.getByRole('heading', { name: 'Support cases' })).toBeInTheDocument()
  })
})

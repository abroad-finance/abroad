import {
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from 'vitest'

import type { OpsSession } from '../services/admin/opsAuthStore'

import BridgeOps from '../pages/Ops/BridgeOps'
import OpsBridgeBatchDetail from '../pages/Ops/OpsBridgeBatchDetail'
import OpsIncidentDetail from '../pages/Ops/OpsIncidentDetail'
import OpsIncidents from '../pages/Ops/OpsIncidents'
import OpsIntegrations from '../pages/Ops/OpsIntegrations'
import OpsShiftHandoff from '../pages/Ops/OpsShiftHandoff'
import TreasuryDashboard from '../pages/Ops/TreasuryDashboard'
import { setOpsSession } from '../services/admin/opsAuthStore'
import { ImmediateOpsMutationProvider } from './opsMutationTestUtils'

const incidentMocks = vi.hoisted(() => ({
  addOpsIncidentNote: vi.fn(),
  getOpsIncident: vi.fn(),
  getOpsShiftHandoff: vi.fn(),
  handoffOpsIncident: vi.fn(),
  listOpsIncidentOwners: vi.fn(),
  listOpsIncidentRunbooks: vi.fn(),
  listOpsIncidents: vi.fn(),
  updateOpsIncident: vi.fn(),
}))

const investigationMocks = vi.hoisted(() => ({
  createOpsSavedView: vi.fn(),
  deleteOpsSavedView: vi.fn(),
  listOpsSavedViews: vi.fn(),
  updateOpsSavedView: vi.fn(),
}))

const integrationMocks = vi.hoisted(() => ({
  createOpsIntegration: vi.fn(),
  createOpsRunbook: vi.fn(),
  getOpsIntegrationCatalog: vi.fn(),
  updateOpsIntegration: vi.fn(),
  updateOpsRunbook: vi.fn(),
}))

const bridgeMocks = vi.hoisted(() => ({
  getBridgeBatchDetail: vi.fn(),
  getBridgeOverview: vi.fn(),
}))

const treasuryMocks = vi.hoisted(() => ({
  createTreasuryThreshold: vi.fn(),
  getTreasuryBalances: vi.fn(),
  getTreasuryMovements: vi.fn(),
  getTreasurySnapshots: vi.fn(),
  updateTreasuryThreshold: vi.fn(),
}))

vi.mock('../services/admin/incidentAdminApi', () => incidentMocks)
vi.mock('../services/admin/opsInvestigationApi', () => investigationMocks)
vi.mock('../services/admin/integrationAdminApi', () => integrationMocks)
vi.mock('../services/admin/bridgeAdminApi', () => bridgeMocks)
vi.mock('../services/admin/treasuryAdminApi', () => treasuryMocks)

const session: OpsSession = {
  authenticatedAt: '2026-08-02T15:00:00.000Z',
  bootstrapRequired: false,
  displayName: 'Operations Operator',
  email: 'operator@abroad.finance',
  kind: 'ops_user',
  permissions: [
    'administration:integrations',
    'incidents:manage',
    'incidents:read',
    'saved_views:manage',
    'treasury:manage',
    'treasury:read',
  ],
  role: 'ADMINISTRATOR',
  sessionVersion: 1,
  stepUpExpiresAt: '2099-08-02T15:10:00.000Z',
  userId: 'ops-user-1',
}

const incident = {
  acknowledgedAt: null,
  affectedCount: 3,
  ageSeconds: 7_200,
  context: {
    affected: [{
      id: 'flow-1', label: 'Flow flow-1', path: '/ops/flows/flow-1', type: 'FLOW' as const,
    }],
    dimensions: [{ label: 'Provider', value: 'PIX' }],
    filters: [{ label: 'Open affected flows', path: '/ops/flows?failure=FAILED_FLOW' }],
  },
  firstSeenAt: '2026-08-02T10:00:00.000Z',
  id: 'incident-1',
  kind: 'RATE_LIMIT',
  lastSeenAt: '2026-08-02T11:00:00.000Z',
  occurrenceCount: 4,
  owner: null,
  resolvedAt: null,
  runbook: null,
  severity: 'CRITICAL' as const,
  status: 'OPEN' as const,
  summary: 'Provider throttling is delaying payouts.',
  team: 'Operations',
  title: 'Provider throttling · PIX',
  updatedAt: '2026-08-02T11:00:00.000Z',
  version: 1,
}

const bridgeOverview = {
  batches: [{
    asset: 'USDC',
    createdAt: '2026-08-02T10:00:00.000Z',
    destNetwork: 'POLYGON',
    expectedSlaAt: '2026-08-02T12:00:00.000Z',
    failureCategory: null,
    grossAmount: 25,
    id: 'batch-1',
    incidentPath: '/ops/incidents?kind=BRIDGE&query=batch-1',
    memberCount: 1,
    reconciliationState: 'AWAITING_PROVIDER' as const,
    runbookPath: '/ops/administration/integrations?kind=RUNBOOK&incidentKind=BRIDGE',
    settledAt: null,
    slaState: 'ON_TRACK' as const,
    status: 'SUBMITTED' as const,
    withdrawFee: 0.1,
    withdrawId: 'withdrawal-1',
  }],
  float: {
    available: 0, cap: 100, deficit: 100, enabled: true,
  },
  legs: {
    byStatus: [{ amount: 100, count: 1, status: 'BATCHED' as const }],
    oldestPendingAt: null,
    recent: [{
      amount: 25,
      asset: 'USDC',
      batchId: 'batch-1',
      createdAt: '2026-08-02T09:00:00.000Z',
      destNetwork: 'POLYGON',
      expectedSlaAt: '2026-08-02T10:00:00.000Z',
      failureCategory: null,
      id: 'leg-1',
      incidentPath: '/ops/incidents?kind=BRIDGE&query=leg-1',
      reconciliationState: 'AWAITING_PROVIDER' as const,
      slaState: 'BREACHED' as const,
      status: 'BATCHED' as const,
      transaction: {
        id: 'transaction-1',
        partner: { id: 'partner-1', name: 'Partner One' },
        status: 'PROCESSING_PAYMENT',
      },
      updatedAt: '2026-08-02T11:00:00.000Z',
    }],
    total: 1,
  },
}

const balances = {
  capturedAt: '2026-08-02T15:00:00.000Z',
  cells: [{
    account: 'BRZ',
    amount: 150,
    availableAmount: 100,
    blockedAmount: 20,
    currency: 'BRZ',
    outstandingAmount: 10,
    posture: {
      alertPath: '/ops/incidents?currency=BRZ&kind=TREASURY&venue=TRANSFERO',
      averageDailyOutflow: 2_400,
      ownerTeam: 'Treasury',
      runwayHours: 1,
      state: 'CRITICAL' as const,
      threshold: {
        criticalRunwayHours: 4,
        id: 'threshold-1',
        minimumAvailable: 500,
        version: 2,
        warningRunwayHours: 12,
      },
    },
    reservedAmount: 20,
    usdRate: 0.2,
    usdValue: 30,
    venue: 'TRANSFERO',
  }],
  errors: [],
  float: {
    available: 0, cap: 100, deficit: 100, enabled: true,
  },
  freshness: { staleAt: '2026-08-02T15:02:00.000Z', state: 'FRESH' as const },
  fxRates: [{ currency: 'BRL', usdPerUnit: 0.2 }],
  totalUsd: 30,
  totalUsdIsPartial: false,
}

const renderWithSession = (node: React.ReactNode, entry: string) => render(
  <MemoryRouter initialEntries={[entry]}>
    <ImmediateOpsMutationProvider>{node}</ImmediateOpsMutationProvider>
  </MemoryRouter>,
)

beforeEach(() => {
  setOpsSession(session)
  incidentMocks.listOpsIncidentOwners.mockResolvedValue([])
  incidentMocks.listOpsIncidentRunbooks.mockResolvedValue([])
  incidentMocks.listOpsIncidents.mockResolvedValue({
    items: [incident],
    page: 1,
    pageSize: 30,
    severityCounts: [{ count: 1, value: 'CRITICAL' }],
    statusCounts: [{ count: 1, value: 'OPEN' }],
    total: 1,
  })
  incidentMocks.getOpsIncident.mockResolvedValue({ ...incident, handoffs: [], notes: [] })
  incidentMocks.getOpsShiftHandoff.mockResolvedValue({
    counts: { mine: 0, total: 1, unowned: 1 },
    generatedAt: '2026-08-02T15:00:00.000Z',
    items: [{
      ageSeconds: 7_200,
      href: '/ops/incidents/incident-1',
      id: 'incident-1',
      latestEscalation: {
        at: '2026-08-02T14:00:00.000Z',
        author: 'Operations Operator',
        summary: 'Provider ticket is open.',
      },
      owner: null,
      priority: 'CRITICAL',
      resourceType: 'INCIDENT',
      status: 'OPEN',
      subtitle: 'RATE LIMIT · 3 affected',
      team: null,
      title: incident.title,
      updatedAt: incident.updatedAt,
      version: 1,
    }],
    scope: 'ALL',
  })
  investigationMocks.listOpsSavedViews.mockResolvedValue([])
  bridgeMocks.getBridgeOverview.mockResolvedValue(bridgeOverview)
  bridgeMocks.getBridgeBatchDetail.mockResolvedValue({
    batch: bridgeOverview.batches[0],
    members: bridgeOverview.legs.recent,
    providerReference: 'withdrawal-1',
  })
  treasuryMocks.getTreasuryBalances.mockResolvedValue(balances)
  treasuryMocks.getTreasuryMovements.mockResolvedValue({ days: [], recent: [] })
  treasuryMocks.getTreasurySnapshots.mockResolvedValue({
    from: '2026-07-26T15:00:00.000Z', series: [], to: '2026-08-02T15:00:00.000Z',
  })
  integrationMocks.getOpsIntegrationCatalog.mockResolvedValue({
    integrations: [{
      configuration: {
        destinationLabel: '#ops-incidents',
        eventKinds: ['LIQUIDITY', 'PROVIDER'],
        healthcheckName: 'Primary delivery monitor',
        provider: 'Slack',
      },
      createdAt: '2026-08-01T10:00:00.000Z',
      description: 'Routes operational exceptions.',
      id: 'integration-1',
      kind: 'NOTIFICATION',
      lastCheckedAt: '2026-08-02T14:59:00.000Z',
      lastErrorCode: null,
      name: 'Operations notifications',
      status: 'ACTIVE',
      updatedAt: '2026-08-02T14:59:00.000Z',
      version: 1,
    }],
    runbooks: [{
      active: true,
      createdAt: '2026-08-01T10:00:00.000Z',
      description: 'Respond to provider throttling.',
      id: 'runbook-1',
      incidentKinds: ['RATE_LIMIT'],
      name: 'Provider throttling',
      slug: 'provider-throttling',
      updatedAt: '2026-08-01T10:00:00.000Z',
      url: 'https://runbooks.abroad.finance/provider-throttling',
      version: 1,
    }],
  })
})

afterEach(() => {
  setOpsSession(null)
  vi.clearAllMocks()
})

describe('Phase 3 Ops workspaces', () => {
  test('keeps incident filter edits draft-only and exposes canonical investigation links', async () => {
    renderWithSession(<OpsIncidents />, '/ops/incidents?severity=CRITICAL')

    expect(await screen.findByRole('heading', { name: incident.title })).toBeVisible()
    expect(incidentMocks.listOpsIncidents).toHaveBeenCalledWith(expect.objectContaining({ severity: 'CRITICAL' }))
    const user = userEvent.setup()
    await user.type(screen.getByLabelText('Search incident summary'), 'PIX')
    expect(incidentMocks.listOpsIncidents).toHaveBeenCalledTimes(1)
    await user.click(screen.getByRole('button', { name: 'Apply filters' }))
    await waitFor(() => expect(incidentMocks.listOpsIncidents).toHaveBeenCalledTimes(2))
    expect(incidentMocks.listOpsIncidents).toHaveBeenLastCalledWith(expect.objectContaining({ query: 'PIX' }))

    renderWithSession(
      <Routes>
        <Route element={<OpsIncidentDetail />} path="/ops/incidents/:incidentId" />
      </Routes>,
      '/ops/incidents/incident-1',
    )
    expect(await screen.findByRole('heading', { name: 'Affected work and investigation links' })).toBeVisible()
    expect(screen.getByRole('link', { name: /Flow flow-1/ })).toHaveAttribute('href', '/ops/flows/flow-1')
    expect(screen.getByRole('link', { name: /Open affected flows/ })).toHaveAttribute('href', '/ops/flows?failure=FAILED_FLOW')
  })

  test('shows shift escalation context and non-secret integration health', async () => {
    renderWithSession(<OpsShiftHandoff />, '/ops/incidents/handoff')
    expect(await screen.findByText('Provider ticket is open.')).toBeVisible()
    expect(screen.getByRole('link', { name: 'Assign owner' })).toHaveAttribute('href', '/ops/incidents/incident-1')

    renderWithSession(<OpsIntegrations />, '/ops/administration/integrations')
    expect(await screen.findByRole('heading', { name: 'Operations notifications' })).toBeVisible()
    expect(screen.getByText('#ops-incidents')).toBeVisible()
    expect(screen.getByRole('link', { name: /Open runbook/ })).toHaveAttribute(
      'href',
      'https://runbooks.abroad.finance/provider-throttling',
    )
    expect(screen.queryByText('super-secret-value')).not.toBeInTheDocument()
  })

  test('explains consumed bridge float and drills into provider and transaction evidence', async () => {
    renderWithSession(<BridgeOps />, '/ops/treasury/bridge')

    expect(await screen.findByRole('heading', { name: 'Customer payout float' })).toBeVisible()
    expect(screen.getByText(/Consumed float can remain while legs are already batched/)).toBeVisible()
    expect(screen.getByRole('link', { name: 'Transaction' })).toHaveAttribute('href', '/ops/transactions/transaction-1')
    expect(screen.getByRole('link', { name: 'Open batch' })).toHaveAttribute(
      'href',
      '/ops/treasury/bridge/batches/batch-1',
    )

    renderWithSession(
      <Routes>
        <Route element={<OpsBridgeBatchDetail />} path="/ops/treasury/bridge/batches/:batchId" />
      </Routes>,
      '/ops/treasury/bridge/batches/batch-1',
    )
    expect(await screen.findByText('withdrawal-1')).toBeVisible()
    expect(screen.getByRole('link', { name: 'Open transaction' })).toHaveAttribute(
      'href',
      '/ops/transactions/transaction-1',
    )
  })

  test('retains last-good treasury balances when only that panel refresh fails', async () => {
    renderWithSession(<TreasuryDashboard />, '/ops/treasury')

    expect(await screen.findByRole('heading', { name: 'Current balances' })).toBeVisible()
    expect(screen.getByText('1 hr')).toBeVisible()
    treasuryMocks.getTreasuryBalances.mockRejectedValueOnce(new Error('Provider timeout'))
    await userEvent.click(screen.getByRole('button', { name: 'Refresh all panels' }))

    const balanceError = await screen.findByText(/Balances refresh failed:/)
    expect(balanceError).toBeVisible()
    expect(balanceError).toHaveTextContent('Provider timeout')
    expect(screen.getByRole('heading', { name: 'BRZ' })).toBeVisible()
  })
})

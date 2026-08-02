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

import type { FlowInstanceListResponse } from '../services/admin/flowTypes'
import type { OpsSession } from '../services/admin/opsAuthStore'
import type {
  OpsTransactionDetail,
  OpsTransactionListResponse,
  OpsTransactionSummary,
} from '../services/admin/transactionAdminTypes'

import FlowOpsList from '../pages/Ops/FlowOpsList'
import OpsGlobalSearch from '../pages/Ops/OpsGlobalSearch'
import TransactionDetail from '../pages/Ops/TransactionDetail'
import TransactionReconcile from '../pages/Ops/TransactionReconcile'
import TransactionsList from '../pages/Ops/TransactionsList'
import { setOpsSession } from '../services/admin/opsAuthStore'
import { ImmediateOpsMutationProvider } from './opsMutationTestUtils'

const transactionMocks = vi.hoisted(() => ({
  exportFilteredTransactionEvidence: vi.fn(),
  exportTransactionEvidence: vi.fn(),
  getTransaction: vi.fn(),
  getTransactionReceipt: vi.fn(),
  reconcileTransactionHash: vi.fn(),
  searchTransactions: vi.fn(),
}))
const investigationMocks = vi.hoisted(() => ({
  addOpsCaseNote: vi.fn(),
  createOpsCase: vi.fn(),
  createOpsSavedView: vi.fn(),
  deleteOpsSavedView: vi.fn(),
  globalOpsSearch: vi.fn(),
  handoffOpsCase: vi.fn(),
  listOpsCaseOwners: vi.fn(),
  listOpsSavedViews: vi.fn(),
  updateOpsCase: vi.fn(),
  updateOpsSavedView: vi.fn(),
}))
const flowMocks = vi.hoisted(() => ({
  bulkRetryFlowInstances: vi.fn(),
  listFlowInstances: vi.fn(),
}))

vi.mock('../services/admin/transactionAdminApi', () => transactionMocks)
vi.mock('../services/admin/opsInvestigationApi', () => investigationMocks)
vi.mock('../services/admin/flowAdminApi', () => flowMocks)

const session: OpsSession = {
  authenticatedAt: '2026-08-02T15:00:00.000Z',
  bootstrapRequired: false,
  displayName: 'Operations Operator',
  email: 'operator@abroad.finance',
  kind: 'ops_user',
  permissions: [
    'cases:manage',
    'flows:read',
    'flows:recover',
    'saved_views:manage',
    'transactions:export',
    'transactions:proof',
    'transactions:read',
    'transactions:reconcile',
  ],
  role: 'OPERATIONS',
  sessionVersion: 1,
  stepUpExpiresAt: '2099-08-02T15:10:00.000Z',
  userId: 'ops-user-1',
}

const transactionSummary: OpsTransactionSummary = {
  attentionReasons: ['PROOF_MISSING'],
  case: {
    id: 'case-1',
    owner: { displayName: 'Support Operator', id: 'ops-user-2' },
    priority: 'HIGH',
    status: 'ACKNOWLEDGED',
    team: 'Support',
    updatedAt: '2026-08-02T15:03:00.000Z',
    version: 2,
  },
  createdAt: '2026-08-02T15:00:00.000Z',
  flow: {
    currentStepOrder: 2,
    id: 'flow-1',
    status: 'WAITING',
    updatedAt: '2026-08-02T15:04:00.000Z',
  },
  id: 'tx-1',
  partner: { id: 'partner-1', name: 'Decaf' },
  proof: { receiptEligible: true, status: 'MISSING' },
  provider: { code: 'PIX', label: 'Transfero Ultra' },
  quote: {
    country: 'CO',
    cryptoCurrency: 'USDC',
    network: 'STELLAR',
    paymentMethod: 'PIX',
    quoteId: 'quote-1',
    sourceAmount: 100,
    targetAmount: 500,
    targetCurrency: 'BRL',
  },
  refund: { onChainId: null, status: 'NOT_APPLICABLE' },
  sla: { ageMinutes: 18, state: 'AT_RISK', targetMinutes: 20 },
  status: 'PROCESSING_PAYMENT',
  webhook: {
    attempts: 1, httpStatus: 202, lastAttemptAt: '2026-08-02T15:02:00.000Z', status: 'PENDING',
  },
}

const transactionList: OpsTransactionListResponse = {
  items: [transactionSummary],
  page: 1,
  pageSize: 20,
  statusCounts: [
    { count: 0, status: 'AWAITING_PAYMENT' },
    { count: 1, status: 'PROCESSING_PAYMENT' },
    { count: 0, status: 'PAYMENT_FAILED' },
    { count: 0, status: 'PAYMENT_EXPIRED' },
    { count: 0, status: 'PAYMENT_COMPLETED' },
    { count: 0, status: 'WRONG_AMOUNT' },
  ],
  total: 1,
}

const transactionDetail: OpsTransactionDetail = {
  ...transactionSummary,
  case: {
    handoffs: [],
    id: 'case-1',
    notes: [{
      author: { displayName: 'Support Operator', id: 'ops-user-2' },
      body: 'Provider evidence requested; no recipient data included.',
      createdAt: '2026-08-02T15:05:00.000Z',
      id: 'note-1',
      kind: 'NOTE',
    }],
    owner: { displayName: 'Support Operator', id: 'ops-user-2' },
    priority: 'HIGH',
    status: 'ACKNOWLEDGED',
    team: 'Support',
    updatedAt: '2026-08-02T15:03:00.000Z',
    version: 2,
  },
  evidence: [{
    category: 'QUOTE',
    description: '100 USDC to 500 BRL',
    id: 'quote:quote-1',
    occurredAt: '2026-08-02T15:00:00.000Z',
    state: 'INFO',
    title: 'Quote created',
  }, {
    category: 'FLOW',
    description: 'Awaiting provider status',
    id: 'flow:flow-1',
    occurredAt: '2026-08-02T15:04:00.000Z',
    state: 'PENDING',
    title: 'Provider confirmation pending',
  }],
  failure: null,
  identifiers: {
    externalId: 'provider-ref-1',
    flowInstanceId: 'flow-1',
    onChainId: 'chain-1',
    pixEndToEndId: null,
    quoteId: 'quote-1',
    refundOnChainId: null,
    transactionId: 'tx-1',
  },
  latestEvent: {
    category: 'FLOW',
    description: 'Awaiting provider status',
    id: 'flow:flow-1',
    occurredAt: '2026-08-02T15:04:00.000Z',
    state: 'PENDING',
    title: 'Provider confirmation pending',
  },
  payoutDestinationHint: '•••• 0497',
  summary: '500 BRL PIX payout for Decaf is awaiting provider confirmation.',
  webhookDeliveries: [],
}

const flowList: FlowInstanceListResponse = {
  items: [{
    createdAt: '2026-08-02T15:00:00.000Z',
    currentStep: { status: 'WAITING', stepOrder: 2, stepType: 'AWAIT_PROVIDER_STATUS' },
    currentStepOrder: 2,
    definition: {
      blockchain: 'STELLAR',
      cryptoCurrency: 'USDC',
      exchangeFeePct: 0.01,
      fixedFee: 1,
      id: 'definition-1',
      maxAmount: null,
      minAmount: null,
      name: 'Stellar USDC to PIX BRL',
      payoutProvider: 'PIX',
      pricingProvider: 'TRANSFERO',
      targetCurrency: 'BRL',
    },
    id: 'flow-1',
    status: 'WAITING',
    stepSummary: {
      failed: 0, ready: 0, running: 0, skipped: 0, succeeded: 1, total: 2, waiting: 1,
    },
    transaction: {
      externalId: 'provider-ref-1',
      id: 'tx-1',
      onChainId: 'chain-1',
      partner: { id: 'partner-1', name: 'Decaf' },
      refundOnChainId: null,
      status: 'PROCESSING_PAYMENT',
    },
    transactionId: 'tx-1',
    updatedAt: '2026-08-02T15:04:00.000Z',
  }],
  page: 1,
  pageSize: 20,
  statusCounts: [
    { count: 0, status: 'NOT_STARTED' },
    { count: 0, status: 'IN_PROGRESS' },
    { count: 1, status: 'WAITING' },
    { count: 0, status: 'FAILED' },
    { count: 0, status: 'COMPLETED' },
  ],
  total: 1,
}

const renderPage = (page: React.ReactNode, entry: string) => render(
  <MemoryRouter initialEntries={[entry]}>
    <ImmediateOpsMutationProvider>{page}</ImmediateOpsMutationProvider>
  </MemoryRouter>,
)

beforeEach(() => {
  setOpsSession(session)
  investigationMocks.listOpsCaseOwners.mockResolvedValue([{ displayName: 'Support Operator', id: 'ops-user-2' }])
  investigationMocks.listOpsSavedViews.mockResolvedValue([])
  transactionMocks.searchTransactions.mockResolvedValue(transactionList)
  transactionMocks.getTransaction.mockResolvedValue(transactionDetail)
  flowMocks.listFlowInstances.mockResolvedValue(flowList)
})

afterEach(() => {
  setOpsSession(null)
  vi.clearAllMocks()
})

describe('Ops investigation workspace', () => {
  test('keeps transaction filters draft-only until applied and preserves URL filters', async () => {
    renderPage(<TransactionsList />, '/ops/transactions?status=PROCESSING_PAYMENT')
    await screen.findByRole('heading', { name: /500 BRL/ })
    expect(transactionMocks.searchTransactions).toHaveBeenCalledWith(expect.objectContaining({
      status: 'PROCESSING_PAYMENT',
    }), expect.any(AbortSignal))

    const user = userEvent.setup()
    await user.type(screen.getByLabelText('Search operational identifiers'), 'chain-1')
    expect(transactionMocks.searchTransactions).toHaveBeenCalledTimes(1)
    await user.click(screen.getByRole('button', { name: 'Apply filters' }))
    await waitFor(() => expect(transactionMocks.searchTransactions).toHaveBeenCalledTimes(2))
    expect(transactionMocks.searchTransactions).toHaveBeenLastCalledWith(expect.objectContaining({
      query: 'chain-1',
      status: 'PROCESSING_PAYMENT',
    }), expect.any(AbortSignal))
  })

  test('applies personal/team views and creates an explicitly shared view', async () => {
    const savedView = {
      createdAt: '2026-08-02T15:00:00.000Z',
      filters: { attention: 'PROOF_MISSING' as const },
      id: 'view-1',
      name: 'Missing PIX proof',
      owner: { displayName: 'Operations Operator', id: 'ops-user-1' },
      resource: 'TRANSACTIONS' as const,
      scope: 'TEAM' as const,
      updatedAt: '2026-08-02T15:00:00.000Z',
      version: 1,
    }
    investigationMocks.listOpsSavedViews.mockResolvedValue([savedView])
    investigationMocks.createOpsSavedView.mockResolvedValue({
      ...savedView,
      id: 'view-2',
      name: 'At-risk payouts',
    })
    renderPage(<TransactionsList />, '/ops/transactions')
    await screen.findByRole('heading', { name: /500 BRL/ })

    const user = userEvent.setup()
    await user.selectOptions(screen.getByRole('combobox', { name: 'Saved views' }), 'view-1')
    await waitFor(() => expect(transactionMocks.searchTransactions).toHaveBeenLastCalledWith(
      expect.objectContaining({ attention: 'PROOF_MISSING' }),
      expect.any(AbortSignal),
    ))

    await user.click(screen.getByRole('button', { name: 'Save current' }))
    await user.click(screen.getByRole('radio', { name: /Operations team/ }))
    await user.type(screen.getByLabelText('View name'), 'At-risk payouts')
    await user.click(screen.getByRole('button', { name: 'Continue to save' }))

    await waitFor(() => expect(investigationMocks.createOpsSavedView).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'At-risk payouts',
        resource: 'TRANSACTIONS',
        scope: 'TEAM',
      }),
      expect.any(Object),
    ))
  })

  test('composes a PII-minimized transaction timeline, proof state, and durable case', async () => {
    render(
      <MemoryRouter initialEntries={['/ops/transactions/tx-1']}>
        <ImmediateOpsMutationProvider>
          <Routes>
            <Route element={<TransactionDetail />} path="/ops/transactions/:transactionId" />
          </Routes>
        </ImmediateOpsMutationProvider>
      </MemoryRouter>,
    )

    expect((await screen.findAllByText('Provider confirmation pending')).length).toBe(2)
    expect(screen.getByRole('heading', { name: 'Completion proof' })).toBeVisible()
    expect(screen.getByRole('heading', { name: 'Operations case' })).toBeVisible()
    expect(screen.getByText('•••• 0497')).toBeVisible()
    expect(screen.queryByText('private-tax-id')).not.toBeInTheDocument()
    expect(screen.getByText('Provider evidence requested; no recipient data included.')).toBeVisible()
  })

  test('runs global search only after explicit submission and links grouped results', async () => {
    investigationMocks.globalOpsSearch.mockResolvedValue({
      items: [{
        context: 'Decaf · 500 BRL',
        kind: 'TRANSACTION',
        matchedFields: ['on-chain ID'],
        route: '/ops/transactions/tx-1',
        secondary: 'Processing payment',
        title: '500 BRL payout',
      }],
      query: 'chain-1',
      truncated: false,
    })
    renderPage(<OpsGlobalSearch />, '/ops/search')
    const user = userEvent.setup()
    await user.type(screen.getByLabelText('Operational identifier or partner'), 'chain-1')
    expect(investigationMocks.globalOpsSearch).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Search' }))

    expect(await screen.findByRole('link', { name: /500 BRL payout/ })).toHaveAttribute('href', '/ops/transactions/tx-1')
    expect(investigationMocks.globalOpsSearch).toHaveBeenCalledWith('chain-1', expect.any(AbortSignal))
  })

  test('leads reconciliation with exceptions and explains repair impact', async () => {
    renderPage(<TransactionReconcile />, '/ops/transactions/reconcile?transactionId=tx-1')

    expect(await screen.findByRole('heading', { name: /500 BRL/ })).toBeVisible()
    expect(screen.getByText(/does not directly send a payout or refund/i)).toBeVisible()
    expect(screen.getByLabelText('Abroad transaction ID (optional)')).toHaveValue('tx-1')
    expect(transactionMocks.searchTransactions).toHaveBeenCalledWith(expect.objectContaining({
      attention: 'ALL',
    }), expect.any(AbortSignal))
  })

  test('keeps flow filters draft-only and exposes partner/corridor context', async () => {
    renderPage(<FlowOpsList />, '/ops/flows?status=WAITING')
    expect(await screen.findByRole('heading', { name: 'Stellar USDC to PIX BRL' })).toBeVisible()
    expect(screen.getByText(/Decaf/)).toBeVisible()

    const user = userEvent.setup()
    await user.type(screen.getByLabelText('Transaction ID'), 'tx-1')
    expect(flowMocks.listFlowInstances).toHaveBeenCalledTimes(1)
    await user.click(screen.getByRole('button', { name: 'Apply filters' }))
    await waitFor(() => expect(flowMocks.listFlowInstances).toHaveBeenCalledTimes(2))
    expect(flowMocks.listFlowInstances).toHaveBeenLastCalledWith(expect.objectContaining({
      status: 'WAITING',
      transactionId: 'tx-1',
    }), expect.any(AbortSignal))
  })
})

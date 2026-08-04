import {
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react'
import {
  MemoryRouter,
  Route,
  Routes,
} from 'react-router-dom'
import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'

import type {
  ConsumerActivityReceiptDto,
  ConsumerActivityTransactionDto,
} from '../api'

import ActivityDetailPage from '../pages/Activity/ActivityDetailPage'
import ActivityListPage from '../pages/Activity/ActivityListPage'
import { expectNoAccessibilityViolations } from './accessibility'

vi.mock('@tolgee/react', () => ({
  useTranslate: () => ({
    t: (_key: string, fallback: string, params?: Record<string, number | string>) => (
      Object.entries(params ?? {}).reduce(
        (translated, [name, value]) => translated.replace(`{${name}}`, String(value)),
        fallback,
      )
    ),
  }),
}))

const mocked = vi.hoisted(() => ({
  detailHook: vi.fn(),
  listHook: vi.fn(),
  receiptDownloadHook: vi.fn(),
}))

vi.mock('../features/activity/hooks/useConsumerActivity', () => ({
  useConsumerActivityDetail: mocked.detailHook,
  useConsumerActivityList: mocked.listHook,
  useConsumerActivityReceiptDownload: mocked.receiptDownloadHook,
}))

const activity = {
  id: '11111111-1111-4111-8111-111111111111',
  proof: { receiptAvailable: false, status: 'PENDING' },
  quote: {
    country: 'BR',
    network: 'STELLAR',
    paymentMethod: 'PIX',
    sourceAmount: 100,
    sourceCurrency: 'USDC',
    targetAmount: 525.4,
    targetCurrency: 'BRL',
  },
  recipientHint: '•••• 1234',
  refund: { reference: null, status: 'NOT_APPLICABLE' },
  status: 'PROCESSING_PAYMENT',
  timestamps: {
    acceptedAt: '2026-08-01T10:00:00.000Z',
    completedAt: null,
    createdAt: '2026-08-01T10:00:00.000Z',
    lastReconciledAt: null,
    payoutSubmittedAt: '2026-08-01T10:03:00.000Z',
    updatedAt: '2026-08-01T10:03:00.000Z',
  },
} satisfies ConsumerActivityTransactionDto

const receipt = {
  ...activity,
  effectiveRate: '5.254',
  fee: null,
  lifecycle: [{ occurredAt: activity.timestamps.createdAt, status: 'AWAITING_PAYMENT', type: 'CREATED' }, { occurredAt: activity.timestamps.updatedAt, status: 'PROCESSING_PAYMENT', type: 'STATUS_CHANGED' }],
  references: {
    abroadId: activity.id,
    brebId: null,
    onChainId: 'on-chain-reference',
    pixEndToEndId: null,
    providerId: 'provider-reference',
    refundOnChainId: null,
  },
} satisfies ConsumerActivityReceiptDto

beforeEach(() => {
  mocked.listHook.mockReset()
  mocked.detailHook.mockReset()
  mocked.receiptDownloadHook.mockReset()
  mocked.listHook.mockReturnValue({
    error: null,
    isRefreshing: false,
    items: [activity],
    lastUpdatedAt: new Date('2026-08-01T10:04:00.000Z'),
    page: 2,
    pageSize: 10,
    refresh: vi.fn(),
    status: 'ready',
    total: 31,
  })
  mocked.detailHook.mockReturnValue({
    error: null,
    isRefreshing: false,
    lastUpdatedAt: new Date('2026-08-01T10:04:00.000Z'),
    receipt,
    refresh: vi.fn(),
    status: 'ready',
  })
  mocked.receiptDownloadHook.mockReturnValue({
    download: vi.fn(),
    error: null,
    isDownloading: false,
  })
})

describe('ActivityListPage', () => {
  const renderPage = (entry = '/activity?page=2&rail=PIX') => render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route element={<ActivityListPage />} path="/activity" />
      </Routes>
    </MemoryRouter>,
  )

  it('shows authoritative status, masked recipient, counts, and a restorable detail link', () => {
    renderPage()

    expect(screen.getByRole('heading', { name: 'Activity' })).toBeInTheDocument()
    expect(screen.getByText('•••• 1234')).toBeInTheDocument()
    expect(screen.getByText('Showing 1–1 of 31')).toBeInTheDocument()
    const detailLink = screen.getByRole('link', { name: /Processing payment/ })
    expect(within(detailLink).getByText('Processing payment')).toBeInTheDocument()
    expect(detailLink).toHaveAttribute(
      'href',
      expect.stringContaining(`/activity/${activity.id}`),
    )
    expect(screen.queryByText('Payment completed')).not.toBeInTheDocument()
  })

  it('has no automated accessibility violations in the Activity list', async () => {
    const { container } = renderPage()

    await expectNoAccessibilityViolations(container)
  })

  it('loads additional rows through a restorable page parameter', () => {
    renderPage()

    fireEvent.click(screen.getByRole('button', { name: 'Load more' }))

    expect(mocked.listHook).toHaveBeenLastCalledWith(
      expect.objectContaining({ page: 3, pageSize: 50, paymentMethod: 'PIX' }),
      { accumulatePages: true },
    )
  })

  it('replaces the load-more action with filter guidance at the bounded display limit', () => {
    mocked.listHook.mockReturnValue({
      error: null,
      isRefreshing: false,
      items: [activity],
      lastUpdatedAt: new Date('2026-08-01T10:04:00.000Z'),
      page: 10,
      pageSize: 50,
      refresh: vi.fn(),
      status: 'ready',
      total: 501,
    })

    renderPage('/activity?page=10')

    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent(
      'Showing the first 500 payments. Use filters or a date range to find older payments.',
    )
  })

  it('stores the selected sort order in the URL-backed Activity query', () => {
    renderPage('/activity')

    fireEvent.change(screen.getByRole('combobox', { name: 'Order' }), {
      target: { value: 'oldest' },
    })

    expect(mocked.listHook).toHaveBeenLastCalledWith(
      expect.objectContaining({ page: 1, sort: 'oldest' }),
      { accumulatePages: true },
    )
  })

  it('distinguishes a load error from a genuine empty state and exposes retry', () => {
    const refresh = vi.fn()
    mocked.listHook.mockReturnValue({
      error: 'Unable to load Activity right now.',
      isRefreshing: false,
      items: [],
      lastUpdatedAt: null,
      page: 1,
      pageSize: 20,
      refresh,
      status: 'error',
      total: 0,
    })
    renderPage('/activity')

    expect(screen.getByRole('alert')).toHaveTextContent('Unable to load Activity right now.')
    expect(screen.queryByText('No payments yet')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(refresh).toHaveBeenCalledOnce()
  })
})

describe('ActivityDetailPage', () => {
  it('has no automated accessibility violations in the receipt detail', async () => {
    const { container } = render(
      <MemoryRouter initialEntries={[`/activity/${activity.id}`]}>
        <Routes>
          <Route element={<ActivityDetailPage />} path="/activity/:transactionId" />
        </Routes>
      </MemoryRouter>,
    )

    await expectNoAccessibilityViolations(container)
  })

  it('renders processing truth and separately labelled nullable references without fabricated values', () => {
    render(
      <MemoryRouter initialEntries={[`/activity/${activity.id}`]}>
        <Routes>
          <Route element={<ActivityDetailPage />} path="/activity/:transactionId" />
        </Routes>
      </MemoryRouter>,
    )

    expect(screen.getByRole('heading', { name: 'Processing payment' })).toBeInTheDocument()
    expect(screen.getByText('Fee unavailable')).toBeInTheDocument()
    expect(screen.getByText('Abroad ID')).toBeInTheDocument()
    expect(screen.getByText('Provider reference')).toBeInTheDocument()
    expect(screen.getByText('On-chain transaction')).toBeInTheDocument()
    expect(screen.queryByText('Payment completed')).not.toBeInTheDocument()
    expect(screen.queryByText('$0.01')).not.toBeInTheDocument()
    expect(screen.queryByText(/Instant/)).not.toBeInTheDocument()
  })

  it('renders the exact customer fee snapshot and fee type when recorded', () => {
    mocked.detailHook.mockReturnValue({
      error: null,
      isRefreshing: false,
      lastUpdatedAt: new Date('2026-08-01T10:04:00.000Z'),
      receipt: {
        ...receipt,
        fee: { amount: '1.25', currency: 'USDC', type: 'COMBINED' },
      },
      refresh: vi.fn(),
      status: 'ready',
    })
    render(
      <MemoryRouter initialEntries={[`/activity/${activity.id}`]}>
        <Routes>
          <Route element={<ActivityDetailPage />} path="/activity/:transactionId" />
        </Routes>
      </MemoryRouter>,
    )

    expect(screen.getByText('1.25 USDC · Combined fee')).toBeInTheDocument()
  })

  it('does not claim an ambiguous refund is complete', () => {
    mocked.detailHook.mockReturnValue({
      error: null,
      isRefreshing: false,
      lastUpdatedAt: new Date('2026-08-01T10:04:00.000Z'),
      receipt: {
        ...receipt,
        refund: { reference: null, status: 'UNKNOWN' },
      },
      refresh: vi.fn(),
      status: 'ready',
    })
    render(
      <MemoryRouter initialEntries={[`/activity/${activity.id}`]}>
        <Routes>
          <Route element={<ActivityDetailPage />} path="/activity/:transactionId" />
        </Routes>
      </MemoryRouter>,
    )

    expect(screen.getByText('Refund status needs review')).toBeInTheDocument()
    expect(screen.queryByText('Refund completed')).not.toBeInTheDocument()
  })
})

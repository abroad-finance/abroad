import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'

import PartnerTransactions from '../pages/PartnerPortal/PartnerTransactions'
import { PartnerPortalTestProviders } from './partnerPortalTestProviders'

const mocked = vi.hoisted(() => ({
  exportPartnerTransactions: vi.fn(),
  listPartnerTransactions: vi.fn(),
}))

vi.mock('../services/partnerPortal/partnerPortalApi', () => ({
  exportPartnerTransactions: mocked.exportPartnerTransactions,
  listPartnerTransactions: mocked.listPartnerTransactions,
}))

const transaction = {
  createdAt: '2026-07-30T10:00:00.000Z',
  id: '11111111-1111-4111-8111-111111111111',
  onChainId: '0xabc',
  quote: {
    country: 'BR',
    cryptoCurrency: 'USDC',
    network: 'POLYGON',
    paymentMethod: 'PIX',
    sourceAmount: 20,
    targetAmount: 105.75,
    targetCurrency: 'BRL',
  },
  status: 'PAYMENT_COMPLETED' as const,
  userReference: 'decaf-user-42',
}

const response = {
  items: [transaction],
  page: 1,
  pageSize: 20,
  statusCounts: [
    { count: 0, status: 'AWAITING_PAYMENT' as const },
    { count: 0, status: 'PROCESSING_PAYMENT' as const },
    { count: 0, status: 'PAYMENT_FAILED' as const },
    { count: 0, status: 'PAYMENT_EXPIRED' as const },
    { count: 1, status: 'PAYMENT_COMPLETED' as const },
    { count: 0, status: 'WRONG_AMOUNT' as const },
  ],
  total: 21,
}

afterEach(() => {
  vi.clearAllMocks()
})

describe('PartnerTransactions', () => {
  it('renders the partner ledger and applies status, search, date, and pagination filters', async () => {
    mocked.listPartnerTransactions.mockResolvedValue(response)
    render(
      <PartnerPortalTestProviders>
        <MemoryRouter>
          <PartnerTransactions />
        </MemoryRouter>
      </PartnerPortalTestProviders>,
    )
    const user = userEvent.setup()

    expect(await screen.findAllByText('#11111111')).not.toHaveLength(0)
    expect(screen.getAllByText('decaf-user-42')).not.toHaveLength(0)
    expect(screen.getAllByText('105.75 BRL')).not.toHaveLength(0)

    await user.click(screen.getByRole('button', { name: 'Completed 1' }))
    await waitFor(() => expect(mocked.listPartnerTransactions).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: 'PAYMENT_COMPLETED' }),
      expect.any(AbortSignal),
    ))

    await user.type(screen.getByLabelText('Search'), 'decaf-user-42')
    await user.type(screen.getByLabelText('From'), '2026-07-01')
    await user.type(screen.getByLabelText('To'), '2026-07-31')
    await user.click(screen.getByRole('button', { name: 'Apply filters' }))
    await waitFor(() => expect(mocked.listPartnerTransactions).toHaveBeenLastCalledWith(
      expect.objectContaining({
        createdFrom: '2026-07-01',
        createdTo: '2026-07-31',
        query: 'decaf-user-42',
        status: 'PAYMENT_COMPLETED',
      }),
      expect.any(AbortSignal),
    ))

    await user.click(screen.getByRole('button', { name: 'Next page' }))
    await waitFor(() => expect(mocked.listPartnerTransactions).toHaveBeenLastCalledWith(
      expect.objectContaining({ page: 2 }),
      expect.any(AbortSignal),
    ))
  })

  it('presents an actionable empty state', async () => {
    mocked.listPartnerTransactions.mockResolvedValue({ ...response, items: [], total: 0 })
    render(
      <PartnerPortalTestProviders>
        <MemoryRouter>
          <PartnerTransactions />
        </MemoryRouter>
      </PartnerPortalTestProviders>,
    )

    expect(await screen.findByText('No matching transactions')).toBeInTheDocument()
    expect(screen.getByText('Adjust the status, dates, or search reference.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Connect your AI client' })).toHaveAttribute(
      'href',
      '/partner/integration/ai?from=transaction-empty',
    )
  })
})

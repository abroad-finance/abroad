import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'

import PartnerTransactionDetail from '../pages/PartnerPortal/PartnerTransactionDetail'

const mocked = vi.hoisted(() => ({
  getPartnerTransaction: vi.fn(),
}))

vi.mock('../services/partnerPortal/partnerPortalApi', () => ({
  getPartnerTransaction: mocked.getPartnerTransaction,
}))

afterEach(() => {
  vi.clearAllMocks()
})

describe('PartnerTransactionDetail', () => {
  it('shows the safe financial route, lifecycle, and partner delivery state', async () => {
    mocked.getPartnerTransaction.mockResolvedValue({
      createdAt: '2026-07-30T10:00:00.000Z',
      deliveries: [{
        attempts: 1,
        event: 'transaction.updated',
        lastAttemptAt: '2026-07-30T10:06:00.000Z',
        status: 'DELIVERED',
      }],
      id: '11111111-1111-4111-8111-111111111111',
      lifecycle: [{ occurredAt: '2026-07-30T10:00:00.000Z', status: 'AWAITING_PAYMENT', type: 'CREATED' }, { occurredAt: '2026-07-30T10:05:00.000Z', status: 'PAYMENT_COMPLETED', type: 'STATUS_CHANGED' }],
      onChainId: '0xabc',
      payoutDestinationHint: '•••• 1234',
      quote: {
        country: 'BR',
        cryptoCurrency: 'USDC',
        network: 'POLYGON',
        paymentMethod: 'PIX',
        sourceAmount: 20,
        targetAmount: 105.75,
        targetCurrency: 'BRL',
      },
      status: 'PAYMENT_COMPLETED',
      userReference: 'decaf-user-42',
    })

    render(
      <MemoryRouter initialEntries={['/partner/transactions/11111111-1111-4111-8111-111111111111']}>
        <Routes>
          <Route element={<PartnerTransactionDetail />} path="/partner/transactions/:transactionId" />
        </Routes>
      </MemoryRouter>,
    )

    expect(await screen.findByRole('heading', { name: '105.75 BRL payout' })).toBeInTheDocument()
    expect(screen.getByText('20 USDC')).toBeInTheDocument()
    expect(screen.getByText(/Destination •••• 1234/)).toBeInTheDocument()
    expect(screen.getByText('Status update')).toBeInTheDocument()
    expect(screen.getByText('Delivered')).toBeInTheDocument()
    expect(screen.getAllByText('Completed')).not.toHaveLength(0)
    expect(screen.queryByText(/tax/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/provider/i)).not.toBeInTheDocument()
  })

  it('uses a generic unavailable state for a missing or cross-tenant transaction', async () => {
    mocked.getPartnerTransaction.mockRejectedValue(new Error('Transaction not found'))
    render(
      <MemoryRouter initialEntries={['/partner/transactions/not-owned']}>
        <Routes>
          <Route element={<PartnerTransactionDetail />} path="/partner/transactions/:transactionId" />
        </Routes>
      </MemoryRouter>,
    )

    expect(await screen.findByRole('heading', { name: 'Transaction unavailable' })).toBeInTheDocument()
    expect(screen.getByText('Transaction not found')).toBeInTheDocument()
  })
})

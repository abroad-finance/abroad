import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'

import PartnerTransactionDetail from '../pages/PartnerPortal/PartnerTransactionDetail'
import { clearPartnerPortalSession, setPartnerPortalSession } from '../services/partnerPortal/partnerPortalSessionStore'

const mocked = vi.hoisted(() => ({
  getPartnerPixReceipt: vi.fn(),
  getPartnerTransaction: vi.fn(),
  redeliverPartnerWebhook: vi.fn(),
}))

vi.mock('../services/partnerPortal/partnerPortalApi', () => ({
  getPartnerPixReceipt: mocked.getPartnerPixReceipt,
  getPartnerTransaction: mocked.getPartnerTransaction,
  redeliverPartnerWebhook: mocked.redeliverPartnerWebhook,
}))

const transactionDetail = {
  createdAt: '2026-07-30T10:00:00.000Z',
  deliveries: [{
    attempts: 1,
    canRedeliver: false,
    durationMs: 83,
    event: 'transaction.updated',
    failureCode: null,
    httpStatus: 204,
    id: 'delivery-1',
    lastAttemptAt: '2026-07-30T10:06:00.000Z',
    nextAttemptAt: null,
    purpose: 'TRANSACTION',
    sourceDeliveryId: null,
    status: 'DELIVERED',
  }],
  failureReason: null,
  id: '11111111-1111-4111-8111-111111111111',
  lifecycle: [{ occurredAt: '2026-07-30T10:00:00.000Z', status: 'AWAITING_PAYMENT', type: 'CREATED' }, { occurredAt: '2026-07-30T10:05:00.000Z', status: 'PAYMENT_COMPLETED', type: 'STATUS_CHANGED' }],
  onChainId: '0xabc',
  payoutDestinationHint: '•••• 1234',
  pixEndToEndId: 'E1234567890123456789012345678901',
  quote: {
    country: 'BR',
    cryptoCurrency: 'USDC',
    network: 'POLYGON',
    paymentMethod: 'PIX',
    sourceAmount: 20,
    targetAmount: 105.75,
    targetCurrency: 'BRL',
  },
  refund: null,
  status: 'PAYMENT_COMPLETED',
  userReference: 'decaf-user-42',
} as const

const renderDetail = () => render(
  <MemoryRouter initialEntries={['/partner/transactions/11111111-1111-4111-8111-111111111111']}>
    <Routes>
      <Route element={<PartnerTransactionDetail />} path="/partner/transactions/:transactionId" />
    </Routes>
  </MemoryRouter>,
)

afterEach(() => {
  clearPartnerPortalSession()
  Reflect.deleteProperty(URL, 'createObjectURL')
  Reflect.deleteProperty(URL, 'revokeObjectURL')
  vi.clearAllMocks()
})

describe('PartnerTransactionDetail', () => {
  it('shows the safe financial route, lifecycle, and partner delivery state', async () => {
    mocked.getPartnerTransaction.mockResolvedValue(transactionDetail)

    renderDetail()

    expect(await screen.findByRole('heading', { name: '105.75 BRL payout' })).toBeInTheDocument()
    expect(screen.getByText('20 USDC')).toBeInTheDocument()
    expect(screen.getByText(/Destination •••• 1234/)).toBeInTheDocument()
    expect(screen.getByText('Status update')).toBeInTheDocument()
    expect(screen.getByText('Delivered')).toBeInTheDocument()
    expect(screen.getByText('PIX E2E ID')).toBeInTheDocument()
    expect(screen.getByText(transactionDetail.pixEndToEndId)).toBeInTheDocument()
    expect(screen.getAllByText('Completed')).not.toHaveLength(0)
    expect(screen.queryByText('Refund status')).not.toBeInTheDocument()
    expect(screen.queryByText('Failure reason')).not.toBeInTheDocument()
    expect(screen.queryByText(/tax/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/provider/i)).not.toBeInTheDocument()
  })

  it('shows completed refund evidence for a failed transaction', async () => {
    mocked.getPartnerTransaction.mockResolvedValue({
      ...transactionDetail,
      failureReason: 'The recipient account is closed.',
      refund: { onChainId: '0xrefund', status: 'COMPLETED' },
      status: 'PAYMENT_FAILED',
    })

    renderDetail()

    expect(await screen.findByText('Refund status')).toBeInTheDocument()
    expect(screen.getByText('Refunded')).toBeInTheDocument()
    expect(screen.getByText('Refund on-chain ID')).toBeInTheDocument()
    expect(screen.getByText('0xrefund')).toBeInTheDocument()
    expect(screen.getByText('Failure reason')).toBeInTheDocument()
    expect(screen.getByText('The recipient account is closed.')).toBeInTheDocument()
  })

  it('shows a processing refund before an on-chain ID is available', async () => {
    mocked.getPartnerTransaction.mockResolvedValue({
      ...transactionDetail,
      pixEndToEndId: null,
      refund: { onChainId: null, status: 'PROCESSING' },
      status: 'PAYMENT_FAILED',
    })

    renderDetail()

    expect(await screen.findByText('Refund processing')).toBeInTheDocument()
    expect(screen.getAllByText('Not available yet')).toHaveLength(2)
  })

  it('does not label a non-PIX transaction with a PIX identifier', async () => {
    mocked.getPartnerTransaction.mockResolvedValue({
      ...transactionDetail,
      pixEndToEndId: null,
      quote: { ...transactionDetail.quote, paymentMethod: 'BREB' },
    })

    renderDetail()

    expect(await screen.findByRole('heading', { name: '105.75 BRL payout' })).toBeInTheDocument()
    expect(screen.queryByText('PIX E2E ID')).not.toBeInTheDocument()
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

  it('downloads an available settled PIX receipt without exposing provider data', async () => {
    mocked.getPartnerTransaction.mockResolvedValue(transactionDetail)
    mocked.getPartnerPixReceipt.mockResolvedValue({
      contentBase64: 'JVBERg==',
      contentType: 'application/pdf',
      fileName: 'receipt.pdf',
      sizeBytes: 4,
    })
    const createObjectUrl = vi.fn(() => 'blob:receipt')
    const revokeObjectUrl = vi.fn()
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectUrl })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectUrl })
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
    renderDetail()
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Download PIX receipt' }))

    await waitFor(() => expect(mocked.getPartnerPixReceipt).toHaveBeenCalledWith(transactionDetail.id))
    expect(createObjectUrl).toHaveBeenCalledOnce()
    expect(anchorClick).toHaveBeenCalledOnce()
    expect(revokeObjectUrl).toHaveBeenCalledWith('blob:receipt')
  })

  it('shows safe failed-delivery diagnostics and uses controlled redelivery for an MFA administrator', async () => {
    setPartnerPortalSession({
      accessToken: 'admin-token',
      email: 'operator@decaf.so',
      expiresAt: '2099-01-01T00:00:00.000Z',
      mfaEnabled: true,
      mfaVerified: true,
      partnerName: 'Decaf',
      role: 'ADMIN',
      userId: 'user-1',
    })
    mocked.getPartnerTransaction.mockResolvedValue({
      ...transactionDetail,
      deliveries: [{
        ...transactionDetail.deliveries[0],
        canRedeliver: true,
        failureCode: 'HTTP_503',
        httpStatus: 503,
        status: 'FAILED',
      }],
    })
    mocked.redeliverPartnerWebhook.mockResolvedValue({
      alreadyExisted: false,
      attempts: 1,
      deliveryId: 'redelivery-1',
      durationMs: 91,
      httpStatus: 204,
      status: 'DELIVERED',
    })
    renderDetail()
    const user = userEvent.setup()

    expect(await screen.findByText('HTTP_503')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Redeliver webhook' }))

    await waitFor(() => expect(mocked.redeliverPartnerWebhook).toHaveBeenCalledOnce())
    expect(mocked.redeliverPartnerWebhook).toHaveBeenCalledWith(
      transactionDetail.id,
      'delivery-1',
      expect.stringMatching(/^portal-\d+-delivery-1$/u),
    )
  })
})

import type { ComponentProps } from 'react'

import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'

import type { ConsumerActivityReceiptDto } from '../api'

import TxStatus from '../features/swap/components/TxStatus'

const recordConsumerUxEventMock = vi.hoisted(() => vi.fn())

vi.mock('@tolgee/react', () => ({
  useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}))

const activityMock = vi.hoisted(() => vi.fn())

vi.mock('../features/activity/hooks/useConsumerActivity', () => ({
  useConsumerActivityDetail: activityMock,
}))

vi.mock('../observability/consumerUxTelemetry', async (importOriginal) => {
  const original = await importOriginal<typeof import('../observability/consumerUxTelemetry')>()
  return {
    ...original,
    getCheckoutTelemetrySessionKey: () => '11111111-1111-4111-8111-111111111111',
    recordConsumerUxEvent: recordConsumerUxEventMock,
  }
})

const transactionId = '11111111-1111-4111-8111-111111111111'
const receiptFixture = (status: ConsumerActivityReceiptDto['status']): ConsumerActivityReceiptDto => ({
  effectiveRate: '5',
  fee: null,
  id: transactionId,
  lifecycle: [{ occurredAt: '2026-08-03T12:00:00.000Z', status: 'AWAITING_PAYMENT', type: 'CREATED' }],
  proof: { receiptAvailable: false, status: 'PENDING' },
  quote: {
    country: 'BR',
    network: 'STELLAR',
    paymentMethod: 'PIX',
    sourceAmount: 10,
    sourceCurrency: 'USDC',
    targetAmount: 50,
    targetCurrency: 'BRL',
  },
  recipientHint: '••••0497',
  references: {
    abroadId: transactionId,
    brebId: null,
    onChainId: null,
    pixEndToEndId: null,
    providerId: null,
    refundOnChainId: null,
  },
  refund: { reference: null, status: 'NOT_STARTED' },
  status,
  timestamps: {
    acceptedAt: '2026-08-03T12:00:00.000Z',
    completedAt: status === 'PAYMENT_COMPLETED' ? '2026-08-03T12:01:00.000Z' : null,
    createdAt: '2026-08-03T12:00:00.000Z',
    lastReconciledAt: null,
    payoutSubmittedAt: null,
    updatedAt: '2026-08-03T12:01:00.000Z',
  },
})

const renderStatus = (
  authorizationState: ComponentProps<typeof TxStatus>['authorizationState'],
  status: ConsumerActivityReceiptDto['status'] = 'AWAITING_PAYMENT',
) => {
  activityMock.mockReturnValue({
    error: null,
    isRefreshing: false,
    lastUpdatedAt: new Date('2026-08-03T12:02:00.000Z'),
    receipt: receiptFixture(status),
    refresh: vi.fn(async () => undefined),
    status: 'ready',
  })
  return render(
    <MemoryRouter>
      <TxStatus
        authorizationState={authorizationState}
        onNewTransaction={vi.fn()}
        onResumeAuthorization={vi.fn(async () => undefined)}
        transactionId={transactionId}
      />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  activityMock.mockReset()
  recordConsumerUxEventMock.mockReset()
})

describe('TxStatus financial truth and retry safety', () => {
  it('offers resume only for the exact request after explicit wallet rejection', () => {
    renderStatus({ kind: 'wallet-rejected', transactionId })

    expect(screen.getByRole('heading', { name: 'Wallet authorization cancelled' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Resume wallet authorization' })).toBeInTheDocument()
    expect(screen.getByText(transactionId)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /try again/i })).not.toBeInTheDocument()
  })

  it('prohibits another wallet mutation after an ambiguous broadcast', () => {
    renderStatus({ kind: 'broadcast-unknown', transactionId })

    expect(screen.getByRole('heading', { name: 'Transfer outcome is being checked' })).toBeInTheDocument()
    expect(screen.getByText(/Do not send it again/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Resume wallet authorization' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'View in Activity' })).toHaveAttribute('href', `/activity/${transactionId}`)
  })

  it('shows completed only from the authoritative lifecycle and routes to its receipt', () => {
    renderStatus({ kind: 'broadcast-confirmed', onChainId: 'chain-id', transactionId }, 'PAYMENT_COMPLETED')

    expect(screen.getByRole('heading', { name: 'Payment completed' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'View receipt' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'New payment' })).toBeInTheDocument()
    expect(screen.queryByText(/funds have been returned/i)).not.toBeInTheDocument()
  })

  it('never turns a failed payout into a refund claim', () => {
    renderStatus({ kind: 'broadcast-confirmed', onChainId: 'chain-id', transactionId }, 'PAYMENT_FAILED')

    expect(screen.getByText('The local payout did not complete.')).toBeInTheDocument()
    expect(screen.queryByText(/returned|refunded/i)).not.toBeInTheDocument()
  })

  it('records a privacy-safe exit when a nonterminal progress page is left', () => {
    renderStatus({ kind: 'broadcast-confirmed', onChainId: 'chain-id', transactionId }, 'PROCESSING_PAYMENT')
    recordConsumerUxEventMock.mockClear()

    window.dispatchEvent(new Event('pagehide'))
    window.dispatchEvent(new Event('pagehide'))

    const exits = recordConsumerUxEventMock.mock.calls.filter(([event]) => (
      typeof event === 'object'
      && event !== null
      && Reflect.get(event, 'name') === 'processing_exit'
    ))
    expect(exits).toHaveLength(1)
    expect(exits[0]?.[0]).toMatchObject({
      dimensions: {
        action: 'close',
        rail: 'PIX',
        status: 'PROCESSING',
        step: 'progress',
      },
    })
  })
})

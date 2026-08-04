import { fireEvent, render, screen } from '@testing-library/react'
import {
  describe, expect, it, vi,
} from 'vitest'

import ConfirmQr from '../features/swap/components/ConfirmQr'
import { expectNoAccessibilityViolations } from './accessibility'

vi.mock('@tolgee/react', () => ({
  useTranslate: () => ({
    t: (_key: string, fallback: string, params?: Record<string, number | string>) => (
      Object.entries(params ?? {}).reduce(
        (copy, [name, value]) => copy.replace(`{${name}}`, String(value)),
        fallback,
      )
    ),
  }),
}))

const baseProps = {
  currency: 'BRL' as const,
  exchangeRateDisplay: '1 USDC = 5.00 BRL',
  feeDisplay: null,
  networkLabel: 'Stellar',
  onBack: vi.fn(),
  onConfirm: vi.fn(),
  onEdit: vi.fn(),
  onRefreshQuote: vi.fn(),
  pixKey: 'recipient-fixture-key',
  quoteExpired: false,
  quoteRemainingSeconds: 125,
  recipientName: 'Synthetic recipient',
  selectedAssetLabel: 'USDC',
  sourceAmount: '10.00',
  targetAmount: '50.00',
  timingDisplay: null,
}

describe('payment review', () => {
  it('has no automated accessibility violations in the review surface', async () => {
    const { container } = render(<ConfirmQr {...baseProps} />)

    await expectNoAccessibilityViolations(container)
  })

  it('shows every authoritative review field and masks the recipient by default', () => {
    render(<ConfirmQr {...baseProps} />)

    expect(screen.getByText('Brazil · Pix · BRL')).toBeInTheDocument()
    expect(screen.getByText('Stellar')).toBeInTheDocument()
    expect(screen.getAllByText('10.00 USDC')).toHaveLength(2)
    expect(screen.getByText('R$ 50.00 BRL')).toBeInTheDocument()
    expect(screen.getByText('1 USDC = 5.00 BRL')).toBeInTheDocument()
    expect(screen.getAllByText('Unavailable')).toHaveLength(2)
    expect(screen.getByText('Locked quote · expires in 2:05')).toBeInTheDocument()
    expect(screen.queryByText('recipient-fixture-key')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Confirm and pay 10.00 USDC' })).toBeEnabled()

    fireEvent.click(screen.getByRole('button', { name: 'Reveal recipient' }))
    expect(screen.getByText('recipient-fixture-key')).toBeInTheDocument()
  })

  it('blocks authorization when the quote expired and provides a safe refresh action', () => {
    const onRefreshQuote = vi.fn()
    render(
      <ConfirmQr
        {...baseProps}
        onRefreshQuote={onRefreshQuote}
        quoteExpired={true}
        quoteRemainingSeconds={0}
      />,
    )

    expect(screen.getByRole('button', { name: 'Confirm and pay 10.00 USDC' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Refresh quote' }))
    expect(onRefreshQuote).toHaveBeenCalledTimes(1)
  })

  it('labels the busy authorization state instead of showing a spinner alone', () => {
    render(<ConfirmQr {...baseProps} loadingSubmit={true} />)

    expect(screen.getByRole('button', { name: 'Starting payment…' })).toBeDisabled()
    expect(screen.getByText('Starting payment. Keep this page open.')).toBeInTheDocument()
  })
})

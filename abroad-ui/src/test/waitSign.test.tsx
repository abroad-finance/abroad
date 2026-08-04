import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'

import WaitSign from '../features/swap/components/WaitSign'

vi.mock('@tolgee/react', () => ({
  useTranslate: () => ({
    t: (_key: string, fallback: string, params?: Record<string, number | string>) => (
      Object.entries(params ?? {}).reduce(
        (value, [name, replacement]) => value.replace(`{${name}}`, String(replacement)),
        fallback,
      )
    ),
  }),
}))

vi.mock('../shared/components/IconAnimated', () => ({
  IconAnimated: () => <div data-testid="authorization-icon" />,
}))

const clipboardWriteText = vi.fn<[], Promise<void>>()

beforeEach(() => {
  clipboardWriteText.mockReset()
  clipboardWriteText.mockResolvedValue()
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: clipboardWriteText },
  })
})

describe('WaitSign', () => {
  it('shows the accepted identity and wallet-specific MiniPay instructions', async () => {
    render(
      <WaitSign
        networkLabel="Celo"
        recipient="example-recipient-value"
        recipientName="Synthetic merchant"
        sourceAmount="10.25"
        sourceAsset="USDT"
        transactionId="11111111-1111-4111-8111-111111111111"
        walletCategory="minipay"
      />,
    )

    expect(screen.getByRole('heading', { name: 'Approve 10.25 USDT in your MiniPay' })).toBeInTheDocument()
    expect(screen.getByText(/Return to MiniPay/)).toBeInTheDocument()
    expect(screen.getByText('Synthetic merchant')).toBeInTheDocument()
    expect(screen.getByText('Celo')).toBeInTheDocument()
    expect(screen.getByText('Your Abroad request is already created.')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Copy' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Copied' })).toBeInTheDocument())
    expect(clipboardWriteText).toHaveBeenCalledWith('11111111-1111-4111-8111-111111111111')
  })

  it('uses Stellar instructions and masks a recipient when no verified name exists', () => {
    render(
      <WaitSign
        networkLabel="Stellar"
        recipient="recipient-value"
        sourceAmount="1.00"
        sourceAsset="USDC"
        transactionId="22222222-2222-4222-8222-222222222222"
        walletCategory="stellar"
      />,
    )

    expect(screen.getByText(/Choose your Stellar wallet/)).toBeInTheDocument()
    expect(screen.queryByText('MiniPay will ask you')).not.toBeInTheDocument()
    expect(screen.getByText('re••••••••ue')).toBeInTheDocument()
  })

  it('exposes clipboard failure without hiding the accepted request', async () => {
    clipboardWriteText.mockRejectedValueOnce(new Error('permission denied'))
    render(
      <WaitSign
        networkLabel="Solana"
        recipient="recipient-value"
        sourceAmount="2.00"
        sourceAsset="USDC"
        transactionId="33333333-3333-4333-8333-333333333333"
        walletCategory="walletconnect"
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Copy' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not copy the Abroad ID')
    expect(screen.getByText('33333333-3333-4333-8333-333333333333')).toBeInTheDocument()
  })
})

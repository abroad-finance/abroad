import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'

import BuyCryptoPixCode from '../features/swap/components/BuyCryptoPixCode'
import {
  arePaymentInstructionsExpired,
  formatExpiryCountdown,
  millisecondsUntilExpiry,
} from '../features/swap/shared/onrampPresentation'

const translate = (_key: string, fallback: string) => fallback

const quote = {
  sourceAmount: 91.482,
  sourceCurrency: 'USDC',
  targetAmount: 500,
  targetCurrency: 'BRL',
}

const BR_CODE = '00020126580014BR.GOV.BCB.PIX0136abc'

describe('onramp presentation helpers', () => {
  // A code with no stated expiry must stay payable: the backend owns
  // settlement, and treating a missing expiry as "expired" would strand a
  // customer who can still pay.
  it('treats a code without an expiry as payable', () => {
    expect(arePaymentInstructionsExpired({ brCode: BR_CODE, expiresAt: null })).toBe(false)
    expect(millisecondsUntilExpiry({ brCode: BR_CODE, expiresAt: null })).toBeNull()
  })

  it('reports a code as expired once its instant has passed', () => {
    const instructions = { brCode: BR_CODE, expiresAt: 1_000 }

    expect(arePaymentInstructionsExpired(instructions, 999)).toBe(false)
    expect(arePaymentInstructionsExpired(instructions, 1_000)).toBe(true)
    expect(arePaymentInstructionsExpired(instructions, 1_001)).toBe(true)
  })

  it('never reports negative time remaining', () => {
    expect(millisecondsUntilExpiry({ brCode: BR_CODE, expiresAt: 500 }, 5_000)).toBe(0)
  })

  it.each([
    [0, '0:00'],
    [1_000, '0:01'],
    [59_000, '0:59'],
    [60_000, '1:00'],
    [605_000, '10:05'],
  ])('formats %ims remaining as %s', (remaining, expected) => {
    expect(formatExpiryCountdown(remaining)).toBe(expected)
  })
})

describe('BuyCryptoPixCode', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.setSystemTime(new Date('2026-08-05T12:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  const renderCode = (expiresAt: null | number, handlers?: {
    onExpired?: () => void
    onStartOver?: () => void
  }) => render(
    <BuyCryptoPixCode
      instructions={{ brCode: BR_CODE, expiresAt }}
      onExpired={handlers?.onExpired ?? vi.fn()}
      onStartOver={handlers?.onStartOver ?? vi.fn()}
      quote={quote}
      translate={translate}
    />,
  )

  it('shows both legs of the purchase so the customer sees what they get', () => {
    renderCode(null)

    // The BRL leg leads, since that is the number the customer is about to pay.
    expect(screen.getByText(/500,00/)).toBeInTheDocument()
    expect(screen.getByText(/91\.482 USDC/)).toBeInTheDocument()
  })

  it('renders the payable code as selectable text', () => {
    renderCode(null)

    expect(screen.getByTestId('buy-crypto-br-code')).toHaveTextContent(BR_CODE)
  })

  it('copies the code to the clipboard and confirms it', async () => {
    const writeText = vi.fn(async () => undefined)
    Object.assign(navigator, { clipboard: { writeText } })
    renderCode(null)

    await userEvent.click(screen.getByRole('button', { name: 'Copy PIX code' }))

    expect(writeText).toHaveBeenCalledWith(BR_CODE)
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument()
  })

  // A blocked clipboard must not claim success; the code stays on screen for a
  // manual copy.
  it('does not claim a copy succeeded when the clipboard is blocked', async () => {
    const writeText = vi.fn(async () => {
      throw new Error('denied')
    })
    Object.assign(navigator, { clipboard: { writeText } })
    renderCode(null)

    await userEvent.click(screen.getByRole('button', { name: 'Copy PIX code' }))

    expect(screen.getByRole('button', { name: 'Copy PIX code' })).toBeInTheDocument()
    expect(screen.getByTestId('buy-crypto-br-code')).toHaveTextContent(BR_CODE)
  })

  it('shows a countdown only when the code carries an expiry', () => {
    const { unmount } = renderCode(null)
    expect(screen.queryByText(/Expires in/)).not.toBeInTheDocument()
    unmount()

    renderCode(Date.now() + 90_000)
    expect(screen.getByText(/Expires in/)).toBeInTheDocument()
    expect(screen.getByText(/1:30/)).toBeInTheDocument()
  })

  it('replaces the code with a restart prompt once it has expired', () => {
    const onExpired = vi.fn()
    renderCode(Date.now() - 1, { onExpired })

    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(screen.queryByTestId('buy-crypto-br-code')).not.toBeInTheDocument()
    expect(onExpired).toHaveBeenCalled()
  })

  it('lets the customer start over from an expired code', async () => {
    const onStartOver = vi.fn()
    renderCode(Date.now() - 1, { onStartOver })

    await userEvent.click(screen.getByRole('button', { name: 'Start again' }))

    expect(onStartOver).toHaveBeenCalled()
  })

  it('tells the customer the crypto arrives once the payment settles', () => {
    renderCode(null)

    expect(screen.getByText(/once the payment settles/)).toBeInTheDocument()
  })
})

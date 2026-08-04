import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  describe, expect, it, vi,
} from 'vitest'

import HomeScreen, { type HomeScreenProps } from '../features/swap/components/HomeScreen'
import { expectNoAccessibilityViolations } from './accessibility'

vi.mock('@tolgee/react', () => ({
  useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}))

const createProps = (
  targetCurrency: HomeScreenProps['targetCurrency'] = 'BRL',
): HomeScreenProps => ({
  balance: '25.00',
  hasEnteredApp: true,
  isAuthenticated: true,
  onGoToManual: vi.fn(),
  onHistoryClick: vi.fn(),
  onRequestConnect: vi.fn(),
  onSelectCurrency: vi.fn(),
  onUseQr: vi.fn(),
  recentTransactions: [],
  selectedTokenLabel: 'USDC',
  targetCurrency,
})

describe('HomeScreen payment actions', () => {
  it('has no automated accessibility violations in the returning-user entry surface', async () => {
    const { container } = render(<HomeScreen {...createProps()} />)

    await expectNoAccessibilityViolations(container)
  })

  it('exposes one PIX QR journey and a separate Pix-key journey', async () => {
    const props = createProps()
    const user = userEvent.setup()

    render(<HomeScreen {...props} />)

    const qrButton = screen.getByRole('button', { name: 'Use a Pix QR code' })
    const manualButton = screen.getByRole('button', { name: 'Pay with PIX key' })

    expect(screen.getByText('Camera, paste, or screenshot')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'PIX Copy & Paste' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Upload QR image' })).not.toBeInTheDocument()

    await user.click(qrButton)
    await user.click(manualButton)

    expect(props.onUseQr).toHaveBeenCalledOnce()
    expect(props.onGoToManual).toHaveBeenCalledOnce()
  })

  it('exposes one BRE-B QR journey and an official Llave BRE-B journey', async () => {
    const props = createProps('COP')
    const user = userEvent.setup()

    render(<HomeScreen {...props} />)

    const qrButton = screen.getByRole('button', { name: 'Use a BRE-B QR code' })
    const manualButton = screen.getByRole('button', { name: 'Pay with Llave BRE-B' })

    expect(screen.queryByRole('button', { name: 'Use a Pix QR code' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'PIX Copy & Paste' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Pay with PIX key' })).not.toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Select destination, payment rail, and settlement currency' })).toBeVisible()

    await user.click(qrButton)
    await user.click(manualButton)

    expect(props.onUseQr).toHaveBeenCalledOnce()
    expect(props.onGoToManual).toHaveBeenCalledOnce()
  })

  it('keeps the Home selector visible on desktop before wallet authentication', () => {
    render(<HomeScreen {...createProps()} isAuthenticated={false} />)

    expect(screen.getByRole('group', { name: 'Select destination, payment rail, and settlement currency' })).toBeVisible()
  })

  it('shows only live corridor networks and identifies the source and freshness of indicative rates', () => {
    const onEnterApp = vi.fn()
    render(
      <HomeScreen
        {...createProps()}
        hasEnteredApp={false}
        isAuthenticated={false}
        onboardingRates={{
          brl: { USDC: 5.25, USDT: 5.2 },
          cop: { USDC: 4_050, USDT: 4_000 },
          updatedAt: '2026-08-03T15:30:00.000Z',
        }}
        onEnterApp={onEnterApp}
        supportedNetworks={[{ key: 'polygon:137', label: 'Polygon' }]}
      />,
    )

    expect(screen.getByText('Polygon')).toBeVisible()
    expect(screen.queryByText('Stellar')).not.toBeInTheDocument()
    expect(screen.getByText(/From Abroad quotes · updated/)).toHaveTextContent(
      'Your final rate, fees, and amount are confirmed before payment.',
    )
    expect(screen.getByRole('button', { name: 'Continue' })).toBeVisible()
  })
})

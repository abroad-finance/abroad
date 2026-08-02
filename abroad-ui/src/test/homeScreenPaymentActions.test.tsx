import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  describe, expect, it, vi,
} from 'vitest'

import HomeScreen, { type HomeScreenProps } from '../features/swap/components/HomeScreen'

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
  onPasteQr: vi.fn(),
  onRequestConnect: vi.fn(),
  onScanQr: vi.fn(),
  onSelectCurrency: vi.fn(),
  recentTransactions: [],
  selectedTokenLabel: 'USDC',
  targetCurrency,
})

describe('HomeScreen payment actions', () => {
  it('exposes three PIX journeys without a duplicate upload action', async () => {
    const props = createProps()
    const user = userEvent.setup()

    render(<HomeScreen {...props} />)

    const scanButton = screen.getByRole('button', { name: 'Scan PIX QR' })
    const pasteButton = screen.getByRole('button', { name: 'PIX Copy & Paste' })
    const manualButton = screen.getByRole('button', { name: 'Pay with PIX key' })

    expect(screen.getByText('Use camera or image')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Upload QR image' })).not.toBeInTheDocument()
    expect(screen.queryByText('Scan or paste')).not.toBeInTheDocument()

    await user.click(scanButton)
    await user.click(pasteButton)
    await user.click(manualButton)

    expect(props.onScanQr).toHaveBeenCalledOnce()
    expect(props.onPasteQr).toHaveBeenCalledOnce()
    expect(props.onGoToManual).toHaveBeenCalledOnce()
  })

  it('exposes BRE-B journeys after selecting Colombia', async () => {
    const props = createProps('COP')
    const user = userEvent.setup()

    render(<HomeScreen {...props} />)

    const scanButton = screen.getByRole('button', { name: 'Scan BRE-B QR' })
    const pasteButton = screen.getByRole('button', { name: 'BRE-B Copy & Paste' })
    const manualButton = screen.getByRole('button', { name: 'Pay with BRE-B key' })

    expect(screen.queryByRole('button', { name: 'Scan PIX QR' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'PIX Copy & Paste' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Pay with PIX key' })).not.toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Select currency' })).toHaveClass('md:hidden')

    await user.click(scanButton)
    await user.click(pasteButton)
    await user.click(manualButton)

    expect(props.onScanQr).toHaveBeenCalledOnce()
    expect(props.onPasteQr).toHaveBeenCalledOnce()
    expect(props.onGoToManual).toHaveBeenCalledOnce()
  })

  it('keeps the Home selector visible on desktop before wallet authentication', () => {
    render(<HomeScreen {...createProps()} isAuthenticated={false} />)

    expect(screen.getByRole('group', { name: 'Select currency' })).not.toHaveClass('md:hidden')
  })
})

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  describe, expect, it, vi,
} from 'vitest'

import HomeScreen, { type HomeScreenProps } from '../features/swap/components/HomeScreen'

vi.mock('@tolgee/react', () => ({
  useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}))

const createProps = (): HomeScreenProps => ({
  balance: '25.00',
  hasEnteredApp: true,
  isAuthenticated: true,
  onGoToManual: vi.fn(),
  onHistoryClick: vi.fn(),
  onPasteQr: vi.fn(),
  onRequestConnect: vi.fn(),
  onScanQr: vi.fn(),
  onUploadQr: vi.fn(),
  recentTransactions: [],
  selectedTokenLabel: 'USDC',
  targetCurrency: 'BRL' as HomeScreenProps['targetCurrency'],
})

describe('HomeScreen payment actions', () => {
  it('exposes distinct scan, paste, upload, and manual payment actions', async () => {
    const props = createProps()
    const user = userEvent.setup()

    render(<HomeScreen {...props} />)

    const scanButton = screen.getByRole('button', { name: 'Scan to Pay' })
    const pasteButton = screen.getByRole('button', { name: 'Paste PIX code' })
    const uploadButton = screen.getByRole('button', { name: 'Upload QR image' })
    const manualButton = screen.getByRole('button', { name: 'Manual Payment' })

    expect(screen.queryByText('Scan or paste')).not.toBeInTheDocument()

    await user.click(scanButton)
    await user.click(pasteButton)
    await user.click(uploadButton)
    await user.click(manualButton)

    expect(props.onScanQr).toHaveBeenCalledOnce()
    expect(props.onPasteQr).toHaveBeenCalledOnce()
    expect(props.onUploadQr).toHaveBeenCalledOnce()
    expect(props.onGoToManual).toHaveBeenCalledOnce()
  })
})

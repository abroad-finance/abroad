import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  beforeEach, describe, expect, it, vi,
} from 'vitest'

import QrScannerFullScreen from '../features/swap/components/QrScannerFullScreen'

interface ScannerMockProps {
  onScan: (result: unknown) => void
}

vi.mock('@tolgee/react', () => ({
  useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}))

vi.mock('@yudiel/react-qr-scanner', () => ({
  Scanner: ({ onScan }: ScannerMockProps) => (
    <button onClick={() => onScan([{ rawValue: '  scanned-pix-code  ' }])} type="button">
      Simulate camera scan
    </button>
  ),
}))

beforeEach(() => {
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: vi.fn() },
  })
})

describe('QrScannerFullScreen', () => {
  it('submits a pasted PIX payload through the same result callback', async () => {
    const onResult = vi.fn()
    const user = userEvent.setup()

    render(<QrScannerFullScreen initialMode="paste" onClose={vi.fn()} onResult={onResult} />)

    const input = screen.getByLabelText('PIX Copia e Cola code')
    const continueButton = screen.getByRole('button', { name: 'Continue' })
    expect(screen.queryByRole('button', { name: 'Simulate camera scan' })).not.toBeInTheDocument()
    expect(continueButton).toBeDisabled()

    await user.type(input, '  0002010102112636-pix-payload  ')
    await user.click(continueButton)

    expect(onResult).toHaveBeenCalledOnce()
    expect(onResult).toHaveBeenCalledWith('0002010102112636-pix-payload')
  })

  it('keeps camera scanning on the shared result callback', async () => {
    const onResult = vi.fn()
    const user = userEvent.setup()

    render(<QrScannerFullScreen initialMode="camera" onClose={vi.fn()} onResult={onResult} />)

    await user.click(screen.getByRole('button', { name: 'Simulate camera scan' }))

    expect(onResult).toHaveBeenCalledOnce()
    expect(onResult).toHaveBeenCalledWith('scanned-pix-code')
  })

  it('shows a recoverable error when pasted-code processing rejects', async () => {
    const onResult = vi.fn().mockRejectedValueOnce(new Error('decode failed'))
    const user = userEvent.setup()

    render(<QrScannerFullScreen initialMode="paste" onClose={vi.fn()} onResult={onResult} />)

    await user.type(screen.getByLabelText('PIX Copia e Cola code'), '000201-pix-payload')
    await user.click(screen.getByRole('button', { name: 'Continue' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('We could not process this QR. Please try again.')
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled()
    })
  })
})

import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  beforeEach, describe, expect, it, vi,
} from 'vitest'

import QrScannerFullScreen from '../features/swap/components/QrScannerFullScreen'
import { expectNoAccessibilityViolations } from './accessibility'

const mocks = vi.hoisted(() => ({
  decodeQrImage: vi.fn(),
}))

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

vi.mock('../features/swap/shared/decodeQrImage', () => ({
  decodeQrImage: mocks.decodeQrImage,
}))

beforeEach(() => {
  mocks.decodeQrImage.mockReset()
  mocks.decodeQrImage.mockResolvedValue({ ok: true, value: 'decoded-pix-code' })
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: vi.fn() },
  })
})

describe('QrScannerFullScreen', () => {
  it('has no automated accessibility violations in the consolidated QR surface', async () => {
    const { container } = render(<QrScannerFullScreen currency="BRL" initialMode="paste" onClose={vi.fn()} onResult={vi.fn()} rail="PIX" />)

    await expectNoAccessibilityViolations(container)
  })

  it('submits a pasted PIX payload through the same result callback', async () => {
    const onResult = vi.fn()
    const user = userEvent.setup()

    render(<QrScannerFullScreen currency="BRL" initialMode="paste" onClose={vi.fn()} onResult={onResult} rail="PIX" />)

    const input = screen.getByLabelText('Pix Copia e Cola')
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

    render(<QrScannerFullScreen currency="BRL" initialMode="camera" onClose={vi.fn()} onResult={onResult} rail="PIX" />)

    expect(screen.getByRole('button', { name: 'Upload image' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Pix Copia e Cola' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Simulate camera scan' }))

    expect(onResult).toHaveBeenCalledOnce()
    expect(onResult).toHaveBeenCalledWith('scanned-pix-code')
  })

  it('shows a recoverable error when pasted-code processing rejects', async () => {
    const onResult = vi.fn().mockRejectedValueOnce(new Error('decode failed'))
    const user = userEvent.setup()

    render(<QrScannerFullScreen currency="BRL" initialMode="paste" onClose={vi.fn()} onResult={onResult} rail="PIX" />)

    await user.type(screen.getByLabelText('Pix Copia e Cola'), '000201-pix-payload')
    await user.click(screen.getByRole('button', { name: 'Continue' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('We could not process this QR. Please try again.')
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled()
    })
  })

  it('decodes an uploaded image through the shared result callback', async () => {
    const onResult = vi.fn()
    const user = userEvent.setup()
    const qrImage = new File(['qr-image'], 'merchant-qr.png', { type: 'image/png' })

    render(<QrScannerFullScreen currency="BRL" initialMode="upload" onClose={vi.fn()} onResult={onResult} rail="PIX" />)

    expect(screen.queryByRole('button', { name: 'Simulate camera scan' })).not.toBeInTheDocument()
    expect(screen.getByText('Your image is never uploaded.', { exact: false })).toBeInTheDocument()

    await user.upload(screen.getByLabelText('Choose QR image'), qrImage)

    await waitFor(() => expect(mocks.decodeQrImage).toHaveBeenCalledWith(qrImage))
    expect(onResult).toHaveBeenCalledOnce()
    expect(onResult).toHaveBeenCalledWith('decoded-pix-code')
  })

  it('shows a recoverable error when an uploaded image has no QR code', async () => {
    mocks.decodeQrImage.mockResolvedValueOnce({ error: 'no-qr-found', ok: false })
    const onResult = vi.fn()
    const user = userEvent.setup()
    const qrImage = new File(['not-a-qr'], 'photo.png', { type: 'image/png' })

    render(<QrScannerFullScreen currency="BRL" initialMode="upload" onClose={vi.fn()} onResult={onResult} rail="PIX" />)

    await user.upload(screen.getByLabelText('Choose QR image'), qrImage)

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'No QR code was found. Try a clearer image or a tighter crop.',
    )
    expect(onResult).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Choose QR image')).toBeEnabled()
  })

  it('allows another image when decoded-code processing rejects', async () => {
    const onResult = vi.fn().mockRejectedValueOnce(new Error('PIX decode rejected'))
    const user = userEvent.setup()
    const qrImage = new File(['qr-image'], 'merchant-qr.png', { type: 'image/png' })

    render(<QrScannerFullScreen currency="BRL" initialMode="upload" onClose={vi.fn()} onResult={onResult} rail="PIX" />)

    await user.upload(screen.getByLabelText('Choose QR image'), qrImage)

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'We could not process this QR. Please try again.',
    )
    expect(screen.getByLabelText('Choose QR image')).toBeEnabled()
  })

  it('renders Bre-B terminology without changing the immutable destination', () => {
    render(<QrScannerFullScreen currency="COP" initialMode="paste" onClose={vi.fn()} onResult={vi.fn()} rail="BREB" />)

    expect(screen.getByRole('dialog', { name: 'Bre-B QR code' })).toBeInTheDocument()
    expect(screen.getByText('COP · Bre-B')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Bre-B QR code' })).toBeInTheDocument()
    expect(screen.queryByText(/PIX/)).not.toBeInTheDocument()
  })
})

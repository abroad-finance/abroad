import {
  beforeEach, describe, expect, it, vi,
} from 'vitest'

import { decodeQrImage } from '../features/swap/shared/decodeQrImage'

const mocks = vi.hoisted(() => ({
  detect: vi.fn(),
}))

vi.mock('barcode-detector/ponyfill', () => ({
  BarcodeDetector: class BarcodeDetectorMock {
    detect(file: File): Promise<unknown> {
      return mocks.detect(file)
    }
  },
}))

const createImage = (type = 'image/png'): File => new File(['image-bytes'], 'merchant-qr.png', { type })

describe('decodeQrImage', () => {
  beforeEach(() => {
    mocks.detect.mockReset()
  })

  it('returns the normalized QR value decoded from an image', async () => {
    const image = createImage()
    mocks.detect.mockResolvedValue([{ rawValue: '  000201-pix-payload  ' }])

    await expect(decodeQrImage(image)).resolves.toEqual({
      ok: true,
      value: '000201-pix-payload',
    })
    expect(mocks.detect).toHaveBeenCalledWith(image)
  })

  it('reports when a supported image contains no QR code', async () => {
    mocks.detect.mockResolvedValue([])

    await expect(decodeQrImage(createImage())).resolves.toEqual({
      error: 'no-qr-found',
      ok: false,
    })
  })

  it('rejects unsupported formats before loading the detector', async () => {
    await expect(decodeQrImage(createImage('image/svg+xml'))).resolves.toEqual({
      error: 'unsupported-format',
      ok: false,
    })
    expect(mocks.detect).not.toHaveBeenCalled()
  })

  it('rejects images larger than 10 MB before loading the detector', async () => {
    const image = createImage()
    Object.defineProperty(image, 'size', { value: 10 * 1024 * 1024 + 1 })

    await expect(decodeQrImage(image)).resolves.toEqual({
      error: 'file-too-large',
      ok: false,
    })
    expect(mocks.detect).not.toHaveBeenCalled()
  })

  it('turns decoder failures into a recoverable unreadable-image result', async () => {
    mocks.detect.mockRejectedValue(new Error('invalid image bytes'))

    await expect(decodeQrImage(createImage())).resolves.toEqual({
      error: 'unreadable-image',
      ok: false,
    })
  })
})

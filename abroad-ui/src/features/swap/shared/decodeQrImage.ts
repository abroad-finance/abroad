const MAX_QR_IMAGE_BYTES = 10 * 1024 * 1024

const SUPPORTED_IMAGE_TYPES: ReadonlySet<string> = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
])

export type QrImageDecodeError = 'file-too-large' | 'no-qr-found' | 'unreadable-image' | 'unsupported-format'

export type QrImageDecodeResult
  = | { error: QrImageDecodeError, ok: false }
    | { ok: true, value: string }

/**
 * Decodes a QR image entirely in the browser. Loading the WebAssembly-backed
 * detector is deferred until a user selects an image so normal scan/paste
 * entry does not pay the additional bundle cost.
 */
export const decodeQrImage = async (file: File): Promise<QrImageDecodeResult> => {
  if (!SUPPORTED_IMAGE_TYPES.has(file.type)) {
    return { error: 'unsupported-format', ok: false }
  }
  if (file.size > MAX_QR_IMAGE_BYTES) {
    return { error: 'file-too-large', ok: false }
  }
  if (file.size === 0) {
    return { error: 'unreadable-image', ok: false }
  }

  try {
    const { BarcodeDetector } = await import('barcode-detector/ponyfill')
    const detector = new BarcodeDetector({ formats: ['qr_code'] })
    const detectedCodes = await detector.detect(file)
    const value = detectedCodes
      .map(result => result.rawValue.trim())
      .find(Boolean)

    return value
      ? { ok: true, value }
      : { error: 'no-qr-found', ok: false }
  }
  catch {
    return { error: 'unreadable-image', ok: false }
  }
}

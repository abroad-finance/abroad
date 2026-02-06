import { useTranslate } from '@tolgee/react'
import { Scanner } from '@yudiel/react-qr-scanner'
import { ScanLine, X } from 'lucide-react'
import React, { useCallback, useEffect, useRef, useState } from 'react'

interface QrScannerFullScreenProps {
  onClose: () => void
  onResult: (text: string) => void
}

const extractScanText = (result: unknown): string => {
  if (!result) return ''
  if (typeof result === 'string') return result.trim()
  if (Array.isArray(result)) {
    if (!result.length) return ''
    const first = result[0]
    if (typeof first === 'string') return first.trim()
    if (first && typeof first === 'object') {
      const rawValue = (first as { rawValue?: unknown }).rawValue
      if (typeof rawValue === 'string') return rawValue.trim()
      const text = (first as { text?: unknown }).text
      if (typeof text === 'string') return text.trim()
    }
    return ''
  }
  if (typeof result === 'object') {
    const rawValue = (result as { rawValue?: unknown }).rawValue
    if (typeof rawValue === 'string') return rawValue.trim()
    const text = (result as { text?: unknown }).text
    if (typeof text === 'string') return text.trim()
  }
  return ''
}

const QrScannerFullScreen: React.FC<QrScannerFullScreenProps> = ({ onClose, onResult }) => {
  const { t } = useTranslate()
  const [cameraError, setCameraError] = useState<string | null>(null)
  const hasResultRef = useRef(false)

  useEffect(() => {
    if (typeof navigator === 'undefined') return
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError(t('qr_scanner.unsupported', 'Tu navegador no admite acceso a la cámara.'))
    }
  }, [t])

  const handleScan = useCallback((result: unknown) => {
    if (hasResultRef.current) return
    const text = extractScanText(result)
    if (!text) return
    hasResultRef.current = true
    Promise.resolve(onResult(text)).catch(() => {
      hasResultRef.current = false
      setCameraError(t('qr_scanner.unexpected_error', 'No pudimos procesar este QR. Intenta nuevamente.'))
    })
  }, [onResult, t])

  const handleError = useCallback((error: unknown) => {
    if (cameraError) return
    const message = error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : ''
    setCameraError(
      message || t('qr_scanner.camera_error', 'No pudimos acceder a tu cámara. Verifica los permisos.'),
    )
  }, [cameraError, t])

  return (
    <div className="fixed inset-0 z-[1000] bg-black/90 text-white flex flex-col">
      <div className="flex items-center justify-between p-4 max-h-[85vh]">
        <div className="flex items-center gap-2">
          <ScanLine className="h-6 w-6" />
          <h2 className="text-lg font-semibold">{t('qr_scanner.title', 'Escane un código QR')}</h2>
        </div>
        <button aria-label={t('qr_scanner.close_aria', 'Close scanner')} className="p-2 rounded hover:bg-white/10" onClick={onClose}>
          <X className="h-6 w-6" />
        </button>
      </div>

      <div className="relative flex-1">
        {/* Camera view */}
        {cameraError
          ? (
            <div className="flex h-full items-center justify-center px-6 text-center">
              <div className="max-w-sm">
                <p className="text-lg font-semibold">{t('qr_scanner.error_title', 'No pudimos abrir la cámara')}</p>
                <p className="text-sm text-white/80 mt-2">{cameraError}</p>
                <p className="text-xs text-white/60 mt-4">{t('qr_scanner.error_hint', 'Puedes cerrar este modal y pegar el código manualmente.')}</p>
              </div>
            </div>
          )
          : (
            <Scanner
              components={{ finder: true }}
              constraints={{ facingMode: 'environment' }}
              onError={handleError}
              onScan={handleScan}
              styles={{
                container: {
                  height: '100%',
                  maxHeight: '85vh',
                  width: '100%',
                },
                video: {
                  height: '100%',
                  objectFit: 'cover',
                  width: '100%',
                },
              }}
            />
          )}

        {/* Bottom help text */}
        {!cameraError && (
          <div className="absolute bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-black/70 to-transparent text-center">
            <p className="text-sm">{t('qr_scanner.hint', 'Asegurate de que sea un código QR de Pix')}</p>
          </div>
        )}
      </div>
    </div>
  )
}

export default QrScannerFullScreen

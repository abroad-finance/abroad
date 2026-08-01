import { useTranslate } from '@tolgee/react'
import { Scanner } from '@yudiel/react-qr-scanner'
import {
  ClipboardPaste, Loader, ScanLine, X,
} from 'lucide-react'
import React, {
  type FormEvent,
  useCallback, useEffect, useRef, useState,
} from 'react'

import type { QrEntryMode } from '../types'

type QrResultSource = 'camera' | 'paste'

interface QrScannerFullScreenProps {
  initialMode: QrEntryMode
  onClose: () => void
  onResult: (text: string) => Promise<void> | void
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

const QrScannerFullScreen: React.FC<QrScannerFullScreenProps> = ({ initialMode, onClose, onResult }) => {
  const { t } = useTranslate()
  const [cameraError, setCameraError] = useState<null | string>(null)
  const [entryMode, setEntryMode] = useState<QrEntryMode>(initialMode)
  const [isSubmittingPaste, setIsSubmittingPaste] = useState(false)
  const [pasteError, setPasteError] = useState<null | string>(null)
  const [pastedQrCode, setPastedQrCode] = useState('')
  const hasResultRef = useRef(false)

  useEffect(() => {
    if (typeof navigator === 'undefined') return
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError(t('qr_scanner.unsupported', 'Your browser does not support camera access.'))
    }
  }, [t])

  const submitResult = useCallback(async (text: string, source: QrResultSource) => {
    if (hasResultRef.current) return
    const normalizedText = text.trim()
    if (!normalizedText) return

    hasResultRef.current = true
    if (source === 'paste') {
      setIsSubmittingPaste(true)
      setPasteError(null)
    }

    try {
      await onResult(normalizedText)
    }
    catch {
      hasResultRef.current = false
      const errorMessage = t('qr_scanner.unexpected_error', 'We could not process this QR. Please try again.')
      if (source === 'camera') {
        setCameraError(errorMessage)
      }
      else {
        setIsSubmittingPaste(false)
        setPasteError(errorMessage)
      }
    }
  }, [onResult, t])

  const handleScan = useCallback((result: unknown) => {
    const text = extractScanText(result)
    if (!text) return
    void submitResult(text, 'camera')
  }, [submitResult])

  const handlePasteSubmit = useCallback((event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    void submitResult(pastedQrCode, 'paste')
  }, [pastedQrCode, submitResult])

  const handleError = useCallback((error: unknown) => {
    if (cameraError) return
    const message = error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : ''
    setCameraError(
      message || t('qr_scanner.camera_error', 'We could not access your camera. Please check permissions.'),
    )
  }, [cameraError, t])

  const selectMode = useCallback((mode: QrEntryMode) => {
    setEntryMode(mode)
    setPasteError(null)
  }, [])

  return (
    <div className="fixed inset-0 z-[1000] bg-black/90 text-white flex flex-col">
      <div className="flex items-center justify-between p-4">
        <div className="flex items-center gap-2">
          {entryMode === 'camera'
            ? <ScanLine className="h-6 w-6" />
            : <ClipboardPaste className="h-6 w-6" />}
          <h2 className="text-lg font-semibold">{t('qr_scanner.pix_title', 'PIX QR code')}</h2>
        </div>
        <button
          aria-label={t('qr_scanner.close_aria', 'Close scanner')}
          className="p-2 rounded hover:bg-white/10"
          onClick={onClose}
          type="button"
        >
          <X className="h-6 w-6" />
        </button>
      </div>

      <div
        aria-label={t('qr_scanner.input_method', 'QR code input method')}
        className="mx-4 mb-3 grid grid-cols-2 rounded-xl bg-white/10 p-1 sm:mx-auto sm:w-full sm:max-w-md"
        role="group"
      >
        <button
          aria-pressed={entryMode === 'camera'}
          className={`flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${
            entryMode === 'camera' ? 'bg-white text-slate-950' : 'text-white/75 hover:text-white'
          }`}
          onClick={() => selectMode('camera')}
          type="button"
        >
          <ScanLine className="h-4 w-4" />
          {t('qr_scanner.scan_mode', 'Scan with camera')}
        </button>
        <button
          aria-pressed={entryMode === 'paste'}
          className={`flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${
            entryMode === 'paste' ? 'bg-white text-slate-950' : 'text-white/75 hover:text-white'
          }`}
          onClick={() => selectMode('paste')}
          type="button"
        >
          <ClipboardPaste className="h-4 w-4" />
          {t('qr_scanner.paste_mode', 'Paste PIX code')}
        </button>
      </div>

      <div className="relative min-h-0 flex-1">
        {entryMode === 'camera'
          ? (
              <>
                {/* Camera view */}
                {cameraError
                  ? (
                      <div className="flex h-full items-center justify-center px-6 text-center">
                        <div className="max-w-sm">
                          <p className="text-lg font-semibold">{t('qr_scanner.error_title', 'We could not open the camera')}</p>
                          <p className="text-sm text-white/80 mt-2">{cameraError}</p>
                          <p className="text-xs text-white/60 mt-4">
                            {t('qr_scanner.error_paste_hint', 'Choose Paste PIX code above to continue without the camera.')}
                          </p>
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

                {!cameraError && (
                  <div className="absolute bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-black/70 to-transparent text-center">
                    <p className="text-sm">{t('qr_scanner.hint', 'Make sure it is a PIX QR code')}</p>
                  </div>
                )}
              </>
            )
          : (
              <div className="flex h-full items-center justify-center px-4 py-6 sm:px-6">
                <form
                  className="w-full max-w-xl rounded-3xl border border-white/15 bg-white/10 p-5 shadow-2xl backdrop-blur-md sm:p-7"
                  onSubmit={handlePasteSubmit}
                >
                  <label className="text-base font-semibold" htmlFor="pix-qr-code-input">
                    {t('qr_scanner.paste_label', 'PIX Copia e Cola code')}
                  </label>
                  <p className="mt-1 text-sm leading-5 text-white/65">
                    {t('qr_scanner.paste_hint', 'Paste the complete code from your bank or payment app.')}
                  </p>
                  <textarea
                    autoCapitalize="none"
                    autoComplete="off"
                    className="mt-4 min-h-40 w-full resize-y rounded-2xl border border-white/20 bg-black/25 px-4 py-3 font-mono text-sm leading-5 text-white outline-none transition-colors placeholder:text-white/35 focus:border-emerald-400"
                    id="pix-qr-code-input"
                    maxLength={4096}
                    onChange={(event) => {
                      setPastedQrCode(event.target.value)
                      if (pasteError) setPasteError(null)
                    }}
                    placeholder={t('qr_scanner.paste_placeholder', 'Paste the full PIX QR code string')}
                    spellCheck={false}
                    value={pastedQrCode}
                  />
                  {pasteError && (
                    <p className="mt-2 text-sm text-rose-300" role="alert">{pasteError}</p>
                  )}
                  <button
                    className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl bg-[#3ca383] px-4 py-3 font-semibold text-white transition-opacity hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={isSubmittingPaste || pastedQrCode.trim().length === 0}
                    type="submit"
                  >
                    {isSubmittingPaste
                      ? (
                          <>
                            <Loader className="h-5 w-5 animate-spin" />
                            {t('qr_scanner.processing', 'Processing code…')}
                          </>
                        )
                      : t('qr_scanner.continue', 'Continue')}
                  </button>
                </form>
              </div>
            )}
      </div>
    </div>
  )
}

export default QrScannerFullScreen

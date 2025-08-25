import { Scanner } from '@yudiel/react-qr-scanner'
import { ScanLine, X } from 'lucide-react'
import React from 'react'

interface QrScannerFullScreenProps {
  onClose: () => void
  onResult: (text: string) => void
}

const QrScannerFullScreen: React.FC<QrScannerFullScreenProps> = ({ onClose, onResult }) => {
  const handleScan = (result: unknown) => {
    let text = ''
    if (typeof result === 'string') {
      text = result
    }
    else if (Array.isArray(result)) {
      const first = result[0] as unknown
      if (first && typeof first === 'object') {
        text = (first as { rawValue?: string, text?: string }).rawValue || (first as { text?: string }).text || ''
      }
    }
    else if (result && typeof result === 'object') {
      text = (result as { rawValue?: string, text?: string }).rawValue || (result as { text?: string }).text || ''
    }
    if (text) onResult(text)
  }

  return (
    <div className="fixed inset-0 z-[1000] bg-black/90 text-white flex flex-col">
      <div className="flex items-center justify-between p-4 max-h-[85vh]">
        <div className="flex items-center gap-2">
          <ScanLine className="h-6 w-6" />
          <h2 className="text-lg font-semibold">Escane un código QR</h2>
        </div>
        <button aria-label="Close scanner" className="p-2 rounded hover:bg-white/10" onClick={onClose}>
          <X className="h-6 w-6" />
        </button>
      </div>

      <div className="relative flex-1">
        {/* Camera view */}
        <Scanner
          components={{ finder: true }}
          constraints={{ facingMode: 'environment' }}
          onError={() => { /* ignore camera errors */ }}
          onScan={handleScan}
          styles={{ container: { height: '100%', maxHeight: '85vh', width: '100%' }, video: { height: '100%', objectFit: 'cover', width: '100%' } }}
        />

        {/* Bottom help text */}
        <div className="absolute bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-black/70 to-transparent text-center">
          <p className="text-sm">Asegurate de que sea un código QR de Pix</p>
        </div>
      </div>
    </div>
  )
}

export default QrScannerFullScreen

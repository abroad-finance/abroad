import React from 'react';
import { Scanner } from '@yudiel/react-qr-scanner';
import { X } from 'lucide-react';

interface QrScannerFullScreenProps {
  onClose: () => void;
  onResult: (text: string) => void;
}

const QrScannerFullScreen: React.FC<QrScannerFullScreenProps> = ({ onClose, onResult }) => {
  const handleScan = (result: unknown) => {
    let text = '';
    if (typeof result === 'string') {
      text = result;
    } else if (Array.isArray(result)) {
      const first = result[0] as unknown;
      if (first && typeof first === 'object') {
        text = (first as { rawValue?: string; text?: string }).rawValue || (first as { text?: string }).text || '';
      }
    } else if (result && typeof result === 'object') {
      text = (result as { rawValue?: string; text?: string }).rawValue || (result as { text?: string }).text || '';
    }
    if (text) onResult(text);
  };

  return (
    <div className="fixed inset-0 z-[1000] bg-black/90 text-white flex flex-col">
      <div className="flex items-center justify-between p-4">
        <h2 className="text-lg font-semibold">Scan QR Code</h2>
        <button aria-label="Close scanner" onClick={onClose} className="p-2 rounded hover:bg-white/10">
          <X className="h-6 w-6" />
        </button>
      </div>

      <div className="relative flex-1">
        {/* Camera view */}
        <Scanner
          onScan={handleScan}
          onError={() => { /* ignore camera errors */ }}
          components={{ finder: true }}
          constraints={{ facingMode: 'environment' }}
          styles={{ container: { width: '100%', height: '100%' }, video: { width: '100%', height: '100%', objectFit: 'cover' } }}
        />

        {/* Bottom help text */}
        <div className="absolute bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-black/70 to-transparent text-center">
          <p className="text-sm">Point your camera at a QR code to scan.</p>
        </div>
      </div>
    </div>
  );
};

export default QrScannerFullScreen;

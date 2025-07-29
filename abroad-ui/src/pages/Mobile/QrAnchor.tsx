import { useState, useEffect } from 'react';
import { Scan, X, Rotate3d } from 'lucide-react';
import { useLanguage } from '../../contexts/LanguageContext';

export default function QRAnchor() {
  const { setLanguage } = useLanguage();
  const [brlAmount, setBrlAmount] = useState<string>('');
  const [usdcAmount, setUsdcAmount] = useState<string>('');
  const [paymentKey, setPaymentKey] = useState<string>('');
  const [isQRScannerOpen, setIsQRScannerOpen] = useState<boolean>(false);

  // Mock exchange rate - replace with actual API call
  const USDC_TO_BRL_RATE = 5.88; // 1 USDC = 5.88 BRL (approximate)

  useEffect(() => {
    const queryParams = new URLSearchParams(window.location.search);
    const lang = queryParams.get('lang');
    if (lang) {
      setLanguage(lang as 'en' | 'es' | 'pt' | 'zh');
    }
  }, [setLanguage]);

  const handleBrlAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value.replace(/[^\d.,]/g, '');
    setBrlAmount(value);
    
    // Convert to USDC
    const numericValue = parseFloat(value.replace(',', '.'));
    if (!isNaN(numericValue)) {
      const converted = (numericValue / USDC_TO_BRL_RATE).toFixed(2);
      setUsdcAmount(converted);
    } else {
      setUsdcAmount('');
    }
  };

  const openQRScanner = () => {
    setIsQRScannerOpen(true);
    // TODO: Implement QR scanner functionality
  };

  const closeQRScanner = () => {
    setIsQRScannerOpen(false);
  };

  return (
    <div className="min-h-screen bg-green-50 flex flex-col items-center">
      {/* Header with logo and QR button */}
      <div className="w-full flex items-center justify-between px-4 mt-8 mb-6">
        <div className="flex-1 flex justify-center">
          <img
            src="https://cdn.prod.website-files.com/66d73974e0b6f2e9c06130a7/67bdb92323f0bb399db3754c_abroad-logo.svg"
            alt="Abroad Logo"
            className="h-7"
          />
        </div>
        <button
          onClick={openQRScanner}
          className="text-[#356E6A] hover:text-[#356E6A]/80 p-2 transition-colors"
          aria-label="Open QR Scanner"
        >
          <Scan className="w-6 h-6" />
        </button>
      </div>

      {/* Main content area */}
      <div className="flex-1 flex items-center justify-center w-full flex-col px-4 py-4 pb-32">
        <div className="w-full max-w-sm space-y-4">
          {/* Payment Key Input */}
          <div className="rounded-2xl p-5 flex items-center space-x-4 bg-white/50 backdrop-blur-sm">
            <input
              type="text"
              placeholder="Payment key"
              value={paymentKey}
              onChange={(e) => setPaymentKey(e.target.value)}
              className="flex-1 bg-transparent text-lg font-medium text-[#356E6A] focus:outline-none placeholder-[#356E6A]/50 text-left min-w-0"
            />
          </div>

          {/* Brazilian Real Input */}
          <div className="rounded-2xl p-5 pb-0 flex items-center space-x-4">
            <div className="flex items-center space-x-2 flex-shrink-0">
              <img
                src="https://hatscripts.github.io/circle-flags/flags/br.svg"
                alt="Brazil Flag"
                className="w-8 h-8 rounded-full"
              />
              <span className="text-2xl font-bold text-[#356E6A]">R$</span>
            </div>
            <input
              type="text"
              inputMode="decimal"
              placeholder="0,00"
              value={brlAmount}
              onChange={handleBrlAmountChange}
              className="flex-1 bg-transparent text-5xl font-bold text-[#356E6A] focus:outline-none placeholder-[#356E6A]/50 text-left min-w-0"
            />
          </div>

          {/* USDC Conversion Display */}
          <div className="rounded-2xl p-5 pt-0 flex items-center space-x-4">
            <div className="flex items-center space-x-2">
              <img
                src="https://storage.googleapis.com/cdn-abroad/Icons/Tokens/USDC%20Token.svg"
                alt="USDC Token"
                className="w-6 h-6"
              />
            </div>
            <div className="flex-1 text-lg font-semibold text-[#356E6A]">
              {usdcAmount || '0.00'}
            </div>
          </div>

          {/* Exchange rate info */}
          <div className="text-center text-sm text-[#356E6A]/70 px-2">
            1 USDC ≈ R${USDC_TO_BRL_RATE.toFixed(2)}
          </div>
        </div>
      </div>

      {/* QR Scanner Modal */}
      {isQRScannerOpen && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center">
          <div className="relative w-full max-w-sm mx-4">
            <button
              onClick={closeQRScanner}
              className="absolute top-4 right-4 z-10 bg-white/20 hover:bg-white/30 text-white p-2 rounded-full transition-colors"
              aria-label="Close QR Scanner"
            >
              <X className="w-6 h-6" />
            </button>
            <div className="bg-white rounded-2xl p-8">
              <div className="aspect-square bg-gray-100 rounded-xl flex items-center justify-center">
                <div className="text-center text-gray-500">
                  <Scan className="w-16 h-16 mx-auto mb-4" />
                  <p className="text-lg font-medium">QR Scanner</p>
                  <p className="text-sm">Camera access needed</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* PIX Disclaimer - Fixed at bottom */}
      <div className="fixed bottom-17 left-0 right-0 px-4 z-10">
        <div className="w-full max-w-sm mx-auto bg-[#356E6A]/10 backdrop-blur-xl rounded-2xl p-4 flex flex-col items-start space-y-2 justify-start">
          <div className="flex items-center space-x-2">
            <Rotate3d className="w-5 h-5 text-[#356E6A]" />
            <span className="font-medium text-sm text-[#356E6A]">Network:</span>
            <div className="bg-white/70 backdrop-blur-md rounded-lg px-3 py-1 flex items-center space-x-2">
              <img
                src="/icons/pix.svg"
                alt="PIX"
                className="w-4 h-4"
              />
              <span className="text-sm font-semibold text-[#356E6A]">Pix</span>
            </div>
          </div>
          <span className="text-sm text-[#356E6A]/90 pl-1 leading-relaxed">
            Your transaction will be processed instantly through Pix. The funds couldn't be returned after sent.
          </span>
        </div>
      </div>

      {/* Social footer */}
      <footer className="w-full flex justify-end space-x-3 py-3 pr-4">
        <a
          href="https://x.com/payabroad"
          target="_blank"
          rel="noopener noreferrer"
        >
          <img
            src="https://storage.googleapis.com/cdn-abroad/Icons/Socials/icon-x.svg"
            alt="X"
            className="w-5 h-5 text-[#356E6A]"
            style={{ filter: 'invert(33%) sepia(14%) saturate(1833%) hue-rotate(121deg) brightness(90%) contrast(85%)' }}
          />
        </a>
        <a
          href="https://discord.gg/YqWdSxAy5B"
          target="_blank"
          rel="noopener noreferrer"
        >
          <img
            src="https://storage.googleapis.com/cdn-abroad/Icons/Socials/icon-discord.svg"
            alt="Discord"
            className="w-5 h-5 text-[#356E6A]"
            style={{ filter: 'invert(33%) sepia(14%) saturate(1833%) hue-rotate(121deg) brightness(90%) contrast(85%)' }}
          />
        </a>
      </footer>
    </div>
  );
}

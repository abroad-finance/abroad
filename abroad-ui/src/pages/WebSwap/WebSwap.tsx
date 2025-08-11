import React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useWebSwapController } from '../../features/swap/useWebSwapController';
import { ASSET_URLS } from '../../features/swap/webSwap.constants';
import QrScannerFullScreen from '../../components/WebSwap/QrScannerFullScreen';
import { useSearchParams } from 'react-router-dom';
import { decodePixQrCode } from '../../utils/PixQrDecoder';

// Child Components
import NavBarResponsive from '../../components/WebSwap/NavBarResponsive';
import WalletDetails from '../../components/WebSwap/WalletDetails';
import DesktopLayout from '../../features/swap/DesktopLayout';
import MobileLayout from '../../features/swap/MobileLayout';

type ControllerWithQr = ReturnType<typeof useWebSwapController> & {
  handleQrScanned?: (text: string) => void;
};

const WebSwap: React.FC = () => {
  const controller = useWebSwapController() as ControllerWithQr;
  const [isQrOpen, setIsQrOpen] = React.useState(false);
  const [searchParams] = useSearchParams();

  React.useEffect(() => {
    if (searchParams.has('qr_scanner')) setIsQrOpen(true);
  }, [searchParams]);

  const handleQrResult = (text: string) => {
    setIsQrOpen(false);
    // Optionally expose raw scan to controller
    controller.handleQrScanned?.(text);

    // Try to decode PIX QR and prefill amount
    try {
      const decoded = decodePixQrCode(text);
      const amount = decoded.transactionAmount;
      if (amount) {
        controller.handleAmountsChange(amount, controller.initialAmounts.target);
      }
    } catch (e) {
      console.warn('Failed to decode PIX QR', e);
    }

    if (!controller.handleQrScanned) {
      console.log('Scanned QR:', text);
    }
  };

  // Smooth crossfade desktop background (page-level only)
  const BRL_BG_URL = 'https://storage.googleapis.com/cdn-abroad/bg/6193481566_1a304e3aa3_o.jpg';
  const currentBgUrl = controller.targetCurrency === 'BRL' ? BRL_BG_URL : ASSET_URLS.BACKGROUND_IMAGE;
  const [baseBgUrl, setBaseBgUrl] = React.useState<string>(currentBgUrl);
  const [overlayBgUrl, setOverlayBgUrl] = React.useState<string | null>(null);

  // When currency changes, preload the new image, then trigger overlay fade-in; commit to base after fade completes
  React.useEffect(() => {
    if (currentBgUrl === baseBgUrl) return;
    let canceled = false;
    const img = new Image();
    img.src = currentBgUrl;
    const startOverlay = () => {
      if (!canceled) setOverlayBgUrl(currentBgUrl);
    };
    if (img.complete) {
      // Already cached
      startOverlay();
    } else {
      img.onload = startOverlay;
      img.onerror = () => {
        // On error, fall back to hard swap without animation
        if (!canceled) {
          setBaseBgUrl(currentBgUrl);
          setOverlayBgUrl(null);
        }
      };
    }
    return () => {
      canceled = true;
    };
  }, [currentBgUrl, baseBgUrl]);

  const handleOverlayComplete = React.useCallback(() => {
    if (overlayBgUrl) {
      setBaseBgUrl(overlayBgUrl);
      setOverlayBgUrl(null);
    }
  }, [overlayBgUrl]);

  return (
    <div className="w-screen min-h-screen md:h-screen md:overflow-hidden flex flex-col">
      {/* Desktop page background with crossfade (no white flash) */}
      <div
        className="hidden md:block absolute inset-0 z-0 bg-cover bg-center bg-no-repeat bg-fixed"
        style={{ backgroundImage: `url(${baseBgUrl})` }}
      />
      {overlayBgUrl && (
        <motion.div
          key={overlayBgUrl}
          className="hidden md:block absolute inset-0 z-0 bg-cover bg-center bg-no-repeat bg-fixed pointer-events-none"
          style={{ backgroundImage: `url(${overlayBgUrl})` }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.35, ease: 'easeOut' }}
          onAnimationComplete={handleOverlayComplete}
        />
      )}
      
      {/* Shared Navigation */}
      <div className="relative z-10 bg-green-50 md:bg-transparent">
        <NavBarResponsive 
          onWalletDetails={controller.handleWalletDetailsOpen} 
        />
      </div>

      {/* Main Content Area */}
      <main className="flex-1 relative z-10 flex">
        <DesktopLayout {...controller} />
        <MobileLayout {...controller} />

        {/* Floating Scan Button */}
        <button
          type="button"
          onClick={() => setIsQrOpen(true)}
          className="fixed bottom-6 right-6 z-[1001] rounded-full bg-green-600 text-white px-5 py-3 shadow-lg hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-white/50"
        >
          Scan QR
        </button>
      </main>

      {/* Top-level Modals */}
      <AnimatePresence>
        {controller.isWalletDetailsOpen && (
          <ModalOverlay onClose={controller.handleWalletDetailsClose}>
            <WalletDetails onClose={controller.handleWalletDetailsClose} />
          </ModalOverlay>
        )}
      </AnimatePresence>

      {/* Full-screen QR Scanner */}
      {isQrOpen && (
        <QrScannerFullScreen onClose={() => setIsQrOpen(false)} onResult={handleQrResult} />
      )}
    </div>
  );
};

const ModalOverlay: React.FC<{ children: React.ReactNode; onClose: () => void }> = ({ children, onClose }) => (
  <motion.div
    className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[999] flex items-center justify-center md:justify-end p-4 md:pr-8"
    onClick={onClose}
    initial={{ opacity: 0 }}
    animate={{ opacity: 1 }}
    exit={{ opacity: 0 }}
    transition={{ duration: 0.2, ease: 'easeOut' }}
  >
    <div onClick={(e) => e.stopPropagation()}>{children}</div>
  </motion.div>
);

export default WebSwap;
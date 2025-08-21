import React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useWebSwapController } from '../../features/swap/useWebSwapController';
import { lazy, Suspense } from 'react';
const QrScannerFullScreen = lazy(() => import('../../components/WebSwap/QrScannerFullScreen'));
import BackgroundCrossfade from '../../components/common/BackgroundCrossfade';
import { Loader } from 'lucide-react';

// Child Components
import NavBarResponsive from '../../components/WebSwap/NavBarResponsive';
import WalletDetails from '../../components/WebSwap/WalletDetails';
import WebSwapLayout from '../../features/swap/WebSwapLayout';


const WebSwap: React.FC = () => {
  const controller = useWebSwapController();

  return (
    <div className="w-screen min-h-screen md:h-screen md:overflow-hidden flex flex-col">
      {/* Desktop page background with crossfade (no white flash) */}
      <BackgroundCrossfade
        imageUrl={controller.currentBgUrl}
        visibilityClass="hidden md:block"
        positionClass="absolute inset-0"
        zIndexClass="z-0"
        backgroundAttachment="fixed"
      />
      
      {/* Shared Navigation */}
      <div className="relative z-10 bg-green-50 md:bg-transparent">
        <NavBarResponsive 
          onWalletDetails={controller.handleWalletDetailsOpen} 
        />
      </div>

      {/* Main Content Area */}
      <main className="flex-1 relative z-10 flex">
        <WebSwapLayout {...controller} />

        {/* Floating Scan Button */}
        <button
          type="button"
          onClick={controller.openQr}
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
      {controller.isQrOpen && (
        <Suspense fallback={null}>
          <QrScannerFullScreen onClose={controller.closeQr} onResult={controller.handleQrResult} />
        </Suspense>
      )}

      {/* Decoding overlay */}
      {controller.isDecodingQr && (
        <div className="fixed inset-0 z-[1100] bg-black/60 backdrop-blur-sm flex items-center justify-center">
          <div className="flex flex-col items-center gap-3 text-white">
            <Loader className="w-8 h-8 animate-spin" />
            <p className="text-sm">Decodificando QR…</p>
          </div>
        </div>
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
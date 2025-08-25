import { AnimatePresence, motion } from 'framer-motion'
import React from 'react'
import { lazy, Suspense } from 'react'

import { useWebSwapController } from '../../features/swap/useWebSwapController'
const QrScannerFullScreen = lazy(() => import('../../components/WebSwap/QrScannerFullScreen'))
import { Loader } from 'lucide-react'

import BackgroundCrossfade from '../../components/common/BackgroundCrossfade'
// Child Components
import LanguageSelector from '../../components/common/LanguageSelector'
import NavBarResponsive from '../../components/WebSwap/NavBarResponsive'
import WalletDetails from '../../components/WebSwap/WalletDetails'
import WebSwapLayout from '../../features/swap/WebSwapLayout'
import { useLanguageSelector, useNavBarResponsive } from '../../hooks'

const WebSwap: React.FC = () => {
  const controller = useWebSwapController()
  const navBar = useNavBarResponsive({ onWalletDetails: controller.handleWalletDetailsOpen })
  const languageSelector = useLanguageSelector()

  return (
    <div className="w-screen min-h-screen md:h-screen md:overflow-hidden flex flex-col">
      {/* Desktop page background with crossfade (no white flash) */}
      <BackgroundCrossfade
        backgroundAttachment="fixed"
        imageUrl={controller.currentBgUrl}
        positionClass="absolute inset-0"
        visibilityClass="hidden md:block"
        zIndexClass="z-0"
      />

      {/* Shared Navigation */}
      <div className="relative z-10 bg-green-50 md:bg-transparent">
        <NavBarResponsive
          {...navBar}
          languageSelector={<LanguageSelector {...languageSelector} />}
          languageSelectorMobile={<LanguageSelector {...languageSelector} variant="mobile" />}
        />
      </div>

      {/* Main Content Area */}
      <main className="flex-1 relative z-10 flex">
        <WebSwapLayout {...controller} />

        {/* Floating Scan Button removed; scanner trigger moved into Swap title */}
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
  )
}

const ModalOverlay: React.FC<{ children: React.ReactNode, onClose: () => void }> = ({ children, onClose }) => (
  <motion.div
    animate={{ opacity: 1 }}
    className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[999] flex items-center justify-center md:justify-end p-4 md:pr-8"
    exit={{ opacity: 0 }}
    initial={{ opacity: 0 }}
    onClick={onClose}
    transition={{ duration: 0.2, ease: 'easeOut' }}
  >
    <div onClick={e => e.stopPropagation()}>{children}</div>
  </motion.div>
)

export default WebSwap

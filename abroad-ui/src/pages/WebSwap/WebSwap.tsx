import React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useWebSwapController } from '../../features/swap/useWebSwapController';
import { ASSET_URLS } from '../../features/swap/webSwap.constants';
// import { kit } from '../../services/stellarKit';
// import { useWalletAuth } from '../../context/WalletAuthContext';

// Child Components
import NavBarResponsive from '../../components/WebSwap/NavBarResponsive';
// import ConnectWallet from '../../components/WebSwap/ConnectWallet';
import WalletDetails from '../../components/WebSwap/WalletDetails';
import DesktopLayout from '../../features/swap/DesktopLayout';
import MobileLayout from '../../features/swap/MobileLayout';

const WebSwap: React.FC = () => {
  const controller = useWebSwapController();
  // const { authenticateWithWallet } = useWalletAuth();

  // Direct wallet connection handler - Commented out, components handle internally
  // const handleDirectWalletConnect = () => {
  //   kit.openModal({
  //     onWalletSelected: async (option) => {
  //       authenticateWithWallet(option.id);
  //     },
  //   });
  // };

  return (
    <div className="w-screen min-h-screen md:h-screen md:overflow-hidden flex flex-col">
      {/* Shared Background for Desktop */}
      <div
        className="hidden md:block absolute inset-0 z-0 bg-cover bg-center bg-no-repeat bg-fixed"
        style={{ backgroundImage: `url(${ASSET_URLS.BACKGROUND_IMAGE})` }}
      />
      
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
      </main>

      {/* Top-level Modals */}
      <AnimatePresence>
        {/* Commented out for direct wallet connection
        {controller.isWalletModalOpen && (
          <ModalOverlay onClose={controller.handleWalletConnectClose}>
            <ConnectWallet 
              onWalletSelect={controller.handleWalletSelect} 
              onClose={controller.handleWalletConnectClose} 
            />
          </ModalOverlay>
        )}
        */}
        {controller.isWalletDetailsOpen && (
          <ModalOverlay onClose={controller.handleWalletDetailsClose}>
            <WalletDetails onClose={controller.handleWalletDetailsClose} />
          </ModalOverlay>
        )}
      </AnimatePresence>
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
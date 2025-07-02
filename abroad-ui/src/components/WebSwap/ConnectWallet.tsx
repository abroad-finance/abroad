import React, { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import { motion } from 'framer-motion';
import TrustWalletIcon from '../../assets/Logos/Wallets/TrustWalletShield.svg';
import StellarLogo from '../../assets/Logos/Blockchains/StellarLogo.svg';

interface ConnectWalletProps {
  onWalletSelect?: (walletType: 'trust' | 'stellar') => void;
  onClose?: () => void;
}

const ConnectWallet: React.FC<ConnectWalletProps> = ({ onWalletSelect, onClose }) => {
  const [selectedWallet, setSelectedWallet] = useState<'trust' | 'stellar' | null>(null);

  // Handle escape key press
  useEffect(() => {
    const handleEscapeKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose?.();
      }
    };

    document.addEventListener('keydown', handleEscapeKey);
    return () => {
      document.removeEventListener('keydown', handleEscapeKey);
    };
  }, [onClose]);

  const handleWalletSelect = (walletType: 'trust' | 'stellar') => {
    setSelectedWallet(walletType);
    onWalletSelect?.(walletType);
  };

  const walletOptions = [
    {
      id: 'trust' as const,
      icon: TrustWalletIcon,
      name: 'Trust Wallet',
    },
    {
      id: 'stellar' as const,
      icon: StellarLogo,
      name: 'Stellar Wallets',
    },
  ];

  return (
    <motion.div 
      className="w-screen md:w-auto md:mx-0 md:ml-auto md:h-[95vh] md:max-w-md md:flex md:items-center fixed md:relative left-0 md:left-auto top-auto md:top-auto bottom-0 md:bottom-auto"
      initial={{ 
        x: window.innerWidth >= 768 ? '100%' : 0,
        y: window.innerWidth >= 768 ? 0 : '100%',
        opacity: 1 
      }}
      animate={{ x: 0, y: 0, opacity: 1 }}
      exit={{ 
        x: window.innerWidth >= 768 ? '100%' : 0,
        y: window.innerWidth >= 768 ? 0 : '100%',
        opacity: window.innerWidth >= 768 ? 1 : 0 
      }}
      transition={{ 
        type: 'spring',
        stiffness: 800,
        damping: 35,
        duration: 0.12
      }}
    >
      <div className="bg-white rounded-t-4xl md:rounded-4xl shadow-lg border border-gray-200 p-6 relative w-full md:h-full md:flex md:flex-col min-h-fit">
        {/* Close Button */}
        {onClose && (
          <button
            onClick={onClose}
            className="absolute top-4 right-4 p-1 rounded-full hover:bg-gray-100 transition-colors duration-200 cursor-pointer"
          >
            <X className="w-5 h-5 text-gray-400 hover:text-gray-600" />
          </button>
        )}

        {/* Header */}
        <div className="mb-3 pr-8 text-center mt-5 md:mt-15">
          <h2 className="text-2xl font-semibold text-gray-900 mb-2">
            Connect your wallet
          </h2>
          <p className="text-md text-gray-600">
            Connect your wallet to make transactions Abroad
          </p>
        </div>

        {/* Wallet Options */}
        <div className="space-y-3 mb-6 md:flex-1 md:flex md:flex-col md:justify-center md:-mt-94">
          {walletOptions.map((wallet) => (
            <button
              key={wallet.id}
              onClick={() => handleWalletSelect(wallet.id)}
              className={`w-full flex items-center p-4 rounded-xl border-2 transition-all duration-200 hover:bg-gray-50 cursor-pointer ${
                selectedWallet === wallet.id
                  ? 'border-blue-500 bg-blue-50'
                  : 'border-gray-200'
              }`}
            >
              <img
                src={wallet.icon}
                alt={`${wallet.name} icon`}
                className="w-8 h-8 mr-3"
              />
              <span className="text-left font-medium text-gray-900">
                {wallet.name}
              </span>
            </button>
          ))}
        </div>

        {/* Terms and Privacy */}
        <div className="text-xs text-gray-500 leading-relaxed text-center md:mt-auto">
          By connecting your wallet, you agree to our{' '}
          <a
            href="https://cdn.prod.website-files.com/66d73974e0b6f2e9c06130a7/682e16447c330447a92a6323_TERMS%20AND%20CONDITIONS%20ABROAD%20-%20MAY%202025.pdf"
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-600 hover:text-blue-800 underline cursor-pointer"
          >
            Terms of Service
          </a>{' '}
          and{' '}
          <a
            href="https://cdn.prod.website-files.com/66d73974e0b6f2e9c06130a7/67c30e575c78a99c968adf81_Data%20Privacy%20Policy%20Abroad.pdf"
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-600 hover:text-blue-800 underline cursor-pointer"
          >
            Privacy Policy
          </a>
          .
        </div>
      </div>
    </motion.div>
  );
};

export default ConnectWallet;
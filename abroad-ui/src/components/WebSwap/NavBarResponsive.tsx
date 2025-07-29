import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { Info, Menu, X, Wallet } from 'lucide-react';

interface NavBarResponsiveProps {
  className?: string;
  onWalletConnect?: () => void;
  onWalletDetails?: () => void;
}

  // Helper function to format wallet address
  const formatWalletAddress = (address: string) => {
    if (!address || address === 'Connected') return 'Connected';
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  }

const NavBarResponsive: React.FC<NavBarResponsiveProps> = ({ className = '', onWalletConnect, onWalletDetails }) => {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const toggleMobileMenu = useCallback(() => {
    setIsMobileMenuOpen(!isMobileMenuOpen);
  }, [isMobileMenuOpen]);

  const connectedWalletName = useMemo(() => {
    if (!address) return null;
    if (address && typeof address === 'string') {
      return address.toLowerCase();
    }
    return null;
  }, [address]);

  const handleWalletClick = useCallback(() => {
    if (address) {
      // If wallet is connected, show wallet details
      onWalletDetails?.();
    } else {
      // If wallet is not connected, show connect wallet modal
      onWalletConnect?.();
    }
  }, [address, onWalletDetails, onWalletConnect]);

  const menuItems = ['Trade', 'Pool', 'About'];

  return (
    <>
      <nav className={`w-full px-4 pt-4 ${className}`}>
        <div className="max-w-8xl mx-auto bg-black/10 md:bg-[#356E6A]/5 backdrop-blur-md rounded-2xl">
          <div className="px-4 sm:px-6 lg:px-8">
            <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <div className="flex-shrink-0">
            {/* Mobile Logo - Colored */}
            <img
              src={AbroadLogoColored}
              alt="Abroad Logo"
              className="h-8 w-auto md:hidden"
            />
            {/* Desktop Logo - White */}
            <img
              src={AbroadLogoWhite}
              alt="Abroad Logo"
              className="h-8 w-auto hidden md:block"
            />
          </div>

          {/* Desktop Menu */}
          <div className="hidden md:block">
            <div className="ml-10 flex items-baseline space-x-8">
              {menuItems.map((item) => (
                <a
                  key={item}
                  href="#"
                  className="text-white hover:text-white/80 px-3 py-2 rounded-md text-lg font-medium transition-colors duration-200"
                >
                  {item}
                </a>
              ))}
            </div>
          </div>

          {/* Desktop Right Side */}
          <div className="hidden md:flex items-center space-x-4">
            {/* Wallet Badge */}
            <button 
              onClick={handleWalletClick}
              className="flex items-center space-x-3 bg-white/20 backdrop-blur-sm rounded-2xl px-4 py-2 border border-white/30 hover:bg-white/30 transition-colors duration-200"
            >
              ) : (
                <>
                  <Wallet className="w-5 h-5 text-white" />
                  <span className="text-white text-md font-medium">
                    Conectar Billetera
                  </span>
                </>
              )}
            </button>

            {/* Info Icon */}
            <button 
              onClick={() => window.open('https://linktr.ee/Abroad.finance', '_blank')}
              className="p-2 rounded-full bg-white/20 hover:bg-white/30 transition-colors duration-200"
            >
              <Info className="w-5 h-5 text-white" />
            </button>
          </div>

          {/* Mobile menu button */}
          <div className="md:hidden">
            <button
              onClick={toggleMobileMenu}
              className="p-2 rounded-md text-white hover:text-white/80 hover:bg-white/20 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-white"
            >
              {isMobileMenuOpen ? (
                <X className="block h-6 w-6" />
              ) : (
                <Menu className="block h-6 w-6" />
              )}
            </button>
          </div>
        </div>

        {/* Mobile Menu */}
        {isMobileMenuOpen && (
          <div className="md:hidden px-2 pt-2 pb-3">
            <div className="space-y-1 bg-white/10 backdrop-blur-md rounded-xl mt-2 p-3">
              {menuItems.map((item) => (
                <a
                  key={item}
                  href="#"
                  className="text-white hover:text-white/80 hover:bg-white/20 block px-3 py-2 rounded-md text-base font-medium transition-colors duration-200"
                >
                  {item}
                </a>
              ))}
              
              {/* Mobile Wallet Badge */}
              <button 
                onClick={handleWalletClick}
                className="flex items-center justify-center space-x-3 bg-white/20 backdrop-blur-sm rounded-full px-4 py-2 border border-white/30 mx-3 mt-4 hover:bg-white/30 transition-colors duration-200"
              >

                ) : (
                  <>
                    <Wallet className="w-5 h-5 text-white" />
                    <span className="text-white text-sm font-medium">
                      Conectar Billetera
                    </span>
                  </>
                )}
              </button>

              {/* Mobile Action Buttons */}
              <div className="flex justify-center space-x-4 mt-4 pb-2">
                <button 
                  onClick={() => window.open('https://linktr.ee/Abroad.finance', '_blank')}
                  className="p-2 rounded-full bg-white/20 hover:bg-white/30 transition-colors duration-200"
                >
                  <Info className="w-5 h-5 text-white" />
                </button>
              </div>
            </div>
          </div>
        )}
        </div>
      </div>
      </nav>
    </>
  );
};

export default NavBarResponsive;

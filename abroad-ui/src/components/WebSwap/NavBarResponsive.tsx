import React, { useState } from 'react';
import { Settings, Info, Menu, X } from 'lucide-react';

interface NavBarResponsiveProps {
  className?: string;
  onWalletConnect?: () => void;
}

const NavBarResponsive: React.FC<NavBarResponsiveProps> = ({ className = '', onWalletConnect }) => {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const toggleMobileMenu = () => {
    setIsMobileMenuOpen(!isMobileMenuOpen);
  };

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
              src="/src/assets/Logos/AbroadLogoColored.svg"
              alt="Abroad Logo"
              className="h-8 w-auto md:hidden"
            />
            {/* Desktop Logo - White */}
            <img
              src="/src/assets/Logos/AbroadLogoWhite.svg"
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
              onClick={onWalletConnect}
              className="flex items-center space-x-2 bg-white/20 backdrop-blur-sm rounded-full px-4 py-2 border border-white/30 hover:bg-white/30 transition-colors duration-200"
            >
              <img
                src="https://storage.googleapis.com/cdn-abroad/Icons/Banks/Trust_Wallet_Shield.svg"
                alt="Trust Wallet"
                className="w-5 h-5"
              />
              <span className="text-white text-md font-medium">Connect Wallet</span>
            </button>

            {/* Settings Icon */}
            <button className="p-2 rounded-full bg-white/20 hover:bg-white/30 transition-colors duration-200">
              <Settings className="w-5 h-5 text-white" />
            </button>

            {/* Info Icon */}
            <button className="p-2 rounded-full bg-white/20 hover:bg-white/30 transition-colors duration-200">
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
                onClick={onWalletConnect}
                className="flex items-center justify-center space-x-2 bg-white/20 backdrop-blur-sm rounded-full px-4 py-2 border border-white/30 mx-3 mt-4 hover:bg-white/30 transition-colors duration-200"
              >
                <img
                  src="https://storage.googleapis.com/cdn-abroad/Icons/Banks/Trust_Wallet_Shield.svg"
                  alt="Trust Wallet"
                  className="w-5 h-5"
                />
                <span className="text-white text-sm font-medium">0x1059...1408</span>
              </button>

              {/* Mobile Action Buttons */}
              <div className="flex justify-center space-x-4 mt-4 pb-2">
                <button className="p-2 rounded-full bg-white/20 hover:bg-white/30 transition-colors duration-200">
                  <Settings className="w-5 h-5 text-white" />
                </button>
                <button className="p-2 rounded-full bg-white/20 hover:bg-white/30 transition-colors duration-200">
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

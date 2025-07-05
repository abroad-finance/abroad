import React, { useState, useCallback, useMemo } from 'react';
import { Settings, Info, Menu, X } from 'lucide-react';
import { useBlux } from '@bluxcc/react';

interface NavBarResponsiveProps {
  className?: string;
  onWalletConnect?: () => void;
  onWalletDetails?: () => void;
}

const NavBarResponsive: React.FC<NavBarResponsiveProps> = ({ className = '', onWalletConnect, onWalletDetails }) => {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const { user, isAuthenticated } = useBlux();

  // Debug: Log user object to see available properties
  React.useEffect(() => {
    if (user) {
      console.log('User object:', user);
      console.log('User properties:', Object.keys(user));
      console.log('User JSON:', JSON.stringify(user, null, 2));
    }
  }, [user]);

  const toggleMobileMenu = useCallback(() => {
    setIsMobileMenuOpen(!isMobileMenuOpen);
  }, [isMobileMenuOpen]);

  // Helper function to format wallet address
  const formatWalletAddress = useCallback((address: string) => {
    if (!address || address === 'Connected') return 'Connected';
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  }, []);

  // Get public key from user object - focus on stellar address using Blux documentation
  const publicKey = useMemo(() => {
    if (!user) return null;
    
    // Log the entire user object for debugging
    console.log('Getting public key from user:', user);
    
    // According to Blux docs, user object contains wallet address
    const userObj = user as unknown as Record<string, unknown>;
    
    // Check properties in order of preference based on Blux documentation
    let pk = userObj.stellarAddress || 
             userObj.address || 
             userObj.walletAddress || 
             userObj.publicKey || 
             userObj.accountId ||
             userObj.id ||
             null;
    
    // If not found, check nested properties as fallback
    if (!pk && userObj.wallet && typeof userObj.wallet === 'object') {
      const wallet = userObj.wallet as Record<string, unknown>;
      pk = wallet.stellarAddress ||
                 wallet.address ||
                 wallet.publicKey ||
                 null;
    }
    
    // Check if there's an account object
    if (!pk && userObj.account && typeof userObj.account === 'object') {
      const account = userObj.account as Record<string, unknown>;
      pk = account.stellarAddress ||
                 account.address ||
                 account.publicKey ||
                 account.id ||
                 null;
    }
    
    console.log('Found public key:', pk);
    console.log('All user object keys recursively:');
    
    // Log all nested keys
    const logNestedKeys = (obj: Record<string, unknown>, prefix = '') => {
      Object.keys(obj).forEach(key => {
        const fullKey = prefix ? `${prefix}.${key}` : key;
        console.log(`  ${fullKey}: ${typeof obj[key]} = ${obj[key]}`);
        if (typeof obj[key] === 'object' && obj[key] !== null && !Array.isArray(obj[key])) {
          logNestedKeys(obj[key] as Record<string, unknown>, fullKey);
        }
      });
    };
    
    logNestedKeys(userObj);
    
    return pk;
  }, [user]);

  const walletAddress = useMemo(() => (
    publicKey ? formatWalletAddress(String(publicKey)) : 'Connected'
  ), [publicKey, formatWalletAddress]);

  const handleWalletClick = useCallback(() => {
    if (isAuthenticated && user) {
      // If wallet is connected, show wallet details
      onWalletDetails?.();
    } else {
      // If wallet is not connected, show connect wallet modal
      onWalletConnect?.();
    }
  }, [isAuthenticated, user, onWalletDetails, onWalletConnect]);

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
              onClick={handleWalletClick}
              className="flex items-center space-x-2 bg-white/20 backdrop-blur-sm rounded-full px-4 py-2 border border-white/30 hover:bg-white/30 transition-colors duration-200"
            >
              <img
                src="https://storage.googleapis.com/cdn-abroad/Icons/Banks/Trust_Wallet_Shield.svg"
                alt="Trust Wallet"
                className="w-5 h-5"
              />
              <span className="text-white text-md font-medium">
                {isAuthenticated && user ? walletAddress : 'Connect Wallet'}
              </span>
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
                onClick={handleWalletClick}
                className="flex items-center justify-center space-x-2 bg-white/20 backdrop-blur-sm rounded-full px-4 py-2 border border-white/30 mx-3 mt-4 hover:bg-white/30 transition-colors duration-200"
              >
                <img
                  src="https://storage.googleapis.com/cdn-abroad/Icons/Banks/Trust_Wallet_Shield.svg"
                  alt="Trust Wallet"
                  className="w-5 h-5"
                />
                <span className="text-white text-sm font-medium">
                  {isAuthenticated && user ? walletAddress : 'Connect Wallet'}
                </span>
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

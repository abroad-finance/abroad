import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { Info, Menu, X, Wallet } from 'lucide-react';
import { useWalletAuth } from '../../context/WalletAuthContext';
import { kit } from '../../services/stellarKit';
import { formatWalletAddress, fetchUSDCBalance } from '../../utils/walletUtils';
import AbroadLogoColored from '../../assets/Logos/AbroadLogoColored.svg';
import AbroadLogoWhite from '../../assets/Logos/AbroadLogoWhite.svg';
import FreighterLogo from '../../assets/Logos/Wallets/Freighter.svg';
import HanaLogo from '../../assets/Logos/Wallets/Hana.svg';
import LobstrLogo from '../../assets/Logos/Wallets/Lobstr.svg';

interface NavBarResponsiveProps {
  className?: string;
  onWalletConnect?: () => void;
  onWalletDetails?: () => void;
}

const NavBarResponsive: React.FC<NavBarResponsiveProps> = ({ className = '', onWalletConnect, onWalletDetails }) => {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [usdcBalance, setUsdcBalance] = useState<string>('0.00');
  const [isLoadingBalance, setIsLoadingBalance] = useState(false);
  const [walletUpdateTrigger, setWalletUpdateTrigger] = useState(0);
  const { address, walletName } = useWalletAuth(); 
  
  // Use shared USDC balance fetching logic
  const fetchUSDCBalanceWithLoading = useCallback(async (stellarAddress: string) => {
    try {
      setIsLoadingBalance(true);
      const balance = await fetchUSDCBalance(stellarAddress);
      setUsdcBalance(balance);
    } catch (error) {
      console.error('Error fetching USDC balance:', error);
      setUsdcBalance('0.00');
    } finally {
      setIsLoadingBalance(false);
    }
  }, []);

  useEffect(() => {
    if (address) {
      fetchUSDCBalanceWithLoading(address);
    }
  }, [address, fetchUSDCBalanceWithLoading]);

  // Effect to trigger wallet info update when wallet changes
  useEffect(() => {
    const checkWalletChange = () => {
      type KitWithCurrent = { getCurrentWallet?: () => { id?: string; name?: string } };
      const kitWithCurrent = kit as KitWithCurrent;
      const currentWallet = kitWithCurrent.getCurrentWallet?.();
      const currentWalletId = currentWallet?.id || currentWallet?.name || localStorage.getItem('selectedWalletName');
      
      console.log('Wallet change detected, current wallet:', currentWallet); // Debug log
      console.log('Current wallet ID:', currentWalletId); // Debug log
      
      // Trigger update when wallet changes
      if (currentWalletId) {
        setWalletUpdateTrigger(prev => {
          console.log('Updating wallet trigger from', prev, 'to', prev + 1); // Debug log
          return prev + 1;
        });
      }
    };

    // Check for wallet changes when address changes
    if (address) {
      checkWalletChange();
    }
  }, [address, walletName]);
  
  const toggleMobileMenu = useCallback(() => {
    setIsMobileMenuOpen(!isMobileMenuOpen);
  }, [isMobileMenuOpen]);

  // Helper function to get wallet icon and name based on wallet ID
  const getWalletInfo = useCallback((walletId: string | null) => {
    console.log('getWalletInfo called with:', walletId); // Debug log
    
    if (!walletId) return { icon: null, name: 'Unknown' };
    
    const walletIdLower = walletId.toLowerCase();
    
    // Check for Freighter wallet ID patterns
    if (walletIdLower === 'freighter' || walletIdLower.includes('freighter')) {
      return { icon: FreighterLogo, name: 'Freighter' };
    } 
    // Check for Hana wallet ID patterns
    else if (walletIdLower === 'hana' || walletIdLower.includes('hana')) {
      return { icon: HanaLogo, name: 'Hana' };
    } 
    // Check for Lobstr wallet ID patterns
    else if (walletIdLower === 'lobstr' || walletIdLower.includes('lobstr')) {
      return { icon: LobstrLogo, name: 'Lobstr' };
    }
    // Check for xBull wallet (another popular Stellar wallet)
    else if (walletIdLower === 'xbull' || walletIdLower.includes('xbull')) {
      return { icon: null, name: 'xBull' };
    }
    // Check for Rabet wallet
    else if (walletIdLower === 'rabet' || walletIdLower.includes('rabet')) {
      return { icon: null, name: 'Rabet' };
    }
    // Check for other known wallet patterns
    else if (walletIdLower.includes('stellar') || walletIdLower.includes('trust')) {
      return { icon: null, name: 'Stellar Wallet' };
    } 
    else {
      console.log('Unknown wallet type, using fallback for:', walletId); // Debug log
      return { icon: null, name: 'Stellar Wallet' };
    }
  }, []);

  const connectedWalletInfo = useMemo(() => {
    // Detect connected wallet via StellarWalletsKit's getCurrentWallet
    type KitWithCurrent = { getCurrentWallet?: () => { id?: string; name?: string } };
    const kitWithCurrent = kit as KitWithCurrent;
    const currentWallet = kitWithCurrent.getCurrentWallet?.();
    
    // Prioritize wallet ID over name for more reliable identification
    const walletIdentifier = currentWallet?.id || currentWallet?.name || walletName || localStorage.getItem('selectedWalletName') || null;
    
    console.log('Current wallet from kit:', currentWallet); // Debug log
    console.log('Using wallet identifier:', walletIdentifier); // Debug log
    
    return getWalletInfo(walletIdentifier);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walletName, getWalletInfo, walletUpdateTrigger]);

  const handleWalletClick = useCallback(() => {
    if (address) {
      // If wallet is connected, show wallet details
      onWalletDetails?.();
    } else {
      // If wallet is not connected, show connect wallet modal
      onWalletConnect?.();
    }
  }, [address, onWalletDetails, onWalletConnect]);

  // Reusable wallet icon component
  const renderWalletIcon = useCallback(() => {
    if (address) {
      return connectedWalletInfo.icon ? (
        <img
          src={connectedWalletInfo.icon}
          alt={`${connectedWalletInfo.name} Wallet`}
          className="w-8 h-8"
        />
      ) : (
        <Wallet className="w-5 h-5 text-white" />
      );
    }
    return <Wallet className="w-5 h-5 text-white" />;
  }, [address, connectedWalletInfo]);

  // Reusable USDC balance badge component
  const renderUSDCBadge = useCallback((isMobile = false) => {
    if (!address) return null;
    
    const iconSize = isMobile ? "w-3 h-3" : "w-4 h-4";
    const textSize = isMobile ? "text-xs" : "text-sm";
    const loadingSize = isMobile ? "w-10 h-3" : "w-12 h-4";
    
    return (
      <div className="flex items-center space-x-1 bg-white/30 rounded-lg px-2 py-1">
        <img
          src="https://storage.googleapis.com/cdn-abroad/Icons/Tokens/USDC%20Token.svg"
          alt="USDC"
          className={iconSize}
        />
        {isLoadingBalance ? (
          <div className={`${loadingSize} bg-white/20 rounded animate-pulse`}></div>
        ) : (
          <span className={`text-white ${textSize} font-medium`}>
            ${usdcBalance}
          </span>
        )}
      </div>
    );
  }, [address, isLoadingBalance, usdcBalance]);

  // Reusable info button component
  const renderInfoButton = useCallback(() => (
    <button 
      onClick={() => window.open('https://linktr.ee/Abroad.finance', '_blank')}
      className="p-2 rounded-full bg-white/20 hover:bg-white/30 transition-colors duration-200"
    >
      <Info className="w-5 h-5 text-white" />
    </button>
  ), []);

  // const menuItems = ['Trade', 'Pool', 'About']; // Hidden for now

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

          {/* Desktop Menu - Hidden for now */}
          {/* <div className="hidden md:block">
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
          </div> */}

          {/* Desktop Right Side */}
          <div className="hidden md:flex items-center space-x-4">
            {/* Wallet Badge */}
            <button 
              onClick={handleWalletClick}
              className="flex items-center space-x-3 bg-white/20 backdrop-blur-sm rounded-2xl px-4 py-2 border border-white/30 hover:bg-white/30 transition-colors duration-200"
            >
              {renderWalletIcon()}
              <span className="text-white text-md font-medium">
                {address ? formatWalletAddress(address) : 'Conectar Billetera'}
              </span>
              {renderUSDCBadge()}
            </button>

            {/* Info Icon */}
            {renderInfoButton()}
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
              {/* Menu items hidden for now */}
              {/* {menuItems.map((item) => (
                <a
                  key={item}
                  href="#"
                  className="text-white hover:text-white/80 hover:bg-white/20 block px-3 py-2 rounded-md text-base font-medium transition-colors duration-200"
                >
                  {item}
                </a>
              ))} */}
              
              {/* Mobile Wallet Badge */}
              <button 
                onClick={handleWalletClick}
                className="flex items-center justify-center space-x-3 bg-white/20 backdrop-blur-sm rounded-full px-4 py-2 border border-white/30 mx-3 mt-4 hover:bg-white/30 transition-colors duration-200"
              >
                {address ? (
                  renderWalletIcon()
                ) : (
                  <>
                    <Wallet className="w-5 h-5 text-white" />
                    <span className="text-white text-sm font-medium">
                      Conectar Billetera
                    </span>
                  </>
                )}
                <span className="text-white text-sm font-medium">
                  {address ? formatWalletAddress(address) : 'Conectar Billetera'}
                </span>
                {renderUSDCBadge(true)}
              </button>

              {/* Mobile Action Buttons */}
              <div className="flex justify-center space-x-4 mt-4 pb-2">
                {renderInfoButton()}
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

import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { Info, Wallet } from 'lucide-react';
import { useWalletAuth } from '../../context/WalletAuthContext';
import { Horizon } from '@stellar/stellar-sdk';
import { kit } from '../../services/stellarKit';
import AbroadLogoColored from '../../assets/Logos/AbroadLogoColored.svg';
import AbroadLogoWhite from '../../assets/Logos/AbroadLogoWhite.svg';
import FreighterLogo from '../../assets/Logos/Wallets/Freighter.svg';
import HanaLogo from '../../assets/Logos/Wallets/Hana.svg';
import LobstrLogo from '../../assets/Logos/Wallets/Lobstr.svg';

// Stellar network configuration
const STELLAR_HORIZON_URL = 'https://horizon.stellar.org';
const USDC_ISSUER = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN'; // Circle's USDC issuer on Stellar mainnet

// Utility functions
const formatWalletAddress = (address: string | null) => {
  if (!address) return 'No conectado';
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
};

const fetchUSDCBalance = async (stellarAddress: string): Promise<string> => {
  try {
    console.log('Fetching USDC balance for:', stellarAddress);
    
    // Create Horizon server instance
    const server = new Horizon.Server(STELLAR_HORIZON_URL);
    
    // Load account information
    const account = await server.loadAccount(stellarAddress);
    console.log('Account loaded, balances found:', account.balances.length);
    
    // Find USDC balance in account balances
    const usdcBalance = account.balances.find(balance => {
      // Check if it's a credit asset (not native XLM)
      if (balance.asset_type === 'native') return false;
      
      // Type guard to ensure we have asset_code and asset_issuer properties
      if ('asset_code' in balance && 'asset_issuer' in balance) {
        const isUSDC = balance.asset_code === 'USDC' && balance.asset_issuer === USDC_ISSUER;
        if (balance.asset_code === 'USDC') {
          console.log('Found USDC balance with issuer:', balance.asset_issuer);
          console.log('Expected issuer:', USDC_ISSUER);
          console.log('Issuer match:', balance.asset_issuer === USDC_ISSUER);
        }
        return isUSDC;
      }
      
      return false;
    });
    
    if (usdcBalance && 'balance' in usdcBalance) {
      // Format balance to 2 decimal places with thousand separators
      const balanceValue = parseFloat(usdcBalance.balance);
      console.log('USDC balance found:', balanceValue);
      return balanceValue.toLocaleString('en-US', { 
        minimumFractionDigits: 2, 
        maximumFractionDigits: 2 
      });
    } else {
      console.log('No USDC balance found, checking all balances:');
      account.balances.forEach((balance, index) => {
        if (balance.asset_type !== 'native' && 'asset_code' in balance) {
          console.log(`Balance ${index}:`, balance.asset_code, balance.asset_issuer);
        }
      });
      return '0.00';
    }
  } catch (error) {
    console.error('Error fetching USDC balance:', error);
    
    // Handle specific error cases
    if (error instanceof Error) {
      if (error.message.includes('Account not found')) {
        console.log('Stellar account not found or not funded');
        return '0.00';
      }
      if (error.message.includes('Network Error')) {
        console.log('Network error while fetching balance');
        return 'Error';
      }
    }
    
    return '0.00';
  }
};

interface NavBarResponsiveProps {
  className?: string;
  onWalletConnect?: () => void;
  onWalletDetails?: () => void;
}

const NavBarResponsive: React.FC<NavBarResponsiveProps> = ({ className = '', onWalletConnect, onWalletDetails }) => {
  const [usdcBalance, setUsdcBalance] = useState<string>('0.00');
  const [isLoadingBalance, setIsLoadingBalance] = useState(false);
  const { address, walletId, authenticateWithWallet } = useWalletAuth(); 
  
  // Direct wallet connection handler
  const handleDirectWalletConnect = useCallback(() => {
    kit.openModal({
      onWalletSelected: async (option) => {
        authenticateWithWallet(option.id);
      },
    });
  }, [authenticateWithWallet]);

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
    // Use the walletId from the context, stored when wallet was selected
    const walletIdentifier = walletId || localStorage.getItem('selectedWalletId') || null;
    
    console.log('Using wallet identifier:', walletIdentifier); // Debug log
    
    return getWalletInfo(walletIdentifier);
  }, [walletId, getWalletInfo]);

  const handleWalletClick = useCallback(() => {
    if (address) {
      // If wallet is connected, show wallet details
      onWalletDetails?.();
    } else {
      // If wallet is not connected, use direct Stellar kit connection
      // Note: onWalletConnect may be commented out in parent components
      if (onWalletConnect) {
        onWalletConnect();
      } else {
        // Fallback to direct connection when prop is not provided
        handleDirectWalletConnect();
      }
    }
  }, [address, onWalletDetails, onWalletConnect, handleDirectWalletConnect]);

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
    
    const iconSize = isMobile ? "w-4 h-4" : "w-4 h-4";
    const textSize = isMobile ? "text-sm" : "text-sm";
    const loadingSize = isMobile ? "w-10 h-3" : "w-12 h-4";
    const textColor = isMobile ? "text-[#356E6A]" : "text-white";
    
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
          <span className={`${textColor} ${textSize} font-medium`}>
            ${usdcBalance}
          </span>
        )}
      </div>
    );
  }, [address, isLoadingBalance, usdcBalance]);

  // Reusable info button component
  const renderInfoButton = useCallback((isMobile = false) => {
    const buttonClasses = isMobile 
      ? "p-2 rounded-full bg-[#356E6A]/5 hover:bg-[#356E6A]/10 transition-colors duration-200"
      : "p-2 rounded-full bg-white/20 hover:bg-white/30 transition-colors duration-200";
    const iconColor = isMobile ? "text-[#356E6A]" : "text-white";

    return (
      <button 
        onClick={() => window.open('https://linktr.ee/Abroad.finance', '_blank')}
        className={buttonClasses}
      >
        <Info className={`w-5 h-5 ${iconColor}`} />
      </button>
    );
  }, []);

  // const menuItems = ['Trade', 'Pool', 'About']; // Hidden for now

  return (
    <>
      <nav className={`w-full px-4 pt-4 ${className}`}>
        <div className="max-w-8xl mx-auto bg-transparent md:bg-[#356E6A]/5 backdrop-blur-md rounded-2xl">
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

            {/* Desktop Right Side */}
            <div className="hidden md:flex items-center space-x-4">
            {/* Wallet Badge */}
            <button 
              onClick={handleWalletClick}
              className="cursor-pointer flex items-center space-x-3 bg-white/20 backdrop-blur-sm rounded-xl px-4 py-2 hover:bg-white/30 transition-colors duration-200"
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

            {/* Mobile menu */}
            <div className="md:hidden">
            {/* Mobile Wallet Badge and Info Button Side by Side */}
            <div className="flex items-center space-x-3">
              {/* Info Button */}
              {renderInfoButton(true)}
              <button 
              onClick={handleWalletClick}
              className="flex items-center justify-center bg-[#356E6A]/5 backdrop-blur-xl rounded-xl px-4 py-2 border border-white/30 hover:bg-white/30 transition-colors duration-200 flex-1"
              >
              {address ? (
                renderWalletIcon()
              ) : (
                <>
                <Wallet className="w-8 h-8 text-[#356E6A]" />
                <span className="text-[#356E6A] text-sm font-medium">
                  Conectar Billetera
                </span>
                </>
              )}
              {renderUSDCBadge(true)}
              </button>
            </div>
            </div>
          </div>

        </div>
      </div>
      </nav>
    </>
  );
};

export default NavBarResponsive;

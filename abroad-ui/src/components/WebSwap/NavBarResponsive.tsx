import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { Info, Menu, X, Wallet } from 'lucide-react';
import { useBlux } from '@bluxcc/react';
import { Horizon } from '@stellar/stellar-sdk';
import AbroadLogoColored from '/src/assets/Logos/AbroadLogoColored.svg';
import AbroadLogoWhite from '/src/assets/Logos/AbroadLogoWhite.svg';
import FreighterLogo from '/src/assets/Logos/Wallets/Freighter.svg';
import HanaLogo from '/src/assets/Logos/Wallets/Hana.svg';
import LobstrLogo from '/src/assets/Logos/Wallets/Lobstr.svg';

interface NavBarResponsiveProps {
  className?: string;
  onWalletConnect?: () => void;
  onWalletDetails?: () => void;
}

const NavBarResponsive: React.FC<NavBarResponsiveProps> = ({ className = '', onWalletConnect, onWalletDetails }) => {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [usdcBalance, setUsdcBalance] = useState<string>('');
  const [isLoadingBalance, setIsLoadingBalance] = useState(false);
  const { user, isAuthenticated } = useBlux();

  const toggleMobileMenu = useCallback(() => {
    setIsMobileMenuOpen(!isMobileMenuOpen);
  }, [isMobileMenuOpen]);

  // Function to fetch USDC balance
  const fetchUSDCBalance = useCallback(async (stellarAddress: string) => {
    try {
      setIsLoadingBalance(true);
      const server = new Horizon.Server('https://horizon.stellar.org');
      const account = await server.loadAccount(stellarAddress);
      
      // USDC on Stellar: USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN
      
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const usdcBalance = account.balances.find((balance: any) => 
        balance.asset_type === 'credit_alphanum4' && 
        balance.asset_code === 'USDC' &&
        balance.asset_issuer === 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN'
      );
      
      if (usdcBalance) {
        const numericBalance = parseFloat(usdcBalance.balance);
        const formattedBalance = numericBalance >= 1000 
          ? (numericBalance / 1000).toFixed(1) + 'k'
          : numericBalance.toFixed(2);
        setUsdcBalance(formattedBalance);
      } else {
        setUsdcBalance('0.00');
      }
    } catch (error) {
      console.error('Error fetching USDC balance:', error);
      setUsdcBalance('0.00');
    } finally {
      setIsLoadingBalance(false);
    }
  }, []);

  // Helper function to format wallet address
  const formatWalletAddress = useCallback((address: string) => {
    if (!address || address === 'Connected') return 'Connected';
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  }, []);

  // Get public key from user object - focus on stellar address using Blux documentation
  const publicKey = useMemo(() => {
    if (!user) return null;
    
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
    
    return pk;
  }, [user]);

  // Effect to fetch balance when wallet is connected
  useEffect(() => {
    if (isAuthenticated && publicKey && typeof publicKey === 'string') {
      fetchUSDCBalance(publicKey);
    } else {
      setUsdcBalance('');
    }
  }, [isAuthenticated, publicKey, fetchUSDCBalance]);

  const walletAddress = useMemo(() => (
    publicKey ? formatWalletAddress(String(publicKey)) : 'Connected'
  ), [publicKey, formatWalletAddress]);

  const connectedWalletName = useMemo(() => {
    if (!isAuthenticated || !user) return null;
    const wallet = (user as { wallet?: { name?: string } }).wallet;
    if (wallet && typeof wallet.name === 'string') {
      return wallet.name.toLowerCase();
    }
    return null;
  }, [isAuthenticated, user]);

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
              {isAuthenticated && user ? (
                <>
                  {connectedWalletName?.includes('freighter') ? (
                    <img
                      src={FreighterLogo}
                      alt="Freighter Wallet"
                      className="w-8 h-8"
                    />
                  ) : connectedWalletName?.includes('hana') ? (
                    <img
                      src={HanaLogo}
                      alt="Hana Wallet"
                      className="w-8 h-8"
                    />
                  ) : connectedWalletName?.includes('lobstr') ? (
                    <img
                      src={LobstrLogo}
                      alt="Lobstr Wallet"
                      className="w-8 h-8"
                    />
                  ) : (
                    <img
                      src="https://storage.googleapis.com/cdn-abroad/Icons/Banks/Trust_Wallet_Shield.svg"
                      alt="Trust Wallet"
                      className="w-5 h-5"
                    />
                  )}
                  <div className="flex items-center space-x-2">
                    <span className="text-white text-md font-medium">
                      {walletAddress}
                    </span>
                    {usdcBalance && (
                      <div className="flex items-center space-x-1 bg-white/10 rounded-full px-2 py-1">
                        <img
                          src="https://storage.googleapis.com/cdn-abroad/Icons/Tokens/USDC%20Token.svg"
                          alt="USDC"
                          className="w-4 h-4"
                        />
                        <span className="text-white/90 text-sm font-medium">
                          {isLoadingBalance ? '...' : `${usdcBalance}`}
                        </span>
                      </div>
                    )}
                  </div>
                </>
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
                {isAuthenticated && user ? (
                  <>
                    {connectedWalletName?.includes('freighter') ? (
                      <img
                        src={FreighterLogo}
                        alt="Freighter Wallet"
                        className="w-8 h-8"
                      />
                    ) : connectedWalletName?.includes('hana') ? (
                      <img
                        src={HanaLogo}
                        alt="Hana Wallet"
                        className="w-5 h-5"
                      />
                    ) : connectedWalletName?.includes('lobstr') ? (
                      <img
                        src={LobstrLogo}
                        alt="Lobstr Wallet"
                        className="w-5 h-5"
                      />
                    ) : (
                      <img
                        src="https://storage.googleapis.com/cdn-abroad/Icons/Banks/Trust_Wallet_Shield.svg"
                        alt="Trust Wallet"
                        className="w-5 h-5"
                      />
                    )}
                    <div className="flex items-center space-x-2">
                      <span className="text-white text-sm font-medium">
                        {walletAddress}
                      </span>
                      {usdcBalance && (
                        <div className="flex items-center space-x-1 bg-white/10 rounded-full px-2 py-1">
                          <img
                            src="https://storage.googleapis.com/cdn-abroad/Icons/Tokens/USDC%20Token.svg"
                            alt="USDC"
                            className="w-4 h-4"
                          />
                          <span className="text-white/90 text-sm font-medium">
                            {isLoadingBalance ? '...' : `${usdcBalance}`}
                          </span>
                        </div>
                      )}
                    </div>
                  </>
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

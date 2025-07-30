import React, { useState, useEffect, useCallback } from 'react';
import { X, Copy, ExternalLink } from 'lucide-react';
import { motion } from 'framer-motion';
import { useWalletAuth } from '../../context/WalletAuthContext';
import '../../styles/scrollbar.css';
import * as StellarSdk from '@stellar/stellar-sdk';

interface WalletDetailsProps {
  onClose?: () => void;
}

const WalletDetails: React.FC<WalletDetailsProps> = ({ onClose }) => {
  const [copiedAddress, setCopiedAddress] = useState(false);
  const [usdcBalance, setUsdcBalance] = useState<string>('0.00');
  const [isLoadingBalance, setIsLoadingBalance] = useState(false);
  const { address, logout } = useWalletAuth();

  // Function to fetch USDC balance from Stellar network using StellarSDK
  const fetchUSDCBalance = useCallback(async (stellarAddress: string) => {
    try {
      console.log('Fetching USDC balance for address:', stellarAddress);
      setIsLoadingBalance(true);
      const server = new StellarSdk.Horizon.Server('https://horizon.stellar.org');
      const account = await server.loadAccount(stellarAddress);
      
      // USDC on Stellar mainnet: USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN
      const usdcAssetCode = 'USDC';
      const usdcIssuer = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';
      
      const usdcBalance = account.balances.find((balance: StellarSdk.Horizon.HorizonApi.BalanceLine) => {
        // Check if it's a credit_alphanum4 asset (USDC is 4 characters)
        if (balance.asset_type === 'credit_alphanum4') {
          return balance.asset_code === usdcAssetCode && balance.asset_issuer === usdcIssuer;
        }
        return false;
      });
      
      if (usdcBalance) {
        const numericBalance = parseFloat(usdcBalance.balance);
        setUsdcBalance(numericBalance.toLocaleString('en-US', { 
          minimumFractionDigits: 2, 
          maximumFractionDigits: 2 
        }));
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

  useEffect(() => {
    if (address) {
      fetchUSDCBalance(address);
    }
  }, [address, fetchUSDCBalance]);

  // Helper: format wallet address
  const formatWalletAddress = (address: string | null) => {
    if (!address) return 'No conectado';
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  };

  // Reusable: wallet address actions (disconnect, copy, explorer)
  const WalletAddressActions = ({ address }: { address: string | null }) => (
    <div className="flex space-x-2">
      <button
        onClick={async () => {
          try {
            await logout();
            onClose?.();
          } catch (err) {
            console.error('Failed to disconnect wallet:', err);
          }
        }}
        className="p-1 hover:bg-red-100 hover:bg-opacity-20 rounded transition-colors duration-200"
        title="Desconectar billetera"
      >
        <svg className="w-4 h-4 text-red-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
        </svg>
      </button>
      <button
        onClick={async () => {
          if (address) {
            try {
              await navigator.clipboard.writeText(address);
              setCopiedAddress(true);
              setTimeout(() => setCopiedAddress(false), 2000);
            } catch (err) {
              console.error('Failed to copy address:', err);
            }
          }
        }}
        className="p-1 hover:bg-white hover:bg-opacity-20 rounded transition-colors duration-200"
        title="Copiar dirección"
      >
        <Copy className="w-4 h-4 text-white" />
      </button>
      <button
        onClick={() => window.open(`https://stellar.expert/explorer/public/account/${address}`, '_blank')}
        className="p-1 hover:bg-white hover:bg-opacity-20 rounded transition-colors duration-200"
        title="Ver en explorador"
      >
        <ExternalLink className="w-4 h-4 text-white" />
      </button>
    </div>
  );

  // Reusable: USDC balance display
  const USDCBalance = () => (
    <div className="flex items-center space-x-3">
      <img
        src="https://storage.googleapis.com/cdn-abroad/Icons/Tokens/USDC%20Token.svg"
        alt="USDC"
        className="w-5 h-5"
      />
      {isLoadingBalance ? (
        <div className="flex items-center space-x-2">
          <div className="h-9 bg-white/20 rounded w-8 animate-pulse"></div>
          <div className="h-9 bg-white/20 rounded w-20 animate-pulse"></div>
        </div>
      ) : (
        <span className="text-white font-bold text-4xl">
          ${usdcBalance || '0.00'}
        </span>
      )}
    </div>
  );

  return (
    <>
      <motion.div 
      className="w-screen md:w-auto md:mx-0 md:ml-auto md:max-w-md md:flex md:items-center fixed md:relative left-0 md:left-auto top-auto md:top-auto bottom-0 md:bottom-auto h-[80vh] md:h-[95vh]"
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
      <div className="bg-white rounded-t-4xl md:rounded-4xl shadow-lg border border-gray-200 px-6 pt-6 relative w-full h-full md:h-full md:flex md:flex-col overflow-y-auto">
        {/* Close Button */}
        {onClose && (
          <button
            onClick={onClose}
            className="absolute top-4 right-4 p-1 rounded-full hover:bg-gray-100 transition-colors duration-200 cursor-pointer z-10"
          >
            <X className="w-5 h-5 text-gray-400 hover:text-gray-600" />
          </button>
        )}

        {/* Header */}
        <div className="mb-6 pr-8 text-center mt-2 md:mt-4">
          <h2 className="text-2xl font-semibold text-gray-900 mb-2">
            Tu Cuenta
          </h2>
          <p className="text-md text-gray-600">
            Gestiona tu billetera y consulta el historial de transacciones
          </p>
        </div>

        {/* Wallet Address & Balance Card */}
        <div 
          className="border border-gray-200 rounded-xl p-6 mb-6 bg-cover bg-center bg-no-repeat"
          style={{
            backgroundImage: 'url(https://static.vecteezy.com/system/resources/previews/026/493/927/non_2x/abstract-gradient-dark-green-liquid-wave-background-free-vector.jpg)'
          }}
        >
          {/* Wallet Address Section */}
          <div className="flex items-center justify-between mb-4">
            <span className="text-white font-mono text-sm break-all">{formatWalletAddress(address)}</span>
            <WalletAddressActions address={address} />
          </div>
          {copiedAddress && (
            <div className="text-green-300 text-xs mb-4">¡Dirección copiada!</div>
          )}
          <USDCBalance />
        </div>

        {/* Divider Line */}
        <div className="border-t border-gray-200 mb-6"></div>

        {/* Wallet Information */}
        <div className="flex-1 flex flex-col min-h-0">
          <h3 className="text-gray-800 font-medium text-lg mb-4 flex-shrink-0">Historial de Transacciones</h3>
          <div 
            className="flex-1 overflow-y-auto wallet-details-scroll flex flex-col"
          >
            <div className="space-y-3 flex-1">
              <div className="text-center py-8">
                <div className="mx-auto w-16 h-16 mb-4 bg-gray-100 rounded-full flex items-center justify-center">
                  <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                </div>
                <div className="text-gray-400 text-sm">No hay transacciones aún</div>
                <div className="text-gray-500 text-xs mt-2">
                  Tus transacciones aparecerán aquí una vez que realices tu primera operación
                </div>
              </div>
            </div>
            
            {/* Footer at bottom of scrollable area */}
            <div className="text-xs text-gray-500 leading-relaxed text-center pt-4 border-t border-gray-200 mt-6 mb-4 flex-shrink-0">
              Los datos de balance se actualizan en tiempo real
            </div>
          </div>
        </div>
      </div>
    </motion.div>
    </>
  );
};

export default WalletDetails;

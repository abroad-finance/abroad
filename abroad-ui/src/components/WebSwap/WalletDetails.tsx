import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { X, Copy, ExternalLink, RefreshCw } from 'lucide-react';
import { motion } from 'framer-motion';
import { useWalletAuth } from '../../context/WalletAuthContext';
import { Horizon } from '@stellar/stellar-sdk';

// Stellar network configuration
const STELLAR_HORIZON_URL = 'https://horizon.stellar.org';
const USDC_ISSUER = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN'; // Circle's USDC issuer on Stellar mainnet

// Utility function to fetch USDC balance
const fetchUSDCBalance = async (stellarAddress: string): Promise<string> => {
  try {
    console.log('Fetching USDC balance for WalletDetails:', stellarAddress);
    
    // Create Horizon server instance
    const server = new Horizon.Server(STELLAR_HORIZON_URL);
    
    // Load account information
    const account = await server.loadAccount(stellarAddress);
    
    // Find USDC balance in account balances
    const usdcBalance = account.balances.find(balance => {
      // Check if it's a credit asset (not native XLM)
      if (balance.asset_type === 'native') return false;
      
      // Type guard to ensure we have asset_code and asset_issuer properties
      if ('asset_code' in balance && 'asset_issuer' in balance) {
        return balance.asset_code === 'USDC' && balance.asset_issuer === USDC_ISSUER;
      }
      
      return false;
    });
    
    if (usdcBalance && 'balance' in usdcBalance) {
      // Format balance to 2 decimal places with thousand separators
      const balanceValue = parseFloat(usdcBalance.balance);
      return balanceValue.toLocaleString('en-US', { 
        minimumFractionDigits: 2, 
        maximumFractionDigits: 2 
      });
    } else {
      return '0.00';
    }
  } catch (error) {
    console.error('Error fetching USDC balance in WalletDetails:', error);
    return '0.00';
  }
};

interface WalletDetailsProps {
  onClose?: () => void;
}

interface Transaction {
  id: string;
  date: string;
  destination: string;
  usdcAmount: string;
  copAmount: string;
  type: 'sent' | 'received';
  status: 'processing' | 'completed' | 'refunded' | 'canceled';
}

const WalletDetails: React.FC<WalletDetailsProps> = ({ onClose }) => {
  const [copiedAddress, setCopiedAddress] = useState(false);
  const [usdcBalance, setUsdcBalance] = useState<string>('0.00');
  const [isLoadingBalance, setIsLoadingBalance] = useState(false);
  const { address, logout } = useWalletAuth();

  // Fetch USDC balance with loading state
  const fetchUSDCBalanceWithLoading = useCallback(async (stellarAddress: string) => {
    try {
      setIsLoadingBalance(true);
      const balance = await fetchUSDCBalance(stellarAddress);
      setUsdcBalance(balance);
    } catch (error) {
      console.error('Error fetching USDC balance in WalletDetails:', error);
      setUsdcBalance('0.00');
    } finally {
      setIsLoadingBalance(false);
    }
  }, []);

  // Fetch balance when component mounts or address changes
  useEffect(() => {
    if (address) {
      fetchUSDCBalanceWithLoading(address);
    }
  }, [address, fetchUSDCBalanceWithLoading]);

  // Handle manual balance refresh
  const handleRefreshBalance = useCallback(() => {
    if (address && !isLoadingBalance) {
      fetchUSDCBalanceWithLoading(address);
    }
  }, [address, isLoadingBalance, fetchUSDCBalanceWithLoading]);

  const generateRandomPhoneNumber = () => {
    const prefixes = ['310', '311', '312', '313', '314', '315'];
    const prefix = prefixes[Math.floor(Math.random() * prefixes.length)];
    const rest = Math.floor(Math.random() * 10000000).toString().padStart(7, '0');
    const number = `${prefix}${rest}`;
    return `${number.slice(0, 3)} ${number.slice(3, 6)} ${number.slice(6, 10)}`;
  };

  // Mock data for demonstration (keeping transactions as mock for now)
  const mockTransactions: Transaction[] = useMemo(() => [
    {
      id: "1",
      date: "2024-07-05",
      destination: generateRandomPhoneNumber(),
      usdcAmount: "100.00",
      copAmount: "432,500",
      type: "sent",
      status: "completed"
    },
    {
      id: "2", 
      date: "2024-07-04",
      destination: "GAQX5L...MNOP",
      usdcAmount: "50.25",
      copAmount: "216,830",
      type: "received",
      status: "processing"
    },
    {
      id: "3",
      date: "2024-07-03", 
      destination: generateRandomPhoneNumber(),
      usdcAmount: "200.00",
      copAmount: "865,000",
      type: "sent",
      status: "refunded"
    },
    {
      id: "4",
      date: "2024-07-02", 
      destination: generateRandomPhoneNumber(),
      usdcAmount: "75.00",
      copAmount: "324,750",
      type: "sent",
      status: "canceled"
    }
  ], []);

  // Helper function to format wallet address
  const formatWalletAddress = (address: string | null) => {
    if (!address) return 'No conectado';
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  };

  const copyToClipboard = async (text: string | null) => {
    try {
      if (text) {
        await navigator.clipboard.writeText(text);
        setCopiedAddress(true);
        setTimeout(() => setCopiedAddress(false), 2000);
      }
    } catch (err) {
      console.error('Failed to copy address:', err);
    }
  };

  const handleDisconnectWallet = async () => {
    try {
      await logout();
      onClose?.(); // Close the modal after disconnect
    } catch (err) {
      console.error('Failed to disconnect wallet:', err);
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric',
      year: 'numeric'
    });
  };

  return (
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
      <div className="bg-white rounded-t-4xl md:rounded-4xl shadow-lg border border-gray-200 p-6 relative w-full h-full md:h-full md:flex md:flex-col overflow-y-auto">
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
          className="border border-gray-200 rounded-xl p-6 py-8 mb-6 bg-cover bg-center bg-no-repeat"
          style={{
            backgroundImage: 'url(https://static.vecteezy.com/system/resources/previews/026/493/927/non_2x/abstract-gradient-dark-green-liquid-wave-background-free-vector.jpg)'
          }}
        >
          {/* Wallet Address Section */}
          <div className="flex items-center justify-between mb-4">
            <span className="text-white font-mono text-sm break-all">{formatWalletAddress(address)}</span>
            <div className="flex space-x-2">
              <button
                onClick={handleDisconnectWallet}
                className="p-1 hover:bg-red-100 hover:bg-opacity-20 rounded transition-colors duration-200"
                title="Desconectar billetera"
              >
                <svg className="w-4 h-4 text-red-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                </svg>
              </button>
              <button
                onClick={() => copyToClipboard(address)}
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
          </div>
          {copiedAddress && (
            <div className="text-green-300 text-xs mb-4">¡Dirección copiada!</div>
          )}

          {/* Balance Section */}
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <img
                src="https://storage.googleapis.com/cdn-abroad/Icons/Tokens/USDC%20Token.svg"
                alt="USDC"
                className="w-5 h-5"
              />
              {isLoadingBalance ? (
                <div className="w-32 h-9 bg-white/20 rounded animate-pulse"></div>
              ) : (
                <span className="text-white font-bold text-4xl">${usdcBalance}</span>
              )}
            </div>
            {/* Refresh Balance Button */}
            <button
              onClick={handleRefreshBalance}
              disabled={isLoadingBalance}
              className="p-2 hover:bg-white hover:bg-opacity-20 rounded-full transition-colors duration-200 disabled:opacity-50"
              title="Actualizar balance"
            >
              <RefreshCw className={`w-4 h-4 text-white ${isLoadingBalance ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {/* Transaction History */}
        <div className="flex-1">
          <h3 className="text-gray-800 font-medium text-lg mb-4">Historial de Transacciones</h3>
          <div className="space-y-3">
            {mockTransactions.map((transaction) => (
              <div 
                key={transaction.id}
                className="bg-gray-50 border border-gray-200 rounded-xl p-4 hover:bg-gray-100 transition-colors duration-200"
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center space-x-2">
                    <span className="text-gray-600 text-sm">{formatDate(transaction.date)}</span>
                  </div>
                  <span className={`text-xs px-2 py-1 rounded-full ${
                    transaction.status === 'completed' ? 'bg-green-100 text-green-700' :
                    transaction.status === 'processing' ? 'bg-blue-100 text-blue-700' :
                    transaction.status === 'refunded' ? 'bg-orange-100 text-orange-700' :
                    transaction.status === 'canceled' ? 'bg-red-100 text-red-700' : ''
                  }`}>
                    {transaction.status === 'completed' ? 'Completado' :
                     transaction.status === 'processing' ? 'Procesando' :
                     transaction.status === 'refunded' ? 'Reembolsado' :
                     transaction.status === 'canceled' ? 'Cancelado' : transaction.status}
                  </span>
                </div>
                
                <div className="mb-2">
                  <span className="text-gray-500 text-xs">
                    {transaction.type === 'sent' ? 'Para: ' : 'De: '}
                  </span>
                  <span className="text-gray-700 font-mono text-sm">
                    {transaction.destination}
                  </span>
                </div>

                <div className="flex justify-between items-center">
                  <div className="flex items-center space-x-1">
                    <img
                      src="https://storage.googleapis.com/cdn-abroad/Icons/Tokens/USDC%20Token.svg"
                      alt="USDC"
                      className="w-4 h-4"
                    />
                    <span className="text-gray-700 text-xl font-bold">
                      ${transaction.usdcAmount}
                    </span>
                  </div>
                  <div className="flex items-center space-x-1">
                    <img
                      src="https://hatscripts.github.io/circle-flags/flags/co.svg"
                      alt="COP"
                      className="w-4 h-4 rounded-full"
                    />
                    <span className="text-gray-700 text-xl font-bold">
                      ${transaction.copAmount}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {mockTransactions.length === 0 && (
            <div className="text-center py-8">
              <div className="text-gray-400 text-sm">No hay transacciones aún</div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="text-xs text-gray-500 leading-relaxed text-center mt-6 pt-4 border-t border-gray-200">
          Los datos de transacciones se actualizan en tiempo real
        </div>
      </div>
    </motion.div>
  );
};

export default WalletDetails;

import React, { useState, useEffect, useCallback } from 'react';
import { X, Copy, ExternalLink } from 'lucide-react';
import { motion } from 'framer-motion';
import { useWalletAuth } from '../../context/WalletAuthContext';

interface WalletDetailsProps {
  onClose?: () => void;
}

const WalletDetails: React.FC<WalletDetailsProps> = ({ onClose }) => {
  const [copiedAddress, setCopiedAddress] = useState(false);
  const { address, logout } = useWalletAuth();

  // Function to fetch USDC balance from Stellar network
  const fetchUSDCBalance = useCallback(async (stellarAddress: string) => {
    try {
      console.log('Fetching USDC balance for address:', stellarAddress);
      setIsLoadingBalance(true);
      const server = new Horizon.Server('https://horizon.stellar.org');
      const account = await server.loadAccount(stellarAddress);
      
      // Account loaded successfully, balances retrieved.
      
      // USDC on Stellar mainnet: USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN
      const usdcAssetCode = 'USDC';
      const usdcIssuer = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';
      
      const usdcBalance = account.balances.find((balance) => {
        // Check if it's a credit_alphanum4 asset (USDC is 4 characters)
        if (balance.asset_type === 'credit_alphanum4') {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const assetBalance = balance as any; // Type assertion for the balance structure
          return assetBalance.asset_code === usdcAssetCode && assetBalance.asset_issuer === usdcIssuer;
        }
        return false;
      });
      
      // USDC balance found, proceed with processing
      
      if (usdcBalance) {
        const numericBalance = parseFloat((usdcBalance as StellarBalance).balance);
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
    const fetchTransactions = async () => {
      if (!user) {
        setLoading(false);
        return;
      }

      setLoading(true);
      try {
        const response = await listPartnerTransactions({ page: 1, pageSize: 50 });
        if (response.data && 'transactions' in response.data) {
          const userObj = user as BluxUser;
          const currentUserId = userObj.id || userObj.userId;

          if (currentUserId) {
            const userTransactions = response.data.transactions.filter(
              (tx) => tx.partnerUserId === currentUserId
            );
            setTransactions(userTransactions);
          } else {
            setTransactions(response.data.transactions);
          }
        }
      } catch (error) {
        console.error("Failed to fetch transactions:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchTransactions();
  }, [user]);

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
    <>
      <style>
        {`
          .custom-scrollbar::-webkit-scrollbar {
            width: 4px;
          }
          .custom-scrollbar::-webkit-scrollbar-track {
            background: transparent;
          }
          .custom-scrollbar::-webkit-scrollbar-thumb {
            background: transparent;
            border-radius: 2px;
            transition: background 0.3s ease;
          }
          .custom-scrollbar:hover::-webkit-scrollbar-thumb {
            background: #d1d5db;
          }
          .custom-scrollbar::-webkit-scrollbar-thumb:hover {
            background: #9ca3af;
          }
        `}
      </style>
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
        </div>

        {/* Divider Line */}
        <div className="border-t border-gray-200 mb-6"></div>

        {/* Transaction History */}
        <div className="flex-1 flex flex-col min-h-0">
          <h3 className="text-gray-800 font-medium text-lg mb-4 flex-shrink-0">Historial de Transacciones</h3>
          <div 
            className="flex-1 overflow-y-auto custom-scrollbar flex flex-col" 
            style={{
              scrollbarWidth: 'thin',
              scrollbarColor: '#d1d5db transparent'
            }}
          >
            <div className="space-y-3 flex-1">
              {loading ? (
                <>
                  <TransactionSkeleton />
                  <TransactionSkeleton />
                </>
              ) : transactions.length > 0 ? (
                transactions.map((transaction) => {
                  const uiStatus = getStatus(transaction.status);
                  return (
                    <div
                      key={transaction.id}
                      className="bg-gray-50 border border-gray-200 rounded-xl p-4 hover:bg-gray-100 transition-colors duration-200"
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center space-x-2">
                          <span className="text-gray-600 text-sm">{formatDate(transaction.createdAt)}</span>
                        </div>
                        <span className={`text-xs px-2 py-1 rounded-full ${
                          uiStatus.type === 'completed' ? 'bg-green-100 text-green-700' :
                          uiStatus.type === 'processing' ? 'bg-blue-100 text-blue-700' :
                          uiStatus.type === 'refunded' ? 'bg-orange-100 text-orange-700' :
                          uiStatus.type === 'canceled' ? 'bg-red-100 text-red-700' : ''
                        }`}>
                          {uiStatus.label}
                        </span>
                      </div>
                      
                      <div className="mb-2">
                        <span className="text-gray-500 text-xs">
                          Para: 
                        </span>
                        <span className="text-gray-700 font-mono text-sm">
                          {transaction.accountNumber}
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
                            ${formatNumber(transaction.quote.sourceAmount)}
                          </span>
                        </div>
                        <div className="flex items-center space-x-1">
                          <img
                            src={`https://hatscripts.github.io/circle-flags/flags/${transaction.quote.targetCurrency.slice(0, 2).toLowerCase()}.svg`}
                            alt={transaction.quote.targetCurrency}
                            className="w-4 h-4 rounded-full"
                          />
                          <span className="text-gray-700 text-xl font-bold">
                            ${formatNumber(transaction.quote.targetAmount)}
                          </span>
                        </div>
                      </div>
                    </div>
                  )
                })
              ) : (
                <div className="text-center py-8">
                  <EmptyTransactionPlaceholder />
                  <div className="text-gray-400 text-sm">No hay transacciones aún</div>
                </div>
              )}
            </div>
            
            {/* Footer at bottom of scrollable area */}
            <div className="text-xs text-gray-500 leading-relaxed text-center pt-4 border-t border-gray-200 mt-6 mb-4 flex-shrink-0">
              Los datos de transacciones se actualizan en tiempo real
            </div>
          </div>
        </div>
      </div>
    </motion.div>
    </>
  );
};

export default WalletDetails;

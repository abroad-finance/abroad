import React, { useState, useEffect, useCallback } from 'react';
import { X, Copy, ExternalLink } from 'lucide-react';
import { motion } from 'framer-motion';
import { useBlux } from '@bluxcc/react';
import { Horizon } from '@stellar/stellar-sdk';
import { listPartnerTransactions, PaginatedTransactionListTransactionsItem, _36EnumsTransactionStatus } from '../../api';

interface WalletDetailsProps {
  onClose?: () => void;
}

const WalletDetails: React.FC<WalletDetailsProps> = ({ onClose }) => {
  const { user, logout } = useBlux();
  const [copiedAddress, setCopiedAddress] = useState(false);
  const [transactions, setTransactions] = useState<PaginatedTransactionListTransactionsItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [usdcBalance, setUsdcBalance] = useState<string>('');
  const [isLoadingBalance, setIsLoadingBalance] = useState(false);

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
  const formatWalletAddress = (address: string) => {
    if (!address) return 'No conectado';
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  };

  const formatNumber = (value?: number) => {
    if (value === undefined) return "-";
    try {
      return value.toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
    } catch {
      return value.toFixed(2);
    }
  };

  type UiStatus = 'processing' | 'completed' | 'refunded' | 'canceled';

  const getStatus = (status: _36EnumsTransactionStatus): { type: UiStatus, label: string } => {
    switch (status) {
      case 'PAYMENT_COMPLETED':
        return { type: 'completed', label: 'Completado' };
      case 'PROCESSING_PAYMENT':
        return { type: 'processing', label: 'Procesando' };
      case 'AWAITING_PAYMENT':
        return { type: 'processing', label: 'Procesando' };
      case 'PAYMENT_FAILED':
        return { type: 'canceled', label: 'Cancelado' };
      case 'WRONG_AMOUNT':
        return { type: 'refunded', label: 'Reembolsado' };
      default:
        return { type: 'processing', label: status };
    }
  };

  // Get public key from user object using Blux documentation
  const getPublicKey = (): string => {
    if (!user) {
      console.log('No user found');
      return 'GDQP2KPLX4V2M8N9JKHL6RTGF3SWQAZ7UXCV8BNMLKJHGF4DSAQWERTY'; // Mock address for demo
    }
    
    console.log('Blux user object:', user);
    
    // According to Blux docs, use wallet.address property
    const userObj = user as unknown as Record<string, unknown>;
    
    // First check for wallet.address as specified
    if (userObj.wallet && typeof userObj.wallet === 'object') {
      const wallet = userObj.wallet as Record<string, unknown>;
      console.log('Wallet object:', wallet);
      if (typeof wallet.address === 'string') {
        console.log('Found wallet.address:', wallet.address);
        return wallet.address;
      }
    }
    
    // Fallback to other properties
    const publicKey = userObj.stellarAddress || 
           userObj.address || 
           userObj.walletAddress || 
           userObj.publicKey || 
           userObj.accountId ||
           userObj.id;
    
    console.log('Fallback public key found:', publicKey);
           
    return typeof publicKey === 'string' ? publicKey : 'GDQP2KPLX4V2M8N9JKHL6RTGF3SWQAZ7UXCV8BNMLKJHGF4DSAQWERTY';
  };

  const walletAddress = getPublicKey();

  // Effect to fetch USDC balance when component mounts
  useEffect(() => {
    if (walletAddress && walletAddress !== 'GDQP2KPLX4V2M8N9JKHL6RTGF3SWQAZ7UXCV8BNMLKJHGF4DSAQWERTY') {
      fetchUSDCBalance(walletAddress);
    }
  }, [walletAddress, fetchUSDCBalance]);

  const TransactionSkeleton: React.FC = () => (
    <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 animate-pulse">
      <div className="flex items-center justify-between mb-3">
        <div className="h-3 bg-gray-200 rounded w-1/4"></div>
        <div className="h-4 bg-gray-200 rounded-full w-16"></div>
      </div>
      <div className="mb-3">
        <div className="h-3 bg-gray-200 rounded w-1/5 mb-1.5"></div>
        <div className="h-4 bg-gray-200 rounded w-2/5"></div>
      </div>
      <div className="flex justify-between items-center">
        <div className="flex items-center space-x-2 w-1/2">
          <div className="w-5 h-5 bg-gray-200 rounded-full"></div>
          <div className="h-6 bg-gray-200 rounded w-2/3"></div>
        </div>
        <div className="flex items-center space-x-2 w-1/2 justify-end">
          <div className="w-5 h-5 bg-gray-200 rounded-full"></div>
          <div className="h-6 bg-gray-200 rounded w-2/3"></div>
        </div>
      </div>
    </div>
  );

  const EmptyTransactionPlaceholder: React.FC = () => (
    <div className="bg-gray-50 border border-gray-200 rounded-lg p-2 w-1/2 mx-auto opacity-30 mb-4 relative">
      {/* Alert icon */}
      <div className="absolute -top-1 -right-1 w-4 h-4 bg-orange-400 rounded-full flex items-center justify-center">
        <span className="text-white text-xs font-bold">!</span>
      </div>
      <div className="flex items-center justify-between mb-1">
        <div className="h-1.5 bg-gray-200 rounded w-1/4"></div>
        <div className="h-2 bg-gray-200 rounded-full w-8"></div>
      </div>
      <div className="mb-1">
        <div className="h-1.5 bg-gray-200 rounded w-1/5 mb-0.5"></div>
        <div className="h-2 bg-gray-200 rounded w-2/5"></div>
      </div>
      <div className="flex justify-between items-center">
        <div className="flex items-center space-x-1 w-1/2">
          <div className="w-3 h-3 bg-gray-200 rounded-full"></div>
          <div className="h-2.5 bg-gray-200 rounded w-2/3"></div>
        </div>
        <div className="flex items-center space-x-1 w-1/2 justify-end">
          <div className="w-3 h-3 bg-gray-200 rounded-full"></div>
          <div className="h-2.5 bg-gray-200 rounded w-2/3"></div>
        </div>
      </div>
    </div>
  );

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedAddress(true);
      setTimeout(() => setCopiedAddress(false), 2000);
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
            <span className="text-white font-mono text-sm break-all">{formatWalletAddress(walletAddress)}</span>
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
                onClick={() => copyToClipboard(walletAddress)}
                className="p-1 hover:bg-white hover:bg-opacity-20 rounded transition-colors duration-200"
                title="Copiar dirección"
              >
                <Copy className="w-4 h-4 text-white" />
              </button>
              <button
                onClick={() => window.open(`https://stellar.expert/explorer/public/account/${walletAddress}`, '_blank')}
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

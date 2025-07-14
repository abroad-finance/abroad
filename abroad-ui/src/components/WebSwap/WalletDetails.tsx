import React, { useState } from 'react';
import { X, Copy, ExternalLink } from 'lucide-react';
import { motion } from 'framer-motion';
import { useBlux } from '@bluxcc/react';

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
  const { user, logout } = useBlux();
  const [copiedAddress, setCopiedAddress] = useState(false);

  // Mock data for demonstration
  const mockBalance = {
    usdc: "1,234.56",
    cop: "5,432,100"
  };

  const mockTransactions: Transaction[] = [
    {
      id: "1",
      date: "2024-07-05",
      destination: "GDQP2K...VWXY",
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
      destination: "GBRT8M...QRST",
      usdcAmount: "200.00",
      copAmount: "865,000",
      type: "sent",
      status: "refunded"
    },
    {
      id: "4",
      date: "2024-07-02", 
      destination: "GCXY9Z...ABCD",
      usdcAmount: "75.00",
      copAmount: "324,750",
      type: "sent",
      status: "canceled"
    }
  ];

  // Helper function to format wallet address
  const formatWalletAddress = (address: string) => {
    if (!address) return 'Not connected';
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  };

  // Get public key from user object using Blux documentation
  const getPublicKey = (): string => {
    if (!user) return 'GDQP2KPLX4V2M8N9JKHL6RTGF3SWQAZ7UXCV8BNMLKJHGF4DSAQWERTY'; // Mock address for demo
    
    // According to Blux docs, use wallet.address property
    const userObj = user as unknown as Record<string, unknown>;
    
    // First check for wallet.address as specified
    if (userObj.wallet && typeof userObj.wallet === 'object') {
      const wallet = userObj.wallet as Record<string, unknown>;
      if (typeof wallet.address === 'string') {
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
           
    return typeof publicKey === 'string' ? publicKey : 'GDQP2KPLX4V2M8N9JKHL6RTGF3SWQAZ7UXCV8BNMLKJHGF4DSAQWERTY';
  };

  const walletAddress = getPublicKey();

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
        <div className="mb-6 pr-8 text-center mt-5 md:mt-15">
          <h2 className="text-2xl font-semibold text-gray-900 mb-2">
            Account Details
          </h2>
          <p className="text-md text-gray-600">
            Manage your wallet and view transaction history
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
            <span className="text-white font-mono text-sm break-all">{formatWalletAddress(walletAddress)}</span>
            <div className="flex space-x-2">
              <button
                onClick={handleDisconnectWallet}
                className="p-1 hover:bg-red-100 hover:bg-opacity-20 rounded transition-colors duration-200"
                title="Disconnect wallet"
              >
                <svg className="w-4 h-4 text-red-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                </svg>
              </button>
              <button
                onClick={() => copyToClipboard(walletAddress)}
                className="p-1 hover:bg-white hover:bg-opacity-20 rounded transition-colors duration-200"
                title="Copy address"
              >
                <Copy className="w-4 h-4 text-white" />
              </button>
              <button
                onClick={() => window.open(`https://stellar.expert/explorer/public/account/${walletAddress}`, '_blank')}
                className="p-1 hover:bg-white hover:bg-opacity-20 rounded transition-colors duration-200"
                title="View on explorer"
              >
                <ExternalLink className="w-4 h-4 text-white" />
              </button>
            </div>
          </div>
          {copiedAddress && (
            <div className="text-green-300 text-xs mb-4">Address copied!</div>
          )}

          {/* Balance Section */}
          <div className="flex items-center space-x-3">
            <img
              src="https://storage.googleapis.com/cdn-abroad/Icons/Tokens/USDC%20Token.svg"
              alt="USDC"
              className="w-5 h-5"
            />
            <span className="text-white font-bold text-4xl">${mockBalance.usdc}</span>
          </div>
        </div>

        {/* Transaction History */}
        <div className="flex-1">
          <h3 className="text-gray-800 font-medium text-lg mb-4">Transaction History</h3>
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
                    {transaction.status === 'completed' ? 'Completed' :
                     transaction.status === 'processing' ? 'Processing' :
                     transaction.status === 'refunded' ? 'Refunded' :
                     transaction.status === 'canceled' ? 'Canceled' : transaction.status}
                  </span>
                </div>
                
                <div className="mb-2">
                  <span className="text-gray-500 text-xs">
                    {transaction.type === 'sent' ? 'To: ' : 'From: '}
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
              <div className="text-gray-400 text-sm">No transactions yet</div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="text-xs text-gray-500 leading-relaxed text-center mt-6 pt-4 border-t border-gray-200">
          Transaction data is updated in real-time
        </div>
      </div>
    </motion.div>
  );
};

export default WalletDetails;

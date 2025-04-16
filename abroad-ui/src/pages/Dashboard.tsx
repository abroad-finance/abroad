import React, { useState } from "react";
import { Card, CardContent } from "../components/card";
import { Button } from "../components/button";
import Navbar from "../components/navbar";
import { getQuote, QuoteRequest, QuoteResponse, getReverseQuote, ReverseQuoteRequest } from "../api/apiClient";

export function Dashboard() {
  const [activeSection, setActiveSection] = useState<string>("dashboard");

  return (
    <div className="min-h-screen p-4 bg-gray-50">
      <Navbar activeSection={activeSection} setActiveSection={setActiveSection} />
      <DashboardHome />
    </div>
  );
}

function DashboardHome() {
  const [usdcAmount, setUsdcAmount] = useState(0);
  const [copQuote, setCopQuote] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [balance, setBalance] = useState(12500.00); // Add balance state
  const [walletStatus, setWalletStatus] = useState("Wallet Connected");
  const recipients = ["ABC Corp", "Example Ltd", "John Doe"];
  const [selectedRecipient, setSelectedRecipient] = useState(recipients[0]);
  const [isConnecting, setIsConnecting] = useState(false);
  const [selectedCurrency, setSelectedCurrency] = useState<'USDC' | 'COP'>('USDC');
  const [hasQuote, setHasQuote] = useState(false);
  const [recentTransactions, setRecentTransactions] = useState([
    { timestamp: "2024-01-15 14:30", recipient: "ABC Corp", amountUSDC: 1500, amountCOP: 6000000 },
    { timestamp: "2024-01-14 09:15", recipient: "John Doe", amountUSDC: 800, amountCOP: 3200000 },
    { timestamp: "2024-01-13 16:45", recipient: "Example Ltd", amountUSDC: 2000, amountCOP: 8000000 },
    { timestamp: "2024-01-12 11:20", recipient: "ABC Corp", amountUSDC: 1200, amountCOP: 4800000 },
    { timestamp: "2024-01-11 13:50", recipient: "John Doe", amountUSDC: 950, amountCOP: 3800000 },
  ]);

  const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    
    // Remove any non-digit characters except decimal point
    const sanitizedValue = value.replace(/[^\d.]/g, '');
    
    // Ensure only one decimal point
    const parts = sanitizedValue.split('.');
    const cleanValue = parts[0] + (parts.length > 1 ? '.' + parts[1] : '');
    
    // Convert to number and validate
    const numericValue = Number(cleanValue);
    
    // Reset quote states when amount changes
    setCopQuote(null);
    setHasQuote(false);
    
    // Only update if it's a valid positive number or empty string
    if (cleanValue === '' || (numericValue >= 0 && !isNaN(numericValue))) {
      if (selectedCurrency === 'COP') {
        // For COP, only allow integers without formatting
        const intValue = parseInt(cleanValue) || 0;
        setUsdcAmount(intValue);
        e.target.value = intValue.toString();
      } else {
        // For USDC, allow decimals up to 2 places
        const formattedValue = numericValue.toString();
        setUsdcAmount(Number(formattedValue));
        e.target.value = formattedValue;
      }
    }
  };

  const handleCurrencyChange = (currency: 'USDC' | 'COP') => {
    setSelectedCurrency(currency);
    setUsdcAmount(0); // Reset amount
    setCopQuote(null); // Clear quote
    setHasQuote(false); // Reset quote status
  };

  const handleWalletConnection = async () => {
    if (balance === 0) {
      setIsConnecting(true);
      try {
        // Simulate server response - replace with actual wallet connection
        await new Promise(resolve => setTimeout(resolve, 2000));
        setBalance(12500.00);
        setWalletStatus("Wallet Connected");
      } finally {
        setIsConnecting(false);
      }
    } else {
      setBalance(0);
      setWalletStatus("Wallet Disconnected");
    }
  };

  const handleGetQuote = async () => {
    if (hasQuote) {
      // Handle transaction acceptance
      try {
        setLoading(true);
        const newTransaction = {
          timestamp: new Date().toISOString().replace('T', ' ').substring(0, 16),
          recipient: selectedRecipient,
          amountUSDC: selectedCurrency === 'USDC' ? usdcAmount : copQuote || 0,
          amountCOP: selectedCurrency === 'COP' ? usdcAmount : copQuote || 0
        };
        
        setRecentTransactions([newTransaction, ...recentTransactions.slice(0, -1)]);
        setUsdcAmount(0);
        setCopQuote(null);
        setHasQuote(false);
      } catch (error) {
        console.error("Failed to process transaction:", error);
      } finally {
        setLoading(false);
      }
      return;
    }

    try {
      setLoading(true);
      if (selectedCurrency === 'USDC') {
        const reverseQuoteRequest: ReverseQuoteRequest = {
          target_currency: "COP",
          source_amount: usdcAmount,
          payment_method: "NEQUI",
          network: "STELLAR",
          crypto_currency: "USDC",
        };
        const quoteResponse = await getReverseQuote(reverseQuoteRequest);
        setCopQuote(quoteResponse.value);
      } else {
        // When sending COP, correct the target/source currency configuration
        const quoteRequest: QuoteRequest = {
          target_currency: "COP",  // The currency we want to receive
          amount: usdcAmount,  // The COP amount entered by user
          payment_method: "NEQUI",
          network: "STELLAR",
          crypto_currency: "USDC",
        };
        const quoteResponse = await getQuote(quoteRequest);
        if (quoteResponse && quoteResponse.value) {
          setCopQuote(quoteResponse.value);
        } else {
          throw new Error('Invalid quote response');
        }
      }
      setHasQuote(true);
    } catch (error) {
      console.error("Failed to get quote:", error);
      setCopQuote(null);
      setHasQuote(false);
    } finally {
      setLoading(false);
    }
  };

  const getWalletMessage = () => {
    return walletStatus === "Wallet Connected" 
      ? "Total balance available for transactions"
      : "Please connect your wallet in order to make transactions";
  };

  return (
    <div className="space-y-4 relative">
      {isConnecting && (
        <div className="fixed inset-0 bg-black bg-opacity-10 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 flex flex-col items-center space-y-4">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#48b395]"></div>
            <p className="text-lg font-medium">Connecting wallet...</p>
          </div>
        </div>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-16">  {/* This adds 4rem (64px) top margin */}
        {/* Balance Card */}
        <Card className="rounded-xl w-full border-0 shadow-lg">
          <CardContent className="flex flex-col items-center justify-center text-center h-full">
            <img
              src="https://assets.streamlinehq.com/image/private/w_300,h_300,ar_1/f_auto/v1/icons/vectors/usdc-fpxuadmgafrjjy85bgie5.png/usdc-kksfxcrdl3f9pjx0v6jxxp.png?_a=DAJFJtWIZAAC"
              alt="USDC Logo"
              className="w-10 h-10 mb-2"
            />
            <p className="text-5xl font-bold">
              ${balance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </p>
            <p className="text-sm text-gray-600 flex items-center justify-center gap-1 mt-1">
              {getWalletMessage()}
            </p>
            <Button 
              onClick={handleWalletConnection}
              className="mt-4 rounded-xl text-white bg-gradient-to-r from-[#48b395] to-[#247469] hover:opacity-90"
            >
              {balance === 0 ? "Connect your wallet" : "Disconnect your wallet"}
            </Button>
          </CardContent>
        </Card>

        {/* Transfer Card */}
        <Card className="rounded-xl w-full border-0 shadow-lg">
          <CardContent className="space-y-4">
            <h3 className="text-xl font-semibold">Make an Instant Transfer</h3>
            
            {/* Currency Toggle */}
            <div className="flex rounded-lg border border-gray-200 p-1">
              <button
                onClick={() => handleCurrencyChange('USDC')}
                className={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition-colors ${
                  selectedCurrency === 'USDC'
                    ? 'bg-[#48b395] text-white'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                Send USDC
              </button>
              <button
                onClick={() => handleCurrencyChange('COP')}
                className={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition-colors ${
                  selectedCurrency === 'COP'
                    ? 'bg-[#48b395] text-white'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                Send COP
              </button>
            </div>

            <div className="flex items-center gap-2 border-b border-gray-300 pb-1">
              {selectedCurrency === 'USDC' ? (
                <img 
                  src="https://assets.streamlinehq.com/image/private/w_300,h_300,ar_1/f_auto/v1/icons/vectors/usdc-fpxuadmgafrjjy85bgie5.png/usdc-kksfxcrdl3f9pjx0v6jxxp.png?_a=DAJFJtWIZAAC" 
                  alt="USDC Logo" 
                  className="h-6 w-6" 
                />
              ) : (
                <img 
                  src="https://vectorflags.s3.amazonaws.com/flags/co-circle-01.png" 
                  alt="Colombian Flag" 
                  className="h-6 w-6" 
                />
              )}
              <div className="relative w-full">
                <span className="absolute left-0 top-1/2 -translate-y-1/2 text-2xl font-bold text-gray-700">
                  $
                </span>
                <input
                  inputMode="decimal"
                  type="text"
                  placeholder="0.00"
                  value={selectedCurrency === 'COP' 
                    ? usdcAmount.toString()
                    : usdcAmount || ''
                  }
                  onChange={handleAmountChange}
                  className="pl-6 w-full text-5xl font-bold text-gray-900 bg-transparent focus:outline-none"
                  pattern="[0-9]*[.,]?[0-9]*"
                />
              </div>
            </div>
            <div>
              <label className="block mb-1 text-sm font-medium text-gray-700">
                Select recipient
              </label>
              <select
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
                value={selectedRecipient}
                onChange={(e) => setSelectedRecipient(e.target.value)}
              >
                {recipients.map((recipient, index) => (
                  <option key={index} value={recipient}>
                    {recipient}
                  </option>
                ))}
              </select>
            </div>
            <Button
              onClick={handleGetQuote}
              className="w-full rounded-xl text-white bg-gradient-to-r from-[#48b395] to-[#247469] hover:opacity-90"
              disabled={loading || (selectedCurrency === 'USDC' && usdcAmount <= 0)}
            >
              {loading ? "Loading..." : hasQuote ? "Accept Transaction" : "Get Quote"}
            </Button>
            {copQuote !== null && (
              <>
                <p className="mt-4 text-xl font-bold text-gray-600">
                  {selectedCurrency === 'USDC' ? (
                    `Quotation: COP $${copQuote.toLocaleString()}`
                  ) : (
                    `Quotation: USDC $${copQuote.toLocaleString()}`
                  )}
                </p>
                <p className="text-sm text-gray-500">
                  {selectedCurrency === 'USDC' ? (
                    `Exchange Rate: 1 USDC = COP $${(copQuote / usdcAmount).toFixed(2)}`
                  ) : (
                    `Exchange Rate: 1 USDC = COP $${(usdcAmount / copQuote).toFixed(2)}`
                  )}
                </p>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1">
        <Card className="rounded-xl w-full border-0 shadow-lg">
          <CardContent>
            <h3 className="text-xl font-semibold mb-4">Recent Transactions</h3>
            <div className="overflow-x-auto">
              <table className="min-w-full">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="text-left py-3 px-4 text-sm font-medium text-gray-600">Date & Time</th>
                    <th className="text-left py-3 px-4 text-sm font-medium text-gray-600">Recipient</th>
                    <th className="text-right py-3 px-4 text-sm font-medium text-gray-600">Amount (USDC)</th>
                    <th className="text-right py-3 px-4 text-sm font-medium text-gray-600">Amount (COP)</th>
                  </tr>
                </thead>
                <tbody>
                  {recentTransactions.map((tx, index) => (
                    <tr key={index} className="border-b border-gray-100">
                      <td className="py-3 px-4 text-sm text-gray-600">{tx.timestamp}</td>
                      <td className="py-3 px-4 text-sm text-gray-900">{tx.recipient}</td>
                      <td className="py-3 px-4 text-sm text-gray-900 text-right">${tx.amountUSDC.toLocaleString()}</td>
                      <td className="py-3 px-4 text-sm text-gray-900 text-right">
                        COP ${tx.amountCOP.toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

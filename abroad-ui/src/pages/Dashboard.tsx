import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "../components/card";
import { Button } from "../components/button";
import Navbar from "../components/navbar";
import { getQuote, QuoteRequest, getReverseQuote, ReverseQuoteRequest, listPartnerUsers, PaginatedPartnerUsers, listPartnerTransactions, PaginatedTransactionList, QuoteResponse, acceptTransaction, AcceptTransactionRequest } from "../api/apiClient";
import { isConnected, requestAccess, getNetworkDetails, signTransaction } from "@stellar/freighter-api"; // Import Freighter functions
import { Memo, Operation, Asset, TransactionBuilder, Transaction as StellarTransaction } from "@stellar/stellar-sdk";
import { Horizon } from "@stellar/stellar-sdk";

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
  const [usdcInput, setUsdcInput] = useState<string>("0");
  const [loading, setLoading] = useState(false);
  const [balance, setBalance] = useState(0.00); // Start with 0 balance
  const [isConnecting, setIsConnecting] = useState(false);
  const [selectedCurrency, setSelectedCurrency] = useState<'USDC' | 'COP'>('USDC');
  const [quote, setQuote] = useState<QuoteResponse | null>(null);
  const [partnerUsers, setPartnerUsers] = useState<PaginatedPartnerUsers | null>(null);
  const [recipientInput, setRecipientInput] = useState("");
  const [showRecipientOptions, setShowRecipientOptions] = useState(false);
  const [transactions, setTransactions] = useState<PaginatedTransactionList | null>(null);
  const [publicKey, setPublicKey] = useState<string | null>(null); // State for public key
  const [connectionError, setConnectionError] = useState<string | null>(null); // State for connection errors

  const fetchWalletBalance = useCallback(async (address: string) => {
    if (!(await isConnected())) {
      return;
    }

    // Detailed network information
    const details = await getNetworkDetails();
    if (details.network !== "PUBLIC") {
      alert("You are not connected to the public network. Please switch to the public network.");
    }

    const server = new Horizon.Server(details.networkUrl);

    const account = await server.loadAccount(address!); // Use publicKey from state
    const balance = account.balances.find((b) => b.asset_type === "credit_alphanum4" && b.asset_code === "USDC" && b.asset_issuer === "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN");

    if (balance) {
      setBalance(parseFloat(balance.balance));
    } else {
      console.error("USDC balance not found for the account.");
      setBalance(0);
    }
  }, []);

  const disconnectWallet = useCallback(async () => {
    setPublicKey(null);
    setBalance(0);
  }, []);

  const connectWallet = useCallback(async () => {
    setIsConnecting(true);
    try {
      const freighterConnected = await isConnected();
      if (!freighterConnected) {
        setConnectionError("Freighter extension not detected. Please install it.");
        setIsConnecting(false);
        return;
      }

      const accessObj = await requestAccess();
      if (accessObj.error) {
        console.error("Error requesting access:", accessObj.error);
        setConnectionError(`Failed to connect: ${accessObj.error}`);
      } else if (accessObj.address) { // Check if address exists
        setPublicKey(accessObj.address); // Set only the address string
        // TODO: Fetch actual balance based on publicKey
        fetchWalletBalance(accessObj.address); // Fetch balance
      }
    } catch (error) {
      console.error("Failed to connect wallet:", error);
      setConnectionError("An unexpected error occurred during connection.");
    } finally {
      setIsConnecting(false);
    }
  }, [fetchWalletBalance]);

  useEffect(() => {
    const fetchPartnerUsers = async () => {
      try {
        const users = await listPartnerUsers();
        setPartnerUsers(users);
      } catch (error) {
        console.error("Failed to fetch partner users:", error);
      }
    };
    fetchPartnerUsers();

    const fetchTransactions = async () => {
      try {
        const txs = await listPartnerTransactions();
        setTransactions(txs);
      } catch (error) {
        console.error("Failed to fetch transactions:", error);
      }
    };
    fetchTransactions();

    // Check connection on load
    const checkFreighterConnection = async () => {
      const connected = await isConnected();
      if (connected) {
        connectWallet();
      }
    };
    checkFreighterConnection();
  }, [connectWallet]);

  const handleAmountChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;

    // Remove any non-digit characters except decimal point
    let sanitizedValue = value.replace(/[^\d.]/g, '');

    // Only allow one decimal point
    const firstDot = sanitizedValue.indexOf('.');
    if (firstDot !== -1) {
      sanitizedValue =
        sanitizedValue.slice(0, firstDot + 1) +
        sanitizedValue.slice(firstDot + 1).replace(/\./g, '');
    }

    if (selectedCurrency === 'USDC') {
      const decimalMatch = sanitizedValue.match(/^\d*(\.\d{0,2})?$/);
      if (decimalMatch) {
        setUsdcInput(sanitizedValue === "" ? "" : sanitizedValue);
        setUsdcAmount(sanitizedValue === "" || sanitizedValue === "." ? 0 : Number(sanitizedValue));
      }
    } else {
      const intValue = sanitizedValue.replace(/\./g, "");
      const numericValue = intValue === "" ? 0 : parseInt(intValue);
      setUsdcAmount(numericValue);
      setUsdcInput(intValue === "" ? "" : numericValue.toLocaleString("en-US"));
    }
    setQuote(null);
  }, [selectedCurrency]);

  const handleCurrencyChange = useCallback((currency: 'USDC' | 'COP') => {
    setSelectedCurrency(currency);
    setUsdcAmount(0); // Reset amount
    setUsdcInput("0");
    setQuote(null);
  }, []);


  const handleWalletConnection = useCallback(async () => {
    setConnectionError(null);
    if (publicKey) {
      disconnectWallet();
    } else {
      await connectWallet();
    }
  }, [connectWallet, disconnectWallet, publicKey]);

  const handleGetQuote = useCallback(async () => {
    if (quote) {
      try {
        setLoading(true);
        setUsdcAmount(0);
        setUsdcInput("0");
        setQuote(null);
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
          payment_method: "MOVII",
          network: "STELLAR",
          crypto_currency: "USDC",
        };
        const quoteResponse = await getReverseQuote(reverseQuoteRequest);
        setQuote(quoteResponse);
      } else {
        const quoteRequest: QuoteRequest = {
          target_currency: "COP",
          amount: usdcAmount,
          payment_method: "MOVII",
          network: "STELLAR",
          crypto_currency: "USDC",
        };
        const quoteResponse = await getQuote(quoteRequest);
        if (quoteResponse && quoteResponse.value) {
          setQuote(quoteResponse);
        } else {
          throw new Error('Invalid quote response');
        }
      }
    } catch (error) {
      console.error("Failed to get quote:", error);
      setQuote(null);
    } finally {
      setLoading(false);
    }
  }, [quote, selectedCurrency, usdcAmount]);

  const handleAcceptTransaction = useCallback(async () => {
    if (!quote) return;
    const recipient = partnerUsers?.users.find(u => u.userId === recipientInput);
    if (!recipient?.accountNumber || !recipient?.bank) {
      console.error("Recipient account or bank missing");
      return;
    }
    try {
      setLoading(true);
      const acceptReq: AcceptTransactionRequest = {
        account_number: recipient.accountNumber,
        bank_code: recipient.bank,
        quote_id: quote.quote_id,
        user_id: recipient.userId,
      };
      const acceptRes = await acceptTransaction(acceptReq);
      const memoText = acceptRes.transaction_reference;
      // Build a Stellar payment transaction including memo
      const details = await getNetworkDetails();
      const server = new Horizon.Server(details.networkUrl);
      const sourceAccount = await server.loadAccount(publicKey!);
      const baseFee = await server.fetchBaseFee();
      const usdcAsset = new Asset(
        "USDC",
        "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN"
      );
      const destination = import.meta.env.VITE_ABROAD_STELLAR_ADDRESS
      const tx = new TransactionBuilder(sourceAccount, {
        fee: baseFee.toString(),
        networkPassphrase: details.networkPassphrase,
        memo: Memo.text(memoText),
      })
        .addOperation(
          Operation.payment({
            destination,
            asset: usdcAsset,
            amount: selectedCurrency === 'USDC' ? usdcAmount.toString() : quote.value.toString()
          })
        )
        .setTimeout(600)
        .build();
      // Sign the transaction with Freighter
      const signResult = await signTransaction(tx.toXDR());
      if ('error' in signResult) throw new Error(signResult.error);
      const signedTxXdr = signResult.signedTxXdr;
      const signedTx = new StellarTransaction(
        signedTxXdr,
        "PUBLIC"
      );
      // Submit to the network
      await server.submitTransaction(signedTx);
      // Refresh transaction list
      const txs = await listPartnerTransactions();
      setTransactions(txs);
      // Reset state
      setQuote(null);
      setRecipientInput("");
    } catch (error) {
      console.error("Failed to accept transaction:", error);
      setQuote(null);
    } finally {
      setLoading(false);
    }
  }, [quote, recipientInput, partnerUsers, selectedCurrency, usdcAmount, publicKey]);

  const getWalletMessage = useCallback(() => {
    if (connectionError) return connectionError;
    return publicKey
      ? `Connected: ${publicKey.substring(0, 6)}...${publicKey.substring(publicKey.length - 4)}`
      : "Please connect your wallet to make transactions";
  }, [connectionError, publicKey]);

  const filteredRecipients = useMemo(() => {
    return partnerUsers?.users.filter((user) =>
      user.userId.toLowerCase().includes(recipientInput.toLowerCase())
    ) || [];
  }, [partnerUsers, recipientInput]);

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
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-16">
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
              disabled={isConnecting}
            >
              {isConnecting ? "Connecting..." : publicKey ? "Disconnect Wallet" : "Connect Freighter Wallet"}
            </Button>
          </CardContent>
        </Card>

        <Card className="rounded-xl w-full border-0 shadow-lg">
          <CardContent className="space-y-4">
            <h3 className="text-xl font-semibold">Make an Instant Transfer</h3>
            <div className="flex rounded-lg border border-gray-200 p-1">
              <button
                onClick={() => handleCurrencyChange('USDC')}
                className={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition-colors ${selectedCurrency === 'USDC'
                  ? 'bg-[#48b395] text-white'
                  : 'text-gray-500 hover:text-gray-700'
                  }`}
              >
                Send USDC
              </button>
              <button
                onClick={() => handleCurrencyChange('COP')}
                className={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition-colors ${selectedCurrency === 'COP'
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
                  value={usdcInput}
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
              <div className="relative">
                <input
                  type="text"
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
                  placeholder="Type recipient name"
                  value={recipientInput}
                  onChange={e => {
                    setRecipientInput(e.target.value);
                    setShowRecipientOptions(true);
                  }}
                  onFocus={() => setShowRecipientOptions(true)}
                  onBlur={() => setTimeout(() => setShowRecipientOptions(false), 150)}
                />
                {showRecipientOptions && filteredRecipients.length > 0 && (
                  <ul className="absolute z-10 bg-white border border-gray-200 rounded-md mt-1 w-full max-h-48 overflow-auto shadow-lg">
                    {filteredRecipients.map((user, idx) => (
                      <li
                        key={user.id || idx}
                        className="px-3 py-2 cursor-pointer hover:bg-gray-100"
                        onMouseDown={() => {
                          setRecipientInput(user.userId);
                          setShowRecipientOptions(false);
                        }}
                      >
                        {user.userId} {user.accountNumber ? `(${user.accountNumber})` : ""}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
            {quote ? <Button
              onClick={handleAcceptTransaction}
              className="w-full rounded-xl text-white bg-gradient-to-r from-[#48b395] to-[#247469] hover:opacity-90"
              disabled={loading || !publicKey || (selectedCurrency === 'USDC' && usdcAmount <= 0)} // Disable if wallet not connected
            >
              {loading ? "Loading..." : "Accept Transaction"}
            </Button> : <Button
              onClick={handleGetQuote}
              className="w-full rounded-xl text-white bg-gradient-to-r from-[#48b395] to-[#247469] hover:opacity-90"
              disabled={loading || !publicKey || (selectedCurrency === 'USDC' && usdcAmount <= 0)} // Disable if wallet not connected
            >
              {loading ? "Loading..." : "Get Quote"}
            </Button>}
            {quote !== null && (
              <>
                <p className="mt-4 text-xl font-bold text-gray-600">
                  {selectedCurrency === 'USDC' ? (
                    `Quotation: COP $${quote.value.toLocaleString()}`
                  ) : (
                    `Quotation: USDC $${quote.value.toLocaleString()}`
                  )}
                </p>
                <p className="text-sm text-gray-500">
                  {selectedCurrency === 'USDC' ? (
                    `Exchange Rate: 1 USDC = COP $${(quote.value / usdcAmount).toFixed(2)}`
                  ) : (
                    `Exchange Rate: 1 USDC = COP $${(usdcAmount / quote.value).toFixed(2)}`
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
                    <th className="text-left py-3 px-4 text-sm font-medium text-gray-600">User ID</th>
                    <th className="text-left py-3 px-4 text-sm font-medium text-gray-600">Account Number</th>
                    <th className="text-left py-3 px-4 text-sm font-medium text-gray-600">Bank</th>
                    <th className="text-left py-3 px-4 text-sm font-medium text-gray-600">Status</th>
                    <th className="text-right py-3 px-4 text-sm font-medium text-gray-600">Source Amount</th>
                    <th className="text-right py-3 px-4 text-sm font-medium text-gray-600">Target Amount</th>
                    <th className="text-left py-3 px-4 text-sm font-medium text-gray-600">Payment Method</th>
                  </tr>
                </thead>
                <tbody>
                  {transactions && transactions.transactions.length > 0 ? (
                    transactions.transactions.map((tx, index) => (
                      <tr key={tx.id || index} className="border-b border-gray-100">
                        <td className="py-3 px-4 text-sm text-gray-600">
                          {tx.createdAt ? new Date(tx.createdAt).toLocaleString() : "-"}
                        </td>
                        <td className="py-3 px-4 text-sm text-gray-900">{tx.partnerUserId}</td>
                        <td className="py-3 px-4 text-sm text-gray-900">{tx.accountNumber}</td>
                        <td className="py-3 px-4 text-sm text-gray-900">{tx.bankCode}</td>
                        <td className="py-3 px-4 text-sm text-gray-900">{tx.status}</td>
                        <td className="py-3 px-4 text-sm text-gray-900 text-right">
                          {tx.quote?.sourceAmount?.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {tx.quote?.cryptoCurrency}
                        </td>
                        <td className="py-3 px-4 text-sm text-gray-900 text-right">
                          {tx.quote?.targetAmount?.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {tx.quote?.targetCurrency}
                        </td>
                        <td className="py-3 px-4 text-sm text-gray-900">{tx.quote?.paymentMethod}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={8} className="py-3 px-4 text-center text-gray-600">
                        No transactions found.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

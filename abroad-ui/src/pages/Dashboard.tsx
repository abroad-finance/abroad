import React, { useCallback, useEffect, useMemo, useState } from "react";
import Navbar from "../components/navbar";
import { getQuote, QuoteRequest, getReverseQuote, ReverseQuoteRequest, listPartnerUsers, PaginatedPartnerUsers, listPartnerTransactions, PaginatedTransactionList, QuoteResponse, } from "../api/apiClient";
import { isConnected, requestAccess, getNetworkDetails, signTransaction } from "@stellar/freighter-api"; // Import Freighter functions
import { Memo, Operation, Asset, TransactionBuilder, Transaction as StellarTransaction } from "@stellar/stellar-sdk";
import { Horizon } from "@stellar/stellar-sdk";
import { TransactionList } from "../components/TransactionList";
import { Quotation } from "../components/quotation";
import { WalletBalance } from "../components/WalletBallance";
import { acceptTransaction, AcceptTransactionRequest } from "../api";
import { FreighterGuide } from "../components/FreighterGuide";
import { Liquidity } from "../components/Liquidity";
import { Balance } from "../components/Treasury/BalanceOpsRow";

export function Dashboard() {
  const [activeSection, setActiveSection] = useState<string>("dashboard");

  return (
    <div className="min-h-screen p-4 space-y-4 bg-gray-50">
      <Navbar activeSection={activeSection} setActiveSection={setActiveSection} />
      <DashboardHome />
    </div>
  );
}

const FLAT_RATE = 1354

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
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [isFreighterAvailable, setIsFreighterAvailable] = useState(false);

  // Unify Freighter connection logic
  const checkAndRequestAccess = useCallback(async (): Promise<string | null> => {
    const freighterConnected = await isConnected();
    if (!freighterConnected.isConnected) {
      setIsFreighterAvailable(false);
      setConnectionError("Freighter extension not detected. Please install it.");
      return null;
    }
    setIsFreighterAvailable(true);
    const accessObj = await requestAccess();
    if (accessObj.error) {
      console.error("Error requesting access:", accessObj.error);
      setConnectionError(`Failed to connect: ${accessObj.error}`);
      return null;
    }
    return accessObj.address ?? null;
  }, []);


  const fetchWalletBalance = useCallback(async (address: string) => {
    if (!(await checkAndRequestAccess())) return;

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
  }, [checkAndRequestAccess]);

  // Simplified connectWallet using centralized helper
  const connectWallet = useCallback(async () => {
    setIsConnecting(true);
    setConnectionError(null);
    const address = await checkAndRequestAccess();
    if (address) {
      setPublicKey(address);
      fetchWalletBalance(address);
    }
    setIsConnecting(false);
  }, [checkAndRequestAccess, fetchWalletBalance]);

  const disconnectWallet = useCallback(async () => {
    setPublicKey(null);
    setBalance(0);
  }, []);

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
      if (await checkAndRequestAccess()) {
        connectWallet();
      }
    };
    checkFreighterConnection();
  }, [connectWallet, checkAndRequestAccess]);

  // Polling: fetch balance and transactions every 5 seconds
  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const txs = await listPartnerTransactions();
        setTransactions(txs);
        if (!publicKey) return;
        fetchWalletBalance(publicKey);
      } catch (err) {
        console.error("Failed to fetch transactions:", err);
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [publicKey, fetchWalletBalance]);

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
      if (acceptRes.status !== 200) {
        alert("Error accepting transaction: " + acceptRes.data.reason);
        return;
      }
      const memoText = acceptRes.data.transaction_reference;
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
    return (partnerUsers?.users.filter((user) =>
      user.userId.toLowerCase().includes(recipientInput.toLowerCase())
    ) || []).map(user => ({
      id: user.id,
      userId: user.userId,
      accountNumber: user.accountNumber || undefined
    }));
  }, [partnerUsers, recipientInput]);
  
  const handleSend = () => {
    // Placeholder for send functionality
    console.log("Send action triggered");
  };

  const handleReceive = () => {
    // Placeholder for receive functionality
    console.log("Receive action triggered");
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
      <Balance balance={balance} onSend={handleSend} onReceive={handleReceive} />
      <Liquidity />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
        {isFreighterAvailable ?
        <WalletBalance
            balance={balance}
            isConnecting={isConnecting}
            publicKey={publicKey}
            handleWalletConnection={handleWalletConnection}
            getWalletMessage={getWalletMessage}
          /> : <FreighterGuide />}
       <Quotation
          loading={loading}
          publicKey={publicKey}
          selectedCurrency={selectedCurrency}
          usdcAmount={usdcAmount}
          usdcInput={usdcInput}
          quote={quote}
          recipientInput={recipientInput}
          showRecipientOptions={showRecipientOptions}
          filteredRecipients={filteredRecipients}
          FLAT_RATE={FLAT_RATE}
          handleCurrencyChange={handleCurrencyChange}
          handleAmountChange={handleAmountChange}
          handleGetQuote={handleGetQuote}
          handleAcceptTransaction={handleAcceptTransaction}
          setRecipientInput={setRecipientInput}
          setShowRecipientOptions={setShowRecipientOptions}
        />
      </div>
      <TransactionList transactions={transactions} />
    </div>
  );
}
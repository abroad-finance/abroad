import { useState } from 'react';

function App() {
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('https://abroad-api-910236263183.us-east1.run.app/');
  const [isConfigured, setIsConfigured] = useState(false);

  const [transactionReference, setTransactionReference] = useState('');
  const [transactionStatus, setTransactionStatus] = useState(null);
  const [transactionError, setTransactionError] = useState<string | null>(null);

  const [quoteRequest, setQuoteRequest] = useState({
    amount: 0,
    target_currency: 'COP',
    payment_method: 'NEQUI',
    crypto_currency: 'USDC',
    network: 'STELLAR',
  });
  const [quoteResponse, setQuoteResponse] = useState(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);

  const [acceptTransactionRequest, setAcceptTransactionRequest] = useState({
    quote_id: '',
    user_id: '',
    account_number: '',
  });
  const [acceptTransactionResponse, setAcceptTransactionResponse] = useState(null);
  const [acceptTransactionError, setAcceptTransactionError] = useState<string | null>(null);

  const handleConfigure = () => {
    if (apiKey && baseUrl) {
      setIsConfigured(true);
    } else {
      alert('Please enter both API Key and Base URL.');
    }
  };

  const handleGetQuote = async () => {
    setQuoteResponse(null);
    setQuoteError(null);

    if (quoteRequest.amount <= 0) {
      setQuoteError("Amount must be greater than 0.");
      return;
    }

    try {
      const response = await fetch(`${baseUrl}quote`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': apiKey,
        },
        body: JSON.stringify(quoteRequest),
      });
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data = await response.json();
      setQuoteResponse(data);
      // Automatically populate the quote_id for the transaction request.
      // Adjust "data.id" if the quote ID is returned under a different property.
      setAcceptTransactionRequest(prev => ({ ...prev, quote_id: data.quote_id }));
    } catch (error) {
      console.error('Error fetching quote:', error);
      if (error instanceof Error) {
        setQuoteError(error.message);
      }
    }
  };

  const handleAcceptTransaction = async () => {
    setAcceptTransactionResponse(null);
    setAcceptTransactionError(null);

    if (!acceptTransactionRequest.quote_id || !acceptTransactionRequest.user_id || !acceptTransactionRequest.account_number) {
      setAcceptTransactionError("Quote ID, User ID, and Account Number are required.");
      return;
    }

    try {
      const response = await fetch(`${baseUrl}transaction`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': apiKey,
        },
        body: JSON.stringify(acceptTransactionRequest),
      });
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data = await response.json();
      setAcceptTransactionResponse(data);
      // Automatically update the transaction reference for fetching status.
      // Adjust "data.transaction_id" based on the actual response property.
      setTransactionReference(data.id);
    } catch (error) {
      console.error('Error accepting transaction:', error);
      if (error instanceof Error) {
        setAcceptTransactionError(error.message);
      }
    }
  };

  const handleGetTransactionStatus = async () => {
    setTransactionStatus(null);
    setTransactionError(null);

    if (!transactionReference) {
      setTransactionError("Transaction Reference is required.");
      return;
    }

    try {
      const response = await fetch(`${baseUrl}transaction/${transactionReference}`, {
        headers: { 'X-API-Key': apiKey },
      });
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data = await response.json();
      setTransactionStatus(data);
    } catch (error) {
      console.error('Error fetching transaction status:', error);
      if (error instanceof Error) {
        setTransactionError(error.message);
      }
    }
  };

  return (
    <div className="min-w-screen min-h-screen bg-gray-50 flex flex-col items-center justify-center p-6 text-gray-900">
      <h1 className="text-4xl font-bold text-center mb-8" style={{ fontFamily: 'Comic Sans MS' }}>
        abroad.finance
      </h1>

      {!isConfigured ? (
        <div className="bg-white shadow-md rounded px-8 py-6 mb-4 w-full max-w-md">
          <h2 className="text-2xl font-semibold mb-4">API Configuration</h2>
          <input
            type="passwrod"
            placeholder="API Key"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            className="w-full p-3 border border-gray-300 rounded mb-3 focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900"
          />
          <input
            type="text"
            placeholder="Base URL"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            className="w-full p-3 border border-gray-300 rounded mb-4 focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900"
          />
          <button
            onClick={handleConfigure}
            className="w-full bg-blue-500 text-white p-3 rounded hover:bg-blue-600 transition-colors"
          >
            Configure
          </button>
        </div>
      ) : (
        <div className="w-full max-w-md space-y-6">
          {/* Get Quote */}
          <div className="bg-white shadow-md rounded px-8 py-6">
            <h2 className="text-2xl font-semibold mb-4">Get Quote</h2>
            <input
              type="number"
              placeholder="Amount"
              value={quoteRequest.amount}
              onChange={(e) =>
                setQuoteRequest({ ...quoteRequest, amount: parseFloat(e.target.value) })
              }
              className="w-full p-3 border border-gray-300 rounded mb-4 focus:outline-none focus:ring-2 focus:ring-green-500 text-gray-900"
            />
            <button
              onClick={handleGetQuote}
              className="w-full bg-green-500 text-white p-3 rounded hover:bg-green-600 transition-colors mb-4"
            >
              Get Quote
            </button>
            {quoteResponse && (
              <pre className="text-green-600 bg-gray-100 p-3 rounded">
                {JSON.stringify(quoteResponse, null, 2)}
              </pre>
            )}
            {quoteError && <p className="text-red-600 mt-2">Error: {quoteError}</p>}
          </div>

          {/* Accept Transaction */}
          <div className="bg-white shadow-md rounded px-8 py-6">
            <h2 className="text-2xl font-semibold mb-4">Accept Transaction</h2>
            <input
              type="text"
              placeholder="Quote ID"
              value={acceptTransactionRequest.quote_id}
              onChange={(e) =>
                setAcceptTransactionRequest({ ...acceptTransactionRequest, quote_id: e.target.value })
              }
              className="w-full p-3 border border-gray-300 rounded mb-4 focus:outline-none focus:ring-2 focus:ring-purple-500 text-gray-900"
              disabled  // Optional: disable editing since it's auto-populated.
            />
            <input
              type="text"
              placeholder="User ID"
              value={acceptTransactionRequest.user_id}
              onChange={(e) =>
                setAcceptTransactionRequest({ ...acceptTransactionRequest, user_id: e.target.value })
              }
              className="w-full p-3 border border-gray-300 rounded mb-4 focus:outline-none focus:ring-2 focus:ring-purple-500 text-gray-900"
            />
            <input
              type="text"
              placeholder="Account Number"
              value={acceptTransactionRequest.account_number}
              onChange={(e) =>
                setAcceptTransactionRequest({
                  ...acceptTransactionRequest,
                  account_number: e.target.value,
                })
              }
              className="w-full p-3 border border-gray-300 rounded mb-4 focus:outline-none focus:ring-2 focus:ring-purple-500 text-gray-900"
            />
            <button
              onClick={handleAcceptTransaction}
              className="w-full bg-purple-500 text-white p-3 rounded hover:bg-purple-600 transition-colors mb-4"
            >
              Accept Transaction
            </button>
            {acceptTransactionResponse && (
              <pre className="text-green-600 bg-gray-100 p-3 rounded">
                {JSON.stringify(acceptTransactionResponse, null, 2)}
              </pre>
            )}
            {acceptTransactionError && <p className="text-red-600 mt-2">Error: {acceptTransactionError}</p>}
          </div>

          {/* Get Transaction Status */}
          <div className="bg-white shadow-md rounded px-8 py-6">
            <h2 className="text-2xl font-semibold mb-4">Get Transaction Status</h2>
            <input
              type="text"
              placeholder="Transaction Reference"
              value={transactionReference}
              onChange={(e) => setTransactionReference(e.target.value)}
              className="w-full p-3 border border-gray-300 rounded mb-4 focus:outline-none focus:ring-2 focus:ring-yellow-500 text-gray-900"
              disabled  // Optional: disable editing since it's auto-populated.
            />
            <button
              onClick={handleGetTransactionStatus}
              className="w-full bg-yellow-500 text-white p-3 rounded hover:bg-yellow-600 transition-colors mb-4"
            >
              Get Status
            </button>
            {transactionStatus && (
              <pre className="text-green-600 bg-gray-100 p-3 rounded">
                {JSON.stringify(transactionStatus, null, 2)}
              </pre>
            )}
            {transactionError && <p className="text-red-600 mt-2">Error: {transactionError}</p>}
          </div>
        </div>
      )}
    </div>
  );
}

export default App;

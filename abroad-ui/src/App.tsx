import React, { useState } from 'react';

function App() {
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('http://localhost:3784/');
  const [isConfigured, setIsConfigured] = useState(false);

  const [transactionReference, setTransactionReference] = useState('');
  const [transactionStatus, setTransactionStatus] = useState(null);
  const [transactionError, setTransactionError] = useState(null);

  const [quoteRequest, setQuoteRequest] = useState({
    amount: 0,
    target_currency: 'COP',
    payment_method: 'NEQUI',
    crypto_currency: 'USDC',
    network: 'STELLAR',
  });
  const [quoteResponse, setQuoteResponse] = useState(null);
  const [quoteError, setQuoteError] = useState(null);

  const [acceptTransactionRequest, setAcceptTransactionRequest] = useState({
    quote_id: '',
    user_id: '',
    account_number: '',
  });
  const [acceptTransactionResponse, setAcceptTransactionResponse] = useState(null);
  const [acceptTransactionError, setAcceptTransactionError] = useState(null);

  const handleConfigure = () => {
    if (apiKey && baseUrl) {
      setIsConfigured(true);
    } else {
      alert('Please enter both API Key and Base URL.');
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
      setTransactionError(error.message);
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
    } catch (error) {
      console.error('Error fetching quote:', error);
      setQuoteError(error.message);
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
    } catch (error) {
      console.error('Error accepting transaction:', error);
      setAcceptTransactionError(error.message);
    }
  };

  return (
    <div>
      <h1 style={{ fontFamily: 'Comic Sans MS', textAlign: 'center' }}>abroad.finance</h1>

      {/* API Key and Base URL Input */}
      {!isConfigured ? (
        <div>
          <h2>API Configuration</h2>
          <input
            type="text"
            placeholder="API Key"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
          />
          <input
            type="text"
            placeholder="Base URL"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
          />
          <button onClick={handleConfigure}>Configure</button>
        </div>
      ) : (
        <div>
          {/* Get Transaction Status */}
          <h2>Get Transaction Status</h2>
          <input
            type="text"
            placeholder="Transaction Reference"
            value={transactionReference}
            onChange={(e) => setTransactionReference(e.target.value)}
          />
          <button onClick={handleGetTransactionStatus}>Get Status</button>
          {transactionStatus && <pre style={{ color: 'green' }}>{JSON.stringify(transactionStatus, null, 2)}</pre>}
          {transactionError && <p style={{ color: 'red' }}>Error: {transactionError}</p>}

          {/* Get Quote */}
          <h2>Get Quote</h2>
          <input
            type="number"
            placeholder="Amount"
            value={quoteRequest.amount}
            onChange={(e) => setQuoteRequest({ ...quoteRequest, amount: parseFloat(e.target.value) })}
          />
          <button onClick={handleGetQuote}>Get Quote</button>
          {quoteResponse && <pre style={{ color: 'green' }}>{JSON.stringify(quoteResponse, null, 2)}</pre>}
          {quoteError && <p style={{ color: 'red' }}>Error: {quoteError}</p>}

          {/* Accept Transaction */}
          <h2>Accept Transaction</h2>
          <input
            type="text"
            placeholder="Quote ID"
            value={acceptTransactionRequest.quote_id}
            onChange={(e) => setAcceptTransactionRequest({ ...acceptTransactionRequest, quote_id: e.target.value })}
          />
          <input
            type="text"
            placeholder="User ID"
            value={acceptTransactionRequest.user_id}
            onChange={(e) => setAcceptTransactionRequest({ ...acceptTransactionRequest, user_id: e.target.value })}
          />
          <input
            type="text"
            placeholder="Account Number"
            value={acceptTransactionRequest.account_number}
            onChange={(e) => setAcceptTransactionRequest({ ...acceptTransactionRequest, account_number: e.target.value })}
          />
          <button onClick={handleAcceptTransaction}>Accept Transaction</button>
          {acceptTransactionResponse && <pre style={{ color: 'green' }}>{JSON.stringify(acceptTransactionResponse, null, 2)}</pre>}
          {acceptTransactionError && <p style={{ color: 'red' }}>Error: {acceptTransactionError}</p>}
        </div>
      )}
    </div>
  );
}

export default App;
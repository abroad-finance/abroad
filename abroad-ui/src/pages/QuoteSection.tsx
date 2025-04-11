import React, { useEffect, useState } from 'react';
import { fetchQuote, fetchReverseQuote } from './../services/apiService';

interface QuoteSectionProps {
  apiKey: string;
  baseUrl: string;
  onQuoteSuccess: (quoteId: string, paymentMethod: string) => void;
}

// Mode indicates the type of input:
// "receive" means the user inputs the fiat amount (COP) they want to receive,
// and "send" means the user inputs the crypto amount (USDC) they plan to send.
type InputMode = 'receive' | 'send';

const QuoteSection: React.FC<QuoteSectionProps> = ({ apiKey, baseUrl, onQuoteSuccess }) => {
  const [inputMode, setInputMode] = useState<InputMode>('receive');

  // The same field "amount" is used, but its interpretation changes based on the mode.
  // In "receive" mode, amount is in COP; in "send" mode, amount is in USDC.
  const [quoteRequest, setQuoteRequest] = useState({
    amount: 0,
    target_currency: 'COP', // fiat currency
    payment_method: 'NEQUI',
    crypto_currency: 'USDC', // crypto currency
    network: 'STELLAR',
  });
  const [quoteResponse, setQuoteResponse] = useState(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);

  useEffect(() => {
    setQuoteRequest({
      amount: 0,
      target_currency: 'COP',
      payment_method: 'NEQUI',
      crypto_currency: 'USDC',
      network: 'STELLAR',
    });
    setQuoteResponse(null);
  }, [inputMode]);

  const handleGetQuote = async () => {
    setQuoteResponse(null);
    setQuoteError(null);

    if (quoteRequest.amount <= 0) {
      setQuoteError('Amount must be greater than 0.');
      return;
    }

    try {
      let data;
      if (inputMode === 'receive') {
        // User inputs the fiat amount (COP) they want to receive.
        // Call fetchQuote (fiat-to-crypto conversion) which returns the crypto amount to send.
        data = await fetchQuote(apiKey, baseUrl, quoteRequest);
      } else {
        // inputMode === 'send'
        // User inputs the crypto amount (USDC) they want to send.
        // Call fetchReverseQuote (crypto-to-fiat conversion) which returns the fiat amount received.
        data = await fetchReverseQuote(apiKey, baseUrl, {
          source_amount: quoteRequest.amount,
          target_currency: quoteRequest.target_currency,
          payment_method: quoteRequest.payment_method,
          crypto_currency: quoteRequest.crypto_currency,
          network: quoteRequest.network,
        });
      }
      setQuoteResponse(data);
      onQuoteSuccess(data.quote_id, quoteRequest.payment_method);
    } catch (error) {
      if (!(error instanceof Error)) {
        setQuoteError('An error occurred.');
        return;
      }
      console.error('Error fetching quote:', error);
      setQuoteError(error.message || 'An error occurred.');
    }
  };

  return (
    <div className="bg-white shadow-md rounded px-8 py-6">
      <h2 className="text-2xl font-semibold mb-4">Get Quote</h2>
      <div className="mb-4">
        <label className="mr-4 font-medium flex">
          <input
            type="radio"
            name="inputMode"
            value="receive"
            checked={inputMode === 'receive'}
            onChange={() => setInputMode('receive')}
            className="mr-2"
          />
          I want to receive (COP)
        </label>
        <label className="font-medium">
          <input
            type="radio"
            name="inputMode"
            value="send"
            checked={inputMode === 'send'}
            onChange={() => setInputMode('send')}
            className="mr-2"
          />
          I want to send (USDC)
        </label>
      </div>
      <input
        type="number"
        placeholder={
          inputMode === 'receive'
            ? 'Enter amount in COP you want to receive'
            : 'Enter amount in USDC you want to send'
        }
        value={quoteRequest.amount}
        onChange={(e) =>
          setQuoteRequest({ ...quoteRequest, amount: parseFloat(e.target.value) })
        }
        className="w-full p-3 border border-gray-300 rounded mb-4 focus:outline-none focus:ring-2 focus:ring-green-500 text-gray-900"
      />
      {/* Payment Method Dropdown */}
      <div className="mb-4">
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Payment Method
        </label>
        <select
          value={quoteRequest.payment_method}
          onChange={(e) =>
            setQuoteRequest({ ...quoteRequest, payment_method: e.target.value })
          }
          className="w-full p-3 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-green-500 text-gray-900"
        >
          <option value="NEQUI">NEQUI</option>
          <option value="MOVII">MOVII</option>
        </select>
      </div>
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
  );
};

export default QuoteSection;

import React, { useState } from 'react';
import { fetchQuote } from './../services/apiService';

interface QuoteSectionProps {
  apiKey: string;
  baseUrl: string;
  onQuoteSuccess: (quoteId: string) => void;
}

const QuoteSection: React.FC<QuoteSectionProps> = ({ apiKey, baseUrl, onQuoteSuccess }) => {
  const [quoteRequest, setQuoteRequest] = useState({
    amount: 0,
    target_currency: 'COP',
    payment_method: 'NEQUI',
    crypto_currency: 'USDC',
    network: 'STELLAR',
  });
  const [quoteResponse, setQuoteResponse] = useState(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);

  const handleGetQuote = async () => {
    setQuoteResponse(null);
    setQuoteError(null);

    if (quoteRequest.amount <= 0) {
      setQuoteError('Amount must be greater than 0.');
      return;
    }

    try {
      const data = await fetchQuote(apiKey, baseUrl, quoteRequest);
      setQuoteResponse(data);
      // Assume quote ID is in data.quote_id – adjust as needed.
      onQuoteSuccess(data.quote_id);
    } catch (error) {
      console.error('Error fetching quote:', error);
      if (error instanceof Error) {
        setQuoteError(error.message);
      }
    }
  };

  return (
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
  );
};

export default QuoteSection;

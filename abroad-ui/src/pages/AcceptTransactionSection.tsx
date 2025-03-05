import React, { useState, useEffect } from 'react';
import { fetchAcceptTransaction } from './../services/apiService';

interface AcceptTransactionSectionProps {
  apiKey: string;
  baseUrl: string;
  quoteId: string;
  onTransactionAccepted: (transactionReference: string) => void;
}

const AcceptTransactionSection: React.FC<AcceptTransactionSectionProps> = ({
  apiKey,
  baseUrl,
  quoteId,
  onTransactionAccepted,
}) => {
  const [acceptTransactionRequest, setAcceptTransactionRequest] = useState({
    quote_id: quoteId,
    user_id: '',
    account_number: '',
  });
  const [acceptTransactionResponse, setAcceptTransactionResponse] = useState(null);
  const [acceptTransactionError, setAcceptTransactionError] = useState<string | null>(null);

  // Update the internal quote_id when the parent-provided quoteId changes.
  useEffect(() => {
    setAcceptTransactionRequest(prev => ({
      ...prev,
      quote_id: quoteId,
    }));
  }, [quoteId]);

  const handleAcceptTransaction = async () => {
    setAcceptTransactionResponse(null);
    setAcceptTransactionError(null);

    if (
      !acceptTransactionRequest.quote_id ||
      !acceptTransactionRequest.user_id ||
      !acceptTransactionRequest.account_number
    ) {
      setAcceptTransactionError('Quote ID, User ID, and Account Number are required.');
      return;
    }

    try {
      const data = await fetchAcceptTransaction(apiKey, baseUrl, acceptTransactionRequest);
      setAcceptTransactionResponse(data);
      // Assume transaction reference is returned as data.id – adjust as needed.
      onTransactionAccepted(data.id);
    } catch (error) {
      console.error('Error accepting transaction:', error);
      if (error instanceof Error) {
        setAcceptTransactionError(error.message);
      }
    }
  };

  return (
    <div className="bg-white shadow-md rounded px-8 py-6">
      <h2 className="text-2xl font-semibold mb-4">Accept Transaction</h2>
      <input
        type="text"
        placeholder="Quote ID"
        value={acceptTransactionRequest.quote_id}
        onChange={(e) =>
          setAcceptTransactionRequest({
            ...acceptTransactionRequest,
            quote_id: e.target.value,
          })
        }
        className="w-full p-3 border border-gray-300 rounded mb-4 focus:outline-none focus:ring-2 focus:ring-purple-500 text-gray-900"
        disabled // This field is auto-populated.
      />
      <input
        type="text"
        placeholder="User ID"
        value={acceptTransactionRequest.user_id}
        onChange={(e) =>
          setAcceptTransactionRequest({
            ...acceptTransactionRequest,
            user_id: e.target.value,
          })
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
  );
};

export default AcceptTransactionSection;

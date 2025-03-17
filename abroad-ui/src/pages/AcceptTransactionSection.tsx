import React, { useState, useEffect } from 'react';
import { fetchAcceptTransaction } from './../services/apiService';

const banks = [
  { bankCode: "1507", bankName: 'NEQUI' },
  { bankCode: "7095", bankName: 'Banco Rojo' },
];

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
    bank_code: banks[0].bankCode,
  });
  const [acceptTransactionResponse, setAcceptTransactionResponse] = useState(null);
  const [acceptTransactionError, setAcceptTransactionError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [transactionCreated, setTransactionCreated] = useState(false);

  // Reset the request and transactionCreated state when the quoteId changes.
  useEffect(() => {
    setAcceptTransactionRequest({
      quote_id: quoteId,
      user_id: '',
      account_number: '',
      bank_code: banks[0].bankCode,
    });
    setTransactionCreated(false);
  }, [quoteId]);

  const handleAcceptTransaction = async () => {
    // Prevent creating the transaction if one has already been created.
    if (transactionCreated) return;

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

    setIsLoading(true);
    try {
      const data = await fetchAcceptTransaction(apiKey, baseUrl, acceptTransactionRequest);
      setAcceptTransactionResponse(data);
      onTransactionAccepted(data.id);
      setTransactionCreated(true); // Mark as created so no further transactions can be made.
    } catch (error) {
      console.error('Error accepting transaction:', error);
      if (error instanceof Error) {
        setAcceptTransactionError(error.message);
      }
    } finally {
      setIsLoading(false);
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
      {/* Bank Dropdown */}
      <div className="mb-4">
        <label className="block text-sm font-medium text-gray-700 mb-1">Bank</label>
        <select
          value={acceptTransactionRequest.bank_code}
          onChange={(e) =>
            setAcceptTransactionRequest({
              ...acceptTransactionRequest,
              bank_code: e.target.value,
            })
          }
          className="w-full p-3 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-purple-500 text-gray-900"
        >
          {banks.map((bank) => (
            <option key={bank.bankCode} value={bank.bankCode}>
              {bank.bankName}
            </option>
          ))}
        </select>
      </div>
      <button
        onClick={handleAcceptTransaction}
        disabled={isLoading || transactionCreated}
        className="w-full bg-purple-500 text-white p-3 rounded hover:bg-purple-600 transition-colors mb-4"
      >
        {isLoading ? 'Processing...' : transactionCreated ? 'Transaction Accepted' : 'Accept Transaction'}
      </button>
      {/* Optional: Additional loading spinner */}
      {isLoading && (
        <div className="flex justify-center mb-4">
          <div className="loader"></div>
        </div>
      )}
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

import React, { useState, useEffect } from 'react';
import { fetchAcceptTransaction, fetchBanks } from './../services/apiService';

// Define bank interface
interface Bank {
  bankCode: number | string;
  bankName: string;
}

interface AcceptTransactionSectionProps {
  apiKey: string;
  baseUrl: string;
  quoteId: string;
  paymentMethod: string;
  onTransactionAccepted: (transactionReference: string) => void;
}

const AcceptTransactionSection: React.FC<AcceptTransactionSectionProps> = ({
  apiKey,
  baseUrl,
  quoteId,
  paymentMethod,
  onTransactionAccepted,
}) => {
  const [acceptTransactionRequest, setAcceptTransactionRequest] = useState({
    quote_id: quoteId,
    user_id: '',
    account_number: '',
    bank_code: '',
  });
  const [acceptTransactionResponse, setAcceptTransactionResponse] = useState(null);
  const [acceptTransactionError, setAcceptTransactionError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [transactionCreated, setTransactionCreated] = useState(false);
  const [banks, setBanks] = useState<Bank[]>([]);
  const [loadingBanks, setLoadingBanks] = useState(false);
  const [banksError, setBanksError] = useState<string | null>(null);

  // Fetch banks from the API when component mounts or payment method changes
  useEffect(() => {
    const getBanks = async () => {
      if (!paymentMethod) return;
      
      setLoadingBanks(true);
      setBanksError(null);
      try {
        const response = await fetchBanks(apiKey, baseUrl, paymentMethod);
        setBanks(response.banks);
        // Set default bank code if banks are available
        if (response.banks.length > 0) {
          setAcceptTransactionRequest(prev => ({
            ...prev,
            bank_code: response.banks[0].bankCode.toString(),
          }));
        } else {
          // Clear bank code if no banks are available
          setAcceptTransactionRequest(prev => ({
            ...prev,
            bank_code: '',
          }));
        }
      } catch (error) {
        console.error('Error fetching banks:', error);
        if (error instanceof Error) {
          setBanksError(error.message);
        }
        // Clear banks on error
        setBanks([]);
        setAcceptTransactionRequest(prev => ({
          ...prev,
          bank_code: '',
        }));
      } finally {
        setLoadingBanks(false);
      }
    };

    getBanks();
  }, [apiKey, baseUrl, paymentMethod]);

  // Reset the request and transactionCreated state when the quoteId changes.
  useEffect(() => {
    setAcceptTransactionRequest(prev => ({
      ...prev,
      quote_id: quoteId,
      user_id: '',
      account_number: '',
    }));
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
      !acceptTransactionRequest.account_number ||
      !acceptTransactionRequest.bank_code
    ) {
      setAcceptTransactionError('Quote ID, User ID, Account Number, and Bank are required.');
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
      <div className="mb-4">
        <p className="text-sm text-gray-500">Payment Method: <span className="font-semibold">{paymentMethod}</span></p>
      </div>
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
        {loadingBanks ? (
          <div className="flex items-center space-x-2">
            <span className="text-sm text-gray-500">Loading banks...</span>
            <div className="loader-sm"></div>
          </div>
        ) : banksError ? (
          <p className="text-red-500 text-sm">{banksError}</p>
        ) : (
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
            {banks.length === 0 ? (
              <option value="">No banks available</option>
            ) : (
              banks.map((bank) => (
                <option key={bank.bankCode} value={bank.bankCode.toString()}>
                  {bank.bankName}
                </option>
              ))
            )}
          </select>
        )}
      </div>
      <button
        onClick={handleAcceptTransaction}
        disabled={isLoading || transactionCreated || banks.length === 0}
        className="w-full bg-purple-500 text-white p-3 rounded hover:bg-purple-600 transition-colors mb-4 disabled:bg-gray-300 disabled:cursor-not-allowed"
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

import React, { useState } from 'react';
import { fetchTransactionStatus } from './../services/apiService';

interface TransactionStatusSectionProps {
    apiKey: string;
    baseUrl: string;
    transactionReference: string;
}

const TransactionStatusSection: React.FC<TransactionStatusSectionProps> = ({
    apiKey,
    baseUrl,
    transactionReference,
}) => {
    const [transactionStatus, setTransactionStatus] = useState(null);
    const [transactionError, setTransactionError] = useState<string | null>(null);

    const handleGetTransactionStatus = async () => {
        setTransactionStatus(null);
        setTransactionError(null);

        if (!transactionReference) {
            setTransactionError('Transaction Reference is required.');
            return;
        }

        try {
            const data = await fetchTransactionStatus(apiKey, baseUrl, transactionReference);
            setTransactionStatus(data);
        } catch (error) {
            console.error('Error fetching transaction status:', error);
            if (error instanceof Error) {
                setTransactionError(error.message);
            }
        }
    };

    return (
        <div className="bg-white shadow-md rounded px-8 py-6">
            <h2 className="text-2xl font-semibold mb-4">Get Transaction Status</h2>
            <input
                type="text"
                placeholder="Transaction Reference"
                value={transactionReference}
                readOnly
                className="w-full p-3 border border-gray-300 rounded mb-4 focus:outline-none focus:ring-2 focus:ring-yellow-500 text-gray-900"
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
    );
};

export default TransactionStatusSection;

import React, { useState } from 'react';
import { paymentsOnboard } from './../services/apiService';

interface PaymentsOnboardSectionProps {
    apiKey: string;
    baseUrl: string;
}

const PaymentsOnboardSection: React.FC<PaymentsOnboardSectionProps> = ({
    apiKey,
    baseUrl,
}) => {
    const [account, setAccount] = useState('');
    const [onboardResponse, setOnboardResponse] = useState(null);
    const [onboardError, setOnboardError] = useState<string | null>(null);

    const handleOnboardUser = async () => {
        setOnboardResponse(null);
        setOnboardError(null);

        if (!account) {
            setOnboardError('Account is required.');
            return;
        }

        try {
            // Call paymentsOnboard with the account provided.
            const data = await paymentsOnboard(apiKey, baseUrl, { account });
            setOnboardResponse(data);
        } catch (error) {
            console.error('Error onboarding user:', error);
            if (error instanceof Error) {
                setOnboardError(error.message);
            }
        }
    };

    return (
        <div className="bg-white shadow-md rounded px-8 py-6">
            <h2 className="text-2xl font-semibold mb-4">Onboard User</h2>
            <input
                type="text"
                placeholder="Account"
                value={account}
                onChange={(e) => setAccount(e.target.value)}
                className="w-full p-3 border border-gray-300 rounded mb-4 focus:outline-none focus:ring-2 focus:ring-yellow-500 text-gray-900"
            />
            <button
                onClick={handleOnboardUser}
                className="w-full bg-blue-500 text-white p-3 rounded hover:bg-yellow-600 transition-colors mb-4"
            >
                Onboard
            </button>
            {onboardResponse && (
                <pre className="text-green-600 bg-gray-100 p-3 rounded">
                    {JSON.stringify(onboardResponse, null, 2)}
                </pre>
            )}
            {onboardError && <p className="text-red-600 mt-2">Error: {onboardError}</p>}
        </div>
    );
};

export default PaymentsOnboardSection;

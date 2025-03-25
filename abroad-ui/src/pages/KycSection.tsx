import React, { useState } from 'react';
import { initiateKYC } from './../services/apiService';

interface KYCSectionProps {
    apiKey: string;
    baseUrl: string;
}

const KYCSection: React.FC<KYCSectionProps> = ({ apiKey, baseUrl }) => {
    const [userId, setUserId] = useState('');
    const [kycResponse, setKycResponse] = useState(null);
    const [kycError, setKycError] = useState<string | null>(null);

    const handleInitiateKYC = async () => {
        setKycResponse(null);
        setKycError(null);

        if (!userId) {
            setKycError('User ID is required.');
            return;
        }

        try {
            const data = await initiateKYC(apiKey, baseUrl, { user_id: userId });
            setKycResponse(data);
        } catch (error) {
            console.error('Error initiating KYC:', error);
            if (error instanceof Error) {
                setKycError(error.message);
            }
        }
    };

    return (
        <div className="bg-white shadow-md rounded px-8 py-6">
            <h2 className="text-2xl font-semibold mb-4">Initiate KYC</h2>
            <input
                type="text"
                placeholder="User ID"
                value={userId}
                onChange={(e) => setUserId(e.target.value)}
                className="w-full p-3 border border-gray-300 rounded mb-4 focus:outline-none focus:ring-2 focus:ring-yellow-500 text-gray-900"
            />
            <button
                onClick={handleInitiateKYC}
                className="w-full bg-blue-500 text-white p-3 rounded hover:bg-yellow-600 transition-colors mb-4"
            >
                Initiate KYC
            </button>
            {kycResponse && (
                <pre className="text-green-600 bg-gray-100 p-3 rounded">
                    {JSON.stringify(kycResponse, null, 2)}
                </pre>
            )}
            {kycError && <p className="text-red-600 mt-2">Error: {kycError}</p>}
        </div>
    );
};

export default KYCSection;

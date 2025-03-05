import React from 'react';

interface ApiConfigurationProps {
  apiKey: string;
  baseUrl: string;
  setApiKey: (key: string) => void;
  setBaseUrl: (url: string) => void;
  onConfigure: () => void;
}

const ApiConfiguration: React.FC<ApiConfigurationProps> = ({
  apiKey,
  baseUrl,
  setApiKey,
  setBaseUrl,
  onConfigure,
}) => {
  const handleConfigure = () => {
    if (apiKey && baseUrl) {
      onConfigure();
    } else {
      alert('Please enter both API Key and Base URL.');
    }
  };

  return (
    <div className="bg-white shadow-md rounded px-8 py-6 mb-4 w-full max-w-md">
      <h2 className="text-2xl font-semibold mb-4">API Configuration</h2>
      <input
        type="password"
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
  );
};

export default ApiConfiguration;

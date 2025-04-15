import React from "react";
import { Card, CardContent } from "../components/card";
import Navbar from "../components/navbar";

export default function Integrations() {
  const apiKey = "eU1lcsWwmMMzB3wHC2f08rzgg6bUXpn21Tqfgvkxx8cVgfTLQoUbzFZQAJdZw42LiQHsAJ20h2PRbnQSeYG0p1KV1HbBu0sjzLWhZmUpdskVMJGB2dIAasIB8CIGY5f1";

  const copyApiKey = () => {
    navigator.clipboard.writeText(apiKey);
  };

  return (
    <div className="min-h-screen p-4 bg-gray-50">
      <Navbar />
      <div className="space-y-4 relative">
        <div className="mt-16">
          <Card className="rounded-xl w-full border-0 shadow-lg bg-gray-50">
            <CardContent className="space-y-4">
              <h3 className="text-xl font-semibold">API Integration</h3>
              <p className="text-sm text-gray-600">
                This is the API key to use on your technical integrations.
              </p>
              <div className="p-4 bg-gray-50 rounded-lg break-all flex justify-between items-center">
                <p className="font-mono font-bold text-sm">{apiKey}</p>
                <button
                  onClick={copyApiKey}
                  className="ml-4 px-3 py-1 text-sm bg-gray-200 hover:bg-gray-300 rounded"
                >
                  Copy
                </button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

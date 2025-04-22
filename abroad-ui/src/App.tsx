import { BrowserRouter as Router, Route, Routes } from "react-router-dom";
import BusinessDashboardLogin from "./pages/BusinessDashboardLogin";
import { useState } from 'react';
import { Dashboard } from "./pages/Dashboard";
import Recipients from "./pages/Recipients";
import Integrations from "./pages/Integrations";

function App() {
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('https://abroad-api-910236263183.us-east1.run.app/');
  const [isConfigured, setIsConfigured] = useState(false);
  const [transactionReference, setTransactionReference] = useState('');
  const [quoteId, setQuoteId] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('MOVII');

  // When a quote is fetched successfully, store the quote ID.
  const handleQuoteSuccess = (quoteId: string, selectedPaymentMethod: string) => {
    setQuoteId(quoteId);
    setPaymentMethod(selectedPaymentMethod);
  };

  const handleTransactionAccepted = (transactionRef: string) => {
    setTransactionReference(transactionRef);
  };

  return (

    <Router>
      <Routes>
        <Route path="/" element={<BusinessDashboardLogin />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/recipients" element={<Recipients />} />
        <Route path="/integrations" element={<Integrations />} />
        {/* Add other routes here if needed */}
      </Routes>
    </Router>
  );
}

export default App;

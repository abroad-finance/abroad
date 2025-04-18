import { useState } from 'react';
import ApiConfiguration from './pages/ApiConfiguration';
import QuoteSection from './pages/QuoteSection';
import AcceptTransactionSection from './pages/AcceptTransactionSection';
import TransactionStatusSection from './pages/TransactionStatusSection';
import PaymentsOnboardSection from './pages/PaymentsOnboard';
import KYCSection from './pages/KycSection';

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
    <div className="min-w-screen min-h-screen bg-gray-50 flex flex-col items-center justify-center p-6 text-gray-900">
      <h1 className="text-4xl font-bold text-center mb-8" style={{ fontFamily: 'Comic Sans MS' }}>
        abroad.finance
      </h1>
      {isConfigured ? (
        <div className='m-8'>
          <p>Stellar wallet address: GCLMP4CYNFN62DDKPRMFWU4FQZFJBUL4CPTJ3JAGIHM72UNB6IX5HUGK<b></b></p>
        </div>) : null}
      {!isConfigured ? (
        <ApiConfiguration
          apiKey={apiKey}
          baseUrl={baseUrl}
          setApiKey={setApiKey}
          setBaseUrl={setBaseUrl}
          onConfigure={() => setIsConfigured(true)}
        />
      ) : (
        <div className="w-full w-xl space-y-6">
          <QuoteSection apiKey={apiKey} baseUrl={baseUrl} onQuoteSuccess={handleQuoteSuccess} />
          <AcceptTransactionSection
            apiKey={apiKey}
            baseUrl={baseUrl}
            quoteId={quoteId}
            paymentMethod={paymentMethod}
            onTransactionAccepted={handleTransactionAccepted}
          />
          <TransactionStatusSection
            apiKey={apiKey}
            baseUrl={baseUrl}
            transactionReference={transactionReference}
          />
          <PaymentsOnboardSection apiKey={apiKey} baseUrl={baseUrl} />
          <KYCSection apiKey={apiKey} baseUrl={baseUrl} />
        </div>
      )}
    </div>
  );
}

export default App;

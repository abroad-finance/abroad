import { BrowserRouter as Router, Route, Routes } from "react-router-dom";
import { Suspense, lazy } from 'react';
import { LanguageProvider } from './contexts/LanguageContext';
import { WalletAuthProvider } from './context/WalletAuthContext';

// Route-level code splitting
const WebSwap = lazy(() => import('./pages/WebSwap/WebSwap'));


function App() {  
  return (
      <LanguageProvider>
        <WalletAuthProvider>
          <Router>
            <Suspense fallback={<div />}> {/* simple lightweight fallback */}
              <Routes>
                <Route path="/" element={<WebSwap />} />
              </Routes>
            </Suspense>
          </Router>
        </WalletAuthProvider>
      </LanguageProvider>
  );
}

export default App;

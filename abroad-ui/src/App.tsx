import { BrowserRouter as Router, Route, Routes } from "react-router-dom";
import { Suspense, lazy } from 'react';
import ProtectedRoute from "./components/ProtectedRoute"; // Route guard
import { LanguageProvider } from './contexts/LanguageContext';
import { WalletAuthProvider } from './context/WalletAuthContext';

// Route-level code splitting
const WebSwap = lazy(() => import('./pages/WebSwap/WebSwap'));
const Dashboard = lazy(() => import('./pages/Dashboard').then(m => ({ default: m.Dashboard })));
const Recipients = lazy(() => import('./pages/Recipients'));
const Integrations = lazy(() => import('./pages/Integrations'));
const Settings = lazy(() => import('./pages/Settings').then(m => ({ default: m.Settings })));
const Pool = lazy(() => import('./pages/Pool'));


function App() {  
  return (
      <LanguageProvider>
        <WalletAuthProvider>
          <Router>
            <Suspense fallback={<div />}> {/* simple lightweight fallback */}
              <Routes>
                <Route path="/" element={<WebSwap />} />
                {/* Protected routes */}
                <Route element={<ProtectedRoute />}>
                  <Route path="/dashboard" element={<Dashboard />} />
                  <Route path="/pool" element={<Pool />} />
                  <Route path="/recipients" element={<Recipients />} />
                  <Route path="/integrations" element={<Integrations />} />
                  <Route path="/settings" element={<Settings />} />
                </Route>
                {/* Public alias */}
                <Route path="/web-swap" element={<WebSwap />} />
              </Routes>
            </Suspense>
          </Router>
        </WalletAuthProvider>
      </LanguageProvider>
  );
}

export default App;

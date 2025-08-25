import { lazy, Suspense } from 'react'
import { Route, BrowserRouter as Router, Routes } from 'react-router-dom'

import { LanguageProvider } from './contexts/LanguageContext'
import { WalletAuthProvider } from './contexts/WalletAuthContext'

// Route-level code splitting
const WebSwap = lazy(() => import('./pages/WebSwap/WebSwap'))

function App() {
  return (
    <LanguageProvider>
      <WalletAuthProvider>
        <Router>
          <Suspense fallback={<div />}>
            {' '}
            {/* simple lightweight fallback */}
            <Routes>
              <Route element={<WebSwap />} path="/" />
            </Routes>
          </Suspense>
        </Router>
      </WalletAuthProvider>
    </LanguageProvider>
  )
}

export default App

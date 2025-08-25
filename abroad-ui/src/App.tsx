import { TolgeeProvider } from '@tolgee/react'
import { lazy, Suspense } from 'react'
import { Route, BrowserRouter as Router, Routes } from 'react-router-dom'

import { tolgee } from './contexts/LanguageContext'
import { WalletAuthProvider } from './contexts/WalletAuthContext'

// Route-level code splitting
const WebSwap = lazy(() => import('./pages/WebSwap/WebSwap'))

function App() {
  return (
    <TolgeeProvider tolgee={tolgee}>
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
    </TolgeeProvider>
  )
}

export default App

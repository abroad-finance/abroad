import { TolgeeProvider } from '@tolgee/react'
import { lazy, Suspense } from 'react'
import { Route, BrowserRouter as Router, Routes } from 'react-router-dom'

import { tolgee } from './contexts/LanguageContext'
import { WalletAuthProvider } from './contexts/WalletAuthProvider'
import { WebSocketProvider } from './contexts/WebSocketContext'
import HiddenLogViewer from './shared/components/HiddenLogViewer'

// Route-level code splitting
const WebSwap = lazy(() => import('./pages/WebSwap/WebSwap'))
const Meridian = lazy(() => import('./pages/Meridian/Meridian'))
const Onboarding = lazy(() => import('./pages/Kyb/Onboarding'))

function App() {
  return (
    <TolgeeProvider tolgee={tolgee}>
      <WalletAuthProvider>
        <WebSocketProvider>
          <Router>
            <Suspense fallback={<div />}>
              {' '}
              {/* simple lightweight fallback */}
              <Routes>
                <Route element={<WebSwap />} path="/" />
                <Route element={<Meridian />} path="/meridian" />
                <Route element={<Onboarding />} path="/onboarding" />
              </Routes>
            </Suspense>
          </Router>
        </WebSocketProvider>
        <HiddenLogViewer />
      </WalletAuthProvider>
    </TolgeeProvider>
  )
}

export default App

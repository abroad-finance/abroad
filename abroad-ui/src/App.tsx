import { TolgeeProvider } from '@tolgee/react'
import { lazy, Suspense } from 'react'
import { Route, BrowserRouter as Router, Routes } from 'react-router-dom'

import { tolgee } from './contexts/LanguageContext'
import { NoticeProvider } from './contexts/NoticeContext'
import { WalletAuthProvider } from './contexts/WalletAuthProvider'
import { WebSocketProvider } from './contexts/WebSocketContext'
import HiddenLogViewer from './shared/components/HiddenLogViewer'

// Route-level code splitting
const WebSwap = lazy(() => import('./pages/WebSwap/WebSwap'))
const Meridian = lazy(() => import('./pages/Meridian/Meridian'))
const FlowOpsList = lazy(() => import('./pages/Ops/FlowOpsList'))
const FlowOpsDetail = lazy(() => import('./pages/Ops/FlowOpsDetail'))
const FlowDefinitions = lazy(() => import('./pages/Ops/FlowDefinitions'))
const CryptoAssets = lazy(() => import('./pages/Ops/CryptoAssets'))
const PartnerApiKeys = lazy(() => import('./pages/Ops/PartnerApiKeys'))
const TransactionReconcile = lazy(() => import('./pages/Ops/TransactionReconcile'))

function App() {
  return (
    <TolgeeProvider tolgee={tolgee}>
      <NoticeProvider>
        <WalletAuthProvider>
          <WebSocketProvider>
            <Router>
              <Suspense fallback={<div />}>
                {' '}
                {/* simple lightweight fallback */}
                <Routes>
                  <Route element={<WebSwap />} path="/" />
                  <Route element={<Meridian />} path="/meridian" />
                  <Route element={<FlowOpsList />} path="/ops/flows" />
                  <Route element={<FlowOpsDetail />} path="/ops/flows/:flowInstanceId" />
                  <Route element={<FlowDefinitions />} path="/ops/flows/definitions" />
                  <Route element={<CryptoAssets />} path="/ops/crypto-assets" />
                  <Route element={<PartnerApiKeys />} path="/ops/partners" />
                  <Route element={<TransactionReconcile />} path="/ops/transactions/reconcile" />
                </Routes>
              </Suspense>
            </Router>
          </WebSocketProvider>
          <HiddenLogViewer />
        </WalletAuthProvider>
      </NoticeProvider>
    </TolgeeProvider>
  )
}

export default App

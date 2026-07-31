import { lazy, Suspense } from 'react'
import {
  Navigate, Route, BrowserRouter as Router, Routes,
} from 'react-router-dom'

// Route-level code splitting
const ProductApplicationShell = lazy(() => import('./ProductApplicationShell'))
const TransparencyDashboard = lazy(() => import('./pages/Transparency/TransparencyDashboard'))
const WebSwap = lazy(() => import('./pages/WebSwap/WebSwap'))
const Meridian = lazy(() => import('./pages/Meridian/Meridian'))
const FlowOpsList = lazy(() => import('./pages/Ops/FlowOpsList'))
const FlowOpsDetail = lazy(() => import('./pages/Ops/FlowOpsDetail'))
const FlowDefinitions = lazy(() => import('./pages/Ops/FlowDefinitions'))
const CryptoAssets = lazy(() => import('./pages/Ops/CryptoAssets'))
const PartnerApiKeys = lazy(() => import('./pages/Ops/PartnerApiKeys'))
const KycSubmissions = lazy(() => import('./pages/Ops/KycSubmissions'))
const TransactionReconcile = lazy(() => import('./pages/Ops/TransactionReconcile'))
const TransactionsList = lazy(() => import('./pages/Ops/TransactionsList'))
const TransactionDetail = lazy(() => import('./pages/Ops/TransactionDetail'))
const BridgeOps = lazy(() => import('./pages/Ops/BridgeOps'))
const TreasuryDashboard = lazy(() => import('./pages/Ops/TreasuryDashboard'))
const PartnerPortalShell = lazy(() => import('./pages/PartnerPortal/PartnerPortalShell'))
const PartnerTransactions = lazy(() => import('./pages/PartnerPortal/PartnerTransactions'))
const PartnerTransactionDetail = lazy(() => import('./pages/PartnerPortal/PartnerTransactionDetail'))

function App() {
  return (
    <Router>
      <Suspense fallback={<div aria-label="Loading page" className="min-h-screen bg-[#F5F8F6]" role="status" />}>
        <Routes>
          <Route element={<TransparencyDashboard />} path="/transparency" />
          <Route element={<PartnerPortalShell />}>
            <Route element={<Navigate replace to="/partner/transactions" />} path="/partner" />
            <Route element={<PartnerTransactions />} path="/partner/transactions" />
            <Route element={<PartnerTransactionDetail />} path="/partner/transactions/:transactionId" />
          </Route>
          <Route element={<ProductApplicationShell />}>
            <Route element={<WebSwap />} path="/" />
            <Route element={<Meridian />} path="/meridian" />
            <Route element={<FlowOpsList />} path="/ops/flows" />
            <Route element={<FlowOpsDetail />} path="/ops/flows/:flowInstanceId" />
            <Route element={<FlowDefinitions />} path="/ops/flows/definitions" />
            <Route element={<CryptoAssets />} path="/ops/crypto-assets" />
            <Route element={<PartnerApiKeys />} path="/ops/partners" />
            <Route element={<KycSubmissions />} path="/ops/kyc" />
            <Route element={<TreasuryDashboard />} path="/ops/treasury" />
            <Route element={<BridgeOps />} path="/ops/treasury/bridge" />
            <Route element={<TransactionsList />} path="/ops/transactions" />
            <Route element={<TransactionReconcile />} path="/ops/transactions/reconcile" />
            <Route element={<TransactionDetail />} path="/ops/transactions/:transactionId" />
          </Route>
        </Routes>
      </Suspense>
    </Router>
  )
}

export default App

import { lazy, Suspense } from 'react'
import {
  Navigate, Route, BrowserRouter as Router, Routes,
} from 'react-router-dom'

import { OpsMutationProvider } from './pages/Ops/shared/OpsMutationProvider'
import { OpsShellStatusProvider } from './pages/Ops/shared/OpsShellStatusContext'

// Route-level code splitting
const ProductApplicationShell = lazy(() => import('./ProductApplicationShell'))
const TransparencyDashboard = lazy(() => import('./pages/Transparency/TransparencyDashboard'))
const WebSwap = lazy(() => import('./pages/WebSwap/WebSwap'))
const ActivityListPage = lazy(() => import('./pages/Activity/ActivityListPage'))
const ActivityDetailPage = lazy(() => import('./pages/Activity/ActivityDetailPage'))
const Meridian = lazy(() => import('./pages/Meridian/Meridian'))
const OpsControlTower = lazy(() => import('./pages/Ops/OpsControlTower'))
const BusinessPerformance = lazy(() => import('./pages/Ops/BusinessPerformance'))
const FlowOpsList = lazy(() => import('./pages/Ops/FlowOpsList'))
const FlowOpsDetail = lazy(() => import('./pages/Ops/FlowOpsDetail'))
const FlowDefinitions = lazy(() => import('./pages/Ops/FlowDefinitions'))
const CryptoAssets = lazy(() => import('./pages/Ops/CryptoAssets'))
const PartnerApiKeys = lazy(() => import('./pages/Ops/PartnerApiKeys'))
const OpsPartners = lazy(() => import('./pages/Ops/OpsPartners'))
const OpsPartnerScorecard = lazy(() => import('./pages/Ops/OpsPartnerScorecard'))
const KycSubmissions = lazy(() => import('./pages/Ops/KycSubmissions'))
const TransactionReconcile = lazy(() => import('./pages/Ops/TransactionReconcile'))
const TransactionsList = lazy(() => import('./pages/Ops/TransactionsList'))
const TransactionDetail = lazy(() => import('./pages/Ops/TransactionDetail'))
const BridgeOps = lazy(() => import('./pages/Ops/BridgeOps'))
const TreasuryDashboard = lazy(() => import('./pages/Ops/TreasuryDashboard'))
const OpsAuditLog = lazy(() => import('./pages/Ops/OpsAuditLog'))
const OpsConfigurationHistory = lazy(() => import('./pages/Ops/OpsConfigurationHistory'))
const OpsUsers = lazy(() => import('./pages/Ops/OpsUsers'))
const OpsGlobalSearch = lazy(() => import('./pages/Ops/OpsGlobalSearch'))
const OpsIncidents = lazy(() => import('./pages/Ops/OpsIncidents'))
const OpsIncidentDetail = lazy(() => import('./pages/Ops/OpsIncidentDetail'))
const OpsShiftHandoff = lazy(() => import('./pages/Ops/OpsShiftHandoff'))
const OpsIntegrations = lazy(() => import('./pages/Ops/OpsIntegrations'))
const OpsBridgeBatchDetail = lazy(() => import('./pages/Ops/OpsBridgeBatchDetail'))
const PartnerPortalShell = lazy(() => import('./pages/PartnerPortal/PartnerPortalShell'))
const PartnerPortalIntegration = lazy(() => import('./pages/PartnerPortal/PartnerPortalIntegration'))
const PartnerAiAuthorization = lazy(() => import('./pages/PartnerPortal/PartnerAiAuthorization'))
const PartnerAiIntegration = lazy(() => import('./pages/PartnerPortal/PartnerAiIntegration'))
const PartnerPortalEmailVerification = lazy(() => import('./pages/PartnerPortal/PartnerPortalEmailVerification'))
const PartnerPortalReconciliation = lazy(() => import('./pages/PartnerPortal/PartnerPortalReconciliation'))
const PartnerPortalSignIn = lazy(() => import('./pages/PartnerPortal/PartnerPortalSignIn'))
const PartnerPortalSignup = lazy(() => import('./pages/PartnerPortal/PartnerPortalSignup'))
const PartnerPortalTeamSecurity = lazy(() => import('./pages/PartnerPortal/PartnerPortalTeamSecurity'))
const PartnerTransactions = lazy(() => import('./pages/PartnerPortal/PartnerTransactions'))
const PartnerTransactionDetail = lazy(() => import('./pages/PartnerPortal/PartnerTransactionDetail'))

function App() {
  return (
    <Router>
      <OpsMutationProvider>
        <OpsShellStatusProvider>
          <Suspense fallback={<div aria-label="Loading page" className="min-h-screen bg-[#F5F8F6]" role="status" />}>
            <Routes>
              <Route element={<TransparencyDashboard />} path="/transparency" />
              <Route element={<PartnerPortalSignIn />} path="/partner/password-reset" />
              <Route element={<PartnerPortalSignup />} path="/partner/signup" />
              <Route element={<PartnerPortalEmailVerification />} path="/partner/verify-email" />
              <Route element={<PartnerPortalShell />}>
                <Route element={<Navigate replace to="/partner/transactions" />} path="/partner" />
                <Route element={<PartnerPortalIntegration />} path="/partner/integration" />
                <Route element={<PartnerAiIntegration />} path="/partner/integration/ai" />
                <Route element={<PartnerAiAuthorization />} path="/partner/integration/ai/authorize" />
                <Route element={<PartnerPortalReconciliation />} path="/partner/reconciliation" />
                <Route element={<PartnerPortalTeamSecurity />} path="/partner/security" />
                <Route element={<PartnerTransactions />} path="/partner/transactions" />
                <Route element={<PartnerTransactionDetail />} path="/partner/transactions/:transactionId" />
              </Route>
              <Route element={<ProductApplicationShell />}>
                <Route element={<WebSwap />} path="/" />
                <Route element={<ActivityListPage />} path="/activity" />
                <Route element={<ActivityDetailPage />} path="/activity/:transactionId" />
                <Route element={<Meridian />} path="/meridian" />
                <Route element={<OpsControlTower />} path="/ops" />
                <Route element={<BusinessPerformance />} path="/ops/business-performance" />
                <Route element={<OpsGlobalSearch />} path="/ops/search" />
                <Route element={<OpsIncidents />} path="/ops/incidents" />
                <Route element={<OpsShiftHandoff />} path="/ops/incidents/handoff" />
                <Route element={<OpsIncidentDetail />} path="/ops/incidents/:incidentId" />
                <Route element={<FlowOpsList />} path="/ops/flows" />
                <Route element={<FlowOpsDetail />} path="/ops/flows/:flowInstanceId" />
                <Route element={<FlowDefinitions />} path="/ops/flows/definitions" />
                <Route element={<FlowDefinitions />} path="/ops/configuration/corridors" />
                <Route element={<CryptoAssets />} path="/ops/crypto-assets" />
                <Route element={<CryptoAssets />} path="/ops/configuration/assets" />
                <Route element={<OpsConfigurationHistory />} path="/ops/configuration/history" />
                <Route element={<OpsPartners />} path="/ops/partners" />
                <Route element={<PartnerApiKeys />} path="/ops/partners/credentials" />
                <Route element={<OpsPartnerScorecard />} path="/ops/partners/:partnerId" />
                <Route element={<KycSubmissions />} path="/ops/kyc" />
                <Route element={<TreasuryDashboard />} path="/ops/treasury" />
                <Route element={<BridgeOps />} path="/ops/treasury/bridge" />
                <Route element={<OpsBridgeBatchDetail />} path="/ops/treasury/bridge/batches/:batchId" />
                <Route element={<TransactionsList />} path="/ops/transactions" />
                <Route element={<TransactionReconcile />} path="/ops/transactions/reconcile" />
                <Route element={<TransactionDetail />} path="/ops/transactions/:transactionId" />
                <Route element={<OpsUsers />} path="/ops/administration/users" />
                <Route element={<OpsAuditLog />} path="/ops/administration/audit" />
                <Route element={<OpsIntegrations />} path="/ops/administration/integrations" />
              </Route>
            </Routes>
          </Suspense>
        </OpsShellStatusProvider>
      </OpsMutationProvider>
    </Router>
  )
}

export default App

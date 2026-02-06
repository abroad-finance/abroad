import './shims/global'
import './observability/sentry'
import * as Sentry from '@sentry/react'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import './index.css'
import App from './App.tsx'

const rootEl = document.getElementById('root')
if (!rootEl) {
  throw new Error('Root element with id "root" not found')
}
createRoot(rootEl).render(
  <StrictMode>
    <Sentry.ErrorBoundary
      fallback={(
        <div className="min-h-screen flex items-center justify-center bg-white text-slate-900 p-6">
          <div className="max-w-md w-full rounded-2xl border border-slate-200 bg-slate-50 p-6 shadow-sm">
            <h1 className="text-lg font-semibold">Something went wrong</h1>
            <p className="mt-2 text-sm text-slate-600">
              Please refresh the page. If the problem persists, contact support.
            </p>
          </div>
        </div>
      )}
    >
      <App />
    </Sentry.ErrorBoundary>
  </StrictMode>,
)

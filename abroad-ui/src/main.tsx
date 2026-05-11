import './shims/global'
import './observability/sentry'
import * as Sentry from '@sentry/react'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import './index.css'
import App from './App.tsx'
import UnavailableInRegion from './UnavailableInRegion.tsx'

const rootEl = document.getElementById('root')
if (!rootEl) {
  throw new Error('Root element with id "root" not found')
}

const root = createRoot(rootEl)

const AppShell = (
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
  </StrictMode>
)

async function isGeoBlocked(): Promise<boolean> {
  const apiUrl = import.meta.env.VITE_API_URL || 'https://api.abroad.finance'
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 3000)
    const res = await fetch(`${apiUrl}/geo/country`, {
      cache: 'no-store',
      signal: controller.signal,
    })
    clearTimeout(timeout)
    if (!res.ok) return false
    const data = (await res.json()) as { blocked?: boolean }
    return data.blocked === true
  }
  catch {
    return false
  }
}

void (async () => {
  if (await isGeoBlocked()) {
    document.title = 'Service unavailable in your region'
    root.render(<UnavailableInRegion />)
    return
  }
  root.render(AppShell)
})()

import { LogOut } from 'lucide-react'
import { useEffect } from 'react'
import { Link, Outlet } from 'react-router-dom'

import AbroadLogo from '../../assets/Logos/AbroadLogoColored.svg'
import {
  clearPartnerPortalSession,
  usePartnerPortalSession,
} from '../../services/partnerPortal/partnerPortalSessionStore'
import PartnerPortalSignIn from './PartnerPortalSignIn'

const PartnerPortalShell = () => {
  const session = usePartnerPortalSession()

  useEffect(() => {
    if (!session) return undefined
    const remainingMs = Math.max(0, Date.parse(session.expiresAt) - Date.now())
    const timeout = window.setTimeout(clearPartnerPortalSession, remainingMs)
    return () => window.clearTimeout(timeout)
  }, [session])

  if (!session) return <PartnerPortalSignIn />

  return (
    <div className="partner-page min-h-screen">
      <a className="partner-skip-link" href="#partner-main">Skip to transactions</a>
      <header className="border-b border-partner-border/80 bg-white/85 backdrop-blur-xl">
        <div className="mx-auto flex h-[72px] max-w-7xl items-center justify-between gap-4 px-5 sm:px-8">
          <div className="flex min-w-0 items-center gap-8">
            <Link aria-label="Transactions home" className="shrink-0 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-partner-forest" to="/partner/transactions">
              <img alt="Abroad" className="h-7 w-auto" src={AbroadLogo} />
            </Link>
            <nav aria-label="Partner workspace" className="hidden sm:block">
              <Link className="border-b-2 border-partner-forest py-6 text-sm font-semibold text-partner-ink" to="/partner/transactions">
                Transactions
              </Link>
            </nav>
          </div>
          <div className="flex min-w-0 items-center gap-2 sm:gap-4">
            <div className="hidden min-w-0 text-right sm:block">
              <p className="truncate text-sm font-semibold text-partner-ink">{session.partnerName}</p>
              <p className="text-xs text-partner-muted">Read-only access</p>
            </div>
            <button
              aria-label="Sign out"
              className="partner-button-secondary px-3 sm:px-4"
              onClick={clearPartnerPortalSession}
              type="button"
            >
              <LogOut aria-hidden className="h-4 w-4" />
              <span className="hidden sm:inline">Sign out</span>
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-7xl px-5 py-9 sm:px-8 sm:py-12" id="partner-main">
        <Outlet />
      </main>
    </div>
  )
}

export default PartnerPortalShell

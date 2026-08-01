import {
  KeyRound, ListChecks, LogOut, ShieldCheck, UsersRound,
} from 'lucide-react'
import { useEffect } from 'react'
import { Link, NavLink, Outlet } from 'react-router-dom'

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

  const canAdminister = session.role === 'ADMIN' && session.mfaVerified
  const navigation = [
    {
      icon: ListChecks, label: 'Transactions', to: '/partner/transactions', visible: true,
    },
    {
      icon: KeyRound, label: 'Integration', to: '/partner/integration', visible: canAdminister,
    },
    {
      icon: UsersRound, label: 'Team & security', to: '/partner/security', visible: true,
    },
  ].filter(item => item.visible)

  return (
    <div className="partner-page min-h-screen">
      <a className="partner-skip-link" href="#partner-main">Skip to content</a>
      <header className="border-b border-partner-border/80 bg-white/85 backdrop-blur-xl">
        <div className="mx-auto flex min-h-[72px] max-w-7xl items-center justify-between gap-4 px-5 py-3 sm:px-8">
          <div className="flex min-w-0 items-center gap-8">
            <Link aria-label="Transactions home" className="shrink-0 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-partner-forest" to="/partner/transactions">
              <img alt="Abroad" className="h-7 w-auto" src={AbroadLogo} />
            </Link>
            <nav aria-label="Partner workspace" className="hidden items-center gap-1 md:flex">
              {navigation.map(item => (
                <NavLink
                  className={({ isActive }) => `inline-flex min-h-10 items-center gap-2 rounded-xl px-3 text-sm font-semibold transition ${isActive ? 'bg-partner-mint/55 text-partner-forest' : 'text-partner-muted hover:bg-partner-ledger hover:text-partner-ink'}`}
                  key={item.to}
                  to={item.to}
                >
                  <item.icon aria-hidden className="h-4 w-4" />
                  {item.label}
                </NavLink>
              ))}
            </nav>
          </div>
          <div className="flex min-w-0 items-center gap-2 sm:gap-4">
            <div className="hidden min-w-0 text-right sm:block">
              <p className="truncate text-sm font-semibold text-partner-ink">{session.partnerName}</p>
              <p className="truncate text-xs text-partner-muted">{session.email}</p>
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
        <nav aria-label="Partner workspace mobile" className="mx-auto flex max-w-7xl gap-2 overflow-x-auto px-5 pb-3 md:hidden">
          {navigation.map(item => (
            <NavLink
              className={({ isActive }) => `inline-flex min-h-10 shrink-0 items-center gap-2 rounded-xl px-3 text-sm font-semibold ${isActive ? 'bg-partner-mint/55 text-partner-forest' : 'bg-partner-ledger text-partner-muted'}`}
              key={item.to}
              to={item.to}
            >
              <item.icon aria-hidden className="h-4 w-4" />
              {item.label}
            </NavLink>
          ))}
        </nav>
      </header>
      {session.role === 'ADMIN' && !session.mfaVerified && (
        <div className="border-b border-amber-200 bg-amber-50 px-5 py-3 text-sm text-amber-900">
          <div className="mx-auto flex max-w-7xl items-center gap-2 sm:px-3">
            <ShieldCheck aria-hidden className="h-4 w-4 shrink-0" />
            <span>Enable MFA in Team &amp; security to manage integration credentials and webhooks.</span>
          </div>
        </div>
      )}
      <main className="mx-auto w-full max-w-7xl px-5 py-9 sm:px-8 sm:py-12" id="partner-main">
        <Outlet />
      </main>
    </div>
  )
}

export default PartnerPortalShell

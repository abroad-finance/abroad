import { Link, useLocation } from 'react-router-dom'

import { cn } from '../../../shared/utils'

/** Single source of truth for Ops destinations — rendered identically on every page. */
const NAV_ITEMS: { label: string, to: string }[] = [
  { label: 'Flows', to: '/ops/flows' },
  { label: 'Definitions', to: '/ops/flows/definitions' },
  { label: 'Crypto Assets', to: '/ops/crypto-assets' },
  { label: 'Partners', to: '/ops/partners' },
  { label: 'Transactions', to: '/ops/transactions' },
  { label: 'Reconcile', to: '/ops/transactions/reconcile' },
  { label: 'Treasury', to: '/ops/treasury' },
  { label: 'Bridge', to: '/ops/treasury/bridge' },
]

/**
 * Longest-prefix match so nested routes highlight the right section:
 *  /ops/flows/123           -> Flows
 *  /ops/flows/definitions   -> Definitions
 *  /ops/transactions/abc    -> Transactions
 *  /ops/transactions/reconcile -> Reconcile
 *  /ops/treasury/bridge     -> Bridge
 */
const activePath = (pathname: string): null | string => {
  let best: null | string = null
  for (const item of NAV_ITEMS) {
    const matches = pathname === item.to || pathname.startsWith(`${item.to}/`)
    if (matches && (best === null || item.to.length > best.length)) best = item.to
  }
  return best
}

/**
 * Consistent, responsive Ops navigation. Wraps on all screen sizes so every
 * destination stays reachable (no hidden/overflowing links on mobile), and marks
 * the current section with a filled pill + aria-current for orientation & AT.
 */
export const OpsNav = () => {
  const { pathname } = useLocation()
  const active = activePath(pathname)

  return (
    <nav aria-label="Operations sections" className="flex flex-wrap gap-2">
      {NAV_ITEMS.map((item) => {
        const isActive = item.to === active
        return (
          <Link
            aria-current={isActive ? 'page' : undefined}
            className={cn('ops-nav-link', isActive && 'ops-nav-link-active')}
            key={item.to}
            to={item.to}
          >
            {item.label}
          </Link>
        )
      })}
    </nav>
  )
}

/* eslint-disable react-refresh/only-export-components -- navigation metadata is exported for exact hierarchy and permission regression tests. */
import type { LucideIcon } from 'lucide-react'

import {
  Activity,
  ArrowLeftRight,
  Blocks,
  Building2,
  Cable,
  ChartNoAxesCombined,
  Coins,
  FileClock,
  GitBranch,
  Globe,
  History,
  Home,
  KeyRound,
  Menu,
  ReceiptText,
  Scale,
  ScrollText,
  ShieldCheck,
  Siren,
  UsersRound,
  WalletCards,
  Workflow,
} from 'lucide-react'
import { useId, useMemo, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'

import { useOpsAuth } from '../../../services/admin/opsAuthStore'
import { cn } from '../../../shared/utils'
import { OpsDialog } from './OpsDialog'
import { useOpsShellStatus } from './OpsShellStatusContext'

type OpsNavGroup = {
  items: OpsNavItem[]
  label: string
}

type OpsNavItem = {
  aliases?: string[]
  icon: LucideIcon
  label: string
  permission?: string
  to: string
}

const LEGACY_READ_PERMISSIONS = new Set([
  'configuration:read',
  'flows:read',
  'incidents:read',
  'overview:read',
  'partners:read',
  'search:read',
  'transactions:read',
  'treasury:read',
])

export const OPS_NAV_GROUPS: OpsNavGroup[] = [
  {
    items: [{ icon: Home, label: 'Home', to: '/ops' }],
    label: 'Home',
  },
  {
    items: [
      {
        icon: Siren, label: 'Incidents', permission: 'incidents:read', to: '/ops/incidents',
      },
      {
        icon: ReceiptText, label: 'Transactions', permission: 'transactions:read', to: '/ops/transactions',
      },
      {
        icon: Workflow, label: 'Flows', permission: 'flows:read', to: '/ops/flows',
      },
      {
        icon: Scale, label: 'Reconciliation', permission: 'transactions:reconcile', to: '/ops/transactions/reconcile',
      },
    ],
    label: 'Work',
  },
  {
    items: [
      {
        icon: WalletCards, label: 'Treasury', permission: 'treasury:read', to: '/ops/treasury',
      },
      {
        icon: ArrowLeftRight, label: 'Bridge', permission: 'treasury:read', to: '/ops/treasury/bridge',
      },
      {
        icon: ChartNoAxesCombined, label: 'Business Performance', permission: 'overview:read', to: '/ops/business-performance',
      },
    ],
    label: 'Money',
  },
  {
    items: [
      {
        icon: Building2, label: 'Partners', permission: 'partners:read', to: '/ops/partners',
      },
      {
        icon: KeyRound, label: 'Credentials', permission: 'credentials:manage', to: '/ops/partners/credentials',
      },
      {
        icon: ShieldCheck, label: 'KYC', permission: 'kyc:read', to: '/ops/kyc',
      },
    ],
    label: 'Partners & Compliance',
  },
  {
    items: [
      {
        aliases: ['/ops/flows/definitions'],
        icon: GitBranch,
        label: 'Corridors',
        permission: 'configuration:read',
        to: '/ops/configuration/corridors',
      },
      {
        aliases: ['/ops/crypto-assets'],
        icon: Coins,
        label: 'Assets',
        permission: 'configuration:read',
        to: '/ops/configuration/assets',
      },
      {
        icon: Globe, label: 'Region Restriction', permission: 'configuration:read', to: '/ops/configuration/region-restriction',
      },
      {
        icon: History, label: 'History', permission: 'configuration:read', to: '/ops/configuration/history',
      },
    ],
    label: 'Configuration',
  },
  {
    items: [
      {
        icon: UsersRound, label: 'Users', permission: 'administration:users', to: '/ops/administration/users',
      },
      {
        icon: ScrollText, label: 'Audit', permission: 'administration:audit', to: '/ops/administration/audit',
      },
      {
        icon: Cable, label: 'Integrations', permission: 'administration:integrations', to: '/ops/administration/integrations',
      },
    ],
    label: 'Administration',
  },
]

const matchesItem = (pathname: string, item: OpsNavItem): boolean => (
  [item.to, ...(item.aliases ?? [])].some(path => pathname === path || pathname.startsWith(`${path}/`))
)

const activeDestination = (pathname: string, groups: OpsNavGroup[]): null | string => {
  const matches = groups
    .flatMap(group => group.items)
    .filter(item => matchesItem(pathname, item))
    .sort((left, right) => right.to.length - left.to.length)
  return matches[0]?.to ?? null
}

const NavigationContent = ({ active, groups, onNavigate }: {
  active: null | string
  groups: OpsNavGroup[]
  onNavigate?: () => void
}) => {
  const { incidentCount } = useOpsShellStatus()
  const groupId = (label: string): string => `ops-nav-${label.replace(/\W+/g, '-').toLowerCase()}`
  return (
    <nav aria-label="Operations sections" className="space-y-5">
      {groups.map(group => (
        <section aria-labelledby={groupId(group.label)} key={group.label}>
          <h2 className="ops-nav-group-label" id={groupId(group.label)}>
            {group.label}
          </h2>
          <div className="mt-1 space-y-1">
            {group.items.map((item) => {
              const Icon = item.icon
              const isActive = active === item.to
              return (
                <Link
                  aria-current={isActive ? 'page' : undefined}
                  className={cn('ops-nav-link', isActive && 'ops-nav-link-active')}
                  key={item.to}
                  onClick={onNavigate}
                  to={item.to}
                >
                  <Icon aria-hidden className="h-[18px] w-[18px] shrink-0" />
                  <span className="min-w-0 flex-1 truncate">{item.label}</span>
                  {item.label === 'Incidents' && incidentCount !== null && (
                    <span
                      aria-label={`${incidentCount} active incidents`}
                      className={cn(
                        'inline-flex min-w-6 items-center justify-center rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums',
                        isActive ? 'bg-white/20 text-white' : incidentCount > 0 ? 'bg-rose-100 text-rose-800' : 'bg-stone-100 text-stone-600',
                      )}
                    >
                      {incidentCount > 99 ? '99+' : incidentCount}
                    </span>
                  )}
                </Link>
              )
            })}
          </div>
        </section>
      ))}
    </nav>
  )
}

export const OpsNav = () => {
  const auth = useOpsAuth()
  const { pathname } = useLocation()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const drawerTitleId = useId()
  const effectivePermissions = useMemo(() => (
    auth.session
      ? new Set(auth.session.permissions)
      : auth.legacyApiKey
        ? LEGACY_READ_PERMISSIONS
        : new Set<string>()
  ), [auth.legacyApiKey, auth.session])
  const groups = useMemo(() => OPS_NAV_GROUPS
    .map(group => ({
      ...group,
      items: group.items.filter(item => !item.permission || effectivePermissions.has(item.permission)),
    }))
    .filter(group => group.items.length > 0), [effectivePermissions])
  const active = activeDestination(pathname, groups)

  return (
    <>
      <aside className="ops-sidebar hidden lg:flex" data-testid="ops-desktop-sidebar">
        <div className="flex items-center gap-3 border-b border-white/10 px-5 py-5">
          <span className="flex size-10 items-center justify-center rounded-xl bg-white/10 text-white">
            <Blocks aria-hidden size={20} />
          </span>
          <div>
            <div className="text-sm font-semibold tracking-wide text-white">Abroad Ops</div>
            <div className="mt-0.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.15em] text-emerald-200">
              <span aria-hidden className="size-1.5 rounded-full bg-emerald-300" />
              Production
            </div>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-5">
          <NavigationContent active={active} groups={groups} />
        </div>
        <div className="border-t border-white/10 px-5 py-4 text-xs leading-5 text-emerald-100/70">
          <div className="flex items-center gap-2 font-medium text-emerald-100">
            <FileClock aria-hidden size={15} />
            Audited production access
          </div>
          Every sensitive read and change is attributable.
        </div>
      </aside>

      <div className="ops-mobile-nav lg:hidden">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex size-9 items-center justify-center rounded-xl bg-ops-brand text-white">
            <Activity aria-hidden size={18} />
          </span>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-ops-text">Abroad Ops</div>
            <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-emerald-700">
              <span aria-hidden className="size-1.5 rounded-full bg-emerald-500" />
              Production
            </div>
          </div>
        </div>
        <button
          aria-controls={drawerTitleId}
          aria-expanded={drawerOpen}
          aria-label="Open operations navigation"
          className="ops-icon-btn"
          onClick={() => setDrawerOpen(true)}
          type="button"
        >
          <Menu aria-hidden size={20} />
        </button>
      </div>

      {drawerOpen && (
        <OpsDialog
          description="Task-grouped production operations navigation. Items reflect your current role."
          onClose={() => setDrawerOpen(false)}
          title="Operations navigation"
        >
          <div id={drawerTitleId}>
            <NavigationContent active={active} groups={groups} onNavigate={() => setDrawerOpen(false)} />
          </div>
          <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-900">
            Production environment · changes require explicit confirmation and are audited.
          </div>
        </OpsDialog>
      )}
    </>
  )
}

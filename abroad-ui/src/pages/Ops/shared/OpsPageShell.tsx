import type { ReactNode } from 'react'

import {
  AlertTriangle,
  Bell,
  Check,
  Copy,
  RefreshCcw,
  Search,
} from 'lucide-react'
import {
  useEffect,
  useRef,
  useState,
} from 'react'
import {
  Link,
  useLocation,
  useNavigate,
} from 'react-router-dom'

import { useOpsIsAuthenticated } from '../../../services/admin/opsAuthStore'
import { cn } from '../../../shared/utils'
import OpsApiKeyPanel from '../OpsApiKeyPanel'
import { OpsBanner } from './OpsBanner'
import { OpsNav } from './OpsNav'
import { useOpsShellStatus } from './OpsShellStatusContext'

type OpsPageWidth = 'form' | 'full' | 'narrow' | 'wide'

const widthClass: Record<OpsPageWidth, string> = {
  form: 'max-w-4xl',
  full: 'max-w-[90rem]',
  narrow: 'max-w-5xl',
  wide: 'max-w-7xl',
}

interface OpsPageShellProps {
  /** Optional right-aligned header actions (e.g. a Refresh button). */
  actions?: ReactNode
  /** Optional back affordance for detail pages, shown above the header. */
  backLink?: { label: string, to: string }
  children: ReactNode
  /** Error message rendered as a classified recovery banner below the header. */
  error?: null | string
  /** Small uppercase context label above the title. */
  eyebrow?: string
  /** When set and no named or legacy session is present, shows this warning. */
  keyRequiredMessage?: string
  /** Show the shared Ops authentication surface (default true). */
  showApiKeyPanel?: boolean
  subtitle?: ReactNode
  title: ReactNode
  width?: OpsPageWidth
}

type RecoveryCategory = {
  guidance: string
  label: string
}

const classifyRecovery = (message: string): RecoveryCategory => {
  if (/429|rate.?limit|too many/i.test(message)) {
    return {
      guidance: 'Wait for the indicated provider window, then retry once. Check Incident Center before escalating.',
      label: 'Request throttled',
    }
  }
  if (/timeout|timed out/i.test(message)) {
    return {
      guidance: 'The last known data remains valid. Retry this section and check provider health if it repeats.',
      label: 'Response delayed',
    }
  }
  if (/401|403|access|auth|permission/i.test(message)) {
    return {
      guidance: 'Verify your named session and assigned role. Ask an administrator if this task should be in your scope.',
      label: 'Access needs attention',
    }
  }
  if (/network|fetch|connection|offline/i.test(message)) {
    return {
      guidance: 'Check connectivity, then retry. Previously loaded information may be stale until the connection recovers.',
      label: 'Connection unavailable',
    }
  }
  return {
    guidance: 'Retry once. If the issue persists, copy the diagnostic reference and open or join an incident.',
    label: 'Data could not be loaded',
  }
}

const RecoveryBanner = ({ message, route }: { message: string, route: string }) => {
  const [copied, setCopied] = useState(false)
  const reference = useRef(`OPS-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`)
  const recovery = classifyRecovery(message)
  const diagnostics = JSON.stringify({ category: recovery.label, reference: reference.current, route })

  const copyDiagnostics = async (): Promise<void> => {
    await navigator.clipboard.writeText(diagnostics)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 2_000)
  }

  return (
    <OpsBanner className="mt-5" variant="error">
      <div className="flex items-start gap-3">
        <AlertTriangle aria-hidden className="mt-0.5 shrink-0" size={18} />
        <div className="min-w-0 flex-1">
          <div className="font-semibold">{recovery.label}</div>
          <p className="mt-1 text-sm leading-6">{recovery.guidance}</p>
          <details className="mt-2 text-xs">
            <summary className="min-h-11 cursor-pointer py-3 font-medium underline underline-offset-4">Technical details</summary>
            <p className="break-words pb-2">{message}</p>
          </details>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <code className="rounded-md bg-white/70 px-2 py-1 text-[11px] text-rose-900">{reference.current}</code>
            <button className="ops-btn-danger ops-btn-sm" onClick={() => void copyDiagnostics()} type="button">
              {copied ? <Check aria-hidden size={14} /> : <Copy aria-hidden size={14} />}
              {copied ? 'Copied' : 'Copy safe diagnostics'}
            </button>
          </div>
        </div>
      </div>
    </OpsBanner>
  )
}

const ShellTopbar = () => {
  const {
    checkedAt,
    dataState,
    incidentCount,
    refresh,
  } = useOpsShellStatus()
  const freshnessLabel = dataState === 'FRESH'
    ? 'Live data'
    : dataState === 'LOADING'
      ? 'Checking data'
      : dataState === 'STALE'
        ? 'Stale data'
        : dataState === 'UNAVAILABLE'
          ? 'Data unavailable'
          : 'Not checked'
  const freshnessTone = dataState === 'FRESH'
    ? 'text-emerald-700 bg-emerald-50 border-emerald-200'
    : dataState === 'STALE' || dataState === 'UNAVAILABLE'
      ? 'text-amber-800 bg-amber-50 border-amber-200'
      : 'text-slate-600 bg-slate-50 border-slate-200'

  return (
    <div className="ops-shell-topbar">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <span className="hidden items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-emerald-800 sm:inline-flex">
          <span aria-hidden className="size-1.5 rounded-full bg-emerald-500" />
          Production
        </span>
        <Link className="ops-topbar-link" to="/ops/search">
          <Search aria-hidden size={17} />
          <span className="hidden sm:inline">Search</span>
          <kbd className="hidden rounded border border-ops-border bg-white px-1.5 py-0.5 text-[10px] font-normal text-ops-muted xl:inline">⌘ K</kbd>
        </Link>
        <Link className="ops-topbar-link" to="/ops/incidents">
          <Bell aria-hidden size={17} />
          <span className="hidden sm:inline">Incidents</span>
          {incidentCount !== null && (
            <span className={cn('rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums', incidentCount > 0 ? 'bg-rose-100 text-rose-800' : 'bg-stone-100 text-stone-600')}>
              {incidentCount > 99 ? '99+' : incidentCount}
            </span>
          )}
        </Link>
        <button
          aria-label={`${freshnessLabel}. Refresh shell status`}
          className={cn('ops-topbar-link border', freshnessTone)}
          onClick={() => void refresh()}
          title={checkedAt ? `Last checked ${new Date(checkedAt).toLocaleTimeString()}` : freshnessLabel}
          type="button"
        >
          <RefreshCcw aria-hidden className={dataState === 'LOADING' ? 'animate-spin' : undefined} size={15} />
          <span className="hidden xl:inline">{freshnessLabel}</span>
        </button>
      </div>
      <OpsApiKeyPanel compact />
    </div>
  )
}

/** Canonical task-oriented Ops shell shared by every route. */
export const OpsPageShell = ({
  actions,
  backLink,
  children,
  error,
  eyebrow,
  keyRequiredMessage,
  showApiKeyPanel = true,
  subtitle,
  title,
  width = 'wide',
}: OpsPageShellProps) => {
  const isAuthenticated = useOpsIsAuthenticated()
  const { pathname } = useLocation()
  const navigate = useNavigate()

  useEffect(() => {
    document.title = `${typeof title === 'string' ? title : 'Operations'} | Abroad Ops`
  }, [title])

  useEffect(() => {
    if (!isAuthenticated) return
    const openSearch = (event: KeyboardEvent): void => {
      if (event.key.toLowerCase() !== 'k' || (!event.metaKey && !event.ctrlKey)) return
      event.preventDefault()
      navigate('/ops/search')
    }
    window.addEventListener('keydown', openSearch)
    return () => window.removeEventListener('keydown', openSearch)
  }, [isAuthenticated, navigate])

  return (
    <div className="ops-page">
      <a className="ops-skip-link" href="#ops-main-content">Skip to operations content</a>
      <div className="ops-shell">
        <OpsNav />
        <div className="min-w-0">
          {isAuthenticated && <ShellTopbar />}
          <main className="relative overflow-hidden" id="ops-main-content" tabIndex={-1}>
            <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-72 bg-[radial-gradient(circle_at_top,_rgba(27,94,89,0.12),_transparent_65%)]" />
            <div className={cn('relative mx-auto px-4 py-6 sm:px-6 sm:py-8 xl:px-8', widthClass[width])}>
              {backLink && (
                <Link className="inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-ops-brand hover:text-ops-brand-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ops-brand/50" to={backLink.to}>
                  <span aria-hidden>←</span>
                  {backLink.label}
                </Link>
              )}

              <header className={cn('flex flex-col gap-4 md:flex-row md:items-end md:justify-between', backLink ? 'mt-3' : undefined)}>
                <div className="min-w-0">
                  {eyebrow && <div className="ops-eyebrow">{eyebrow}</div>}
                  <h1 className="ops-title mt-1 break-words">{title}</h1>
                  {subtitle && <p className="ops-subtitle">{subtitle}</p>}
                </div>
                {actions && <div className="flex flex-wrap items-center gap-3">{actions}</div>}
              </header>

              {showApiKeyPanel && !isAuthenticated && <OpsApiKeyPanel />}

              {error && <RecoveryBanner message={error} route={pathname} />}

              {keyRequiredMessage && !isAuthenticated && (
                <OpsBanner className="mt-4" variant="warning">{keyRequiredMessage}</OpsBanner>
              )}

              {children}
            </div>
          </main>
        </div>
      </div>
    </div>
  )
}

import type { ReactNode } from 'react'

import { Link } from 'react-router-dom'

import { useOpsApiKey } from '../../../services/admin/opsAuthStore'
import { cn } from '../../../shared/utils'
import OpsApiKeyPanel from '../OpsApiKeyPanel'
import { OpsBanner } from './OpsBanner'
import { OpsNav } from './OpsNav'

type OpsPageWidth = 'form' | 'full' | 'narrow' | 'wide'

const widthClass: Record<OpsPageWidth, string> = {
  form: 'max-w-4xl',
  full: 'max-w-7xl',
  narrow: 'max-w-5xl',
  wide: 'max-w-6xl',
}

interface OpsPageShellProps {
  /** Optional right-aligned header actions (e.g. a Refresh button). */
  actions?: ReactNode
  /** Optional "← Back to …" affordance for detail pages, shown above the header. */
  backLink?: { label: string, to: string }
  children: ReactNode
  /** Error message rendered as an alert banner below the header. */
  error?: null | string
  /** Small uppercase context label above the title. */
  eyebrow?: string
  /** When set and no ops key is present, shows a warning banner with this copy. */
  keyRequiredMessage?: string
  /** Show the shared Ops API key panel (default true). */
  showApiKeyPanel?: boolean
  subtitle?: ReactNode
  title: ReactNode
  width?: OpsPageWidth
}

/**
 * The canonical Ops page chrome: beige page + radial hero, the shared responsive
 * OpsNav, a consistent eyebrow/title/subtitle header with an actions slot, the
 * one ops API-key panel, and shared error / key-required banners. Every Ops page
 * renders `<OpsPageShell …>{body}</OpsPageShell>` instead of hand-rolling this block.
 */
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
  const opsApiKey = useOpsApiKey()

  return (
    <div className="ops-page">
      <div className="relative overflow-hidden">
        <div
          aria-hidden
          className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(27,94,89,0.18),_transparent_55%)]"
        />
        <div className={cn('relative mx-auto px-6 py-10', widthClass[width])}>
          <OpsNav />

          {backLink && (
            <Link
              className="mt-6 inline-flex items-center gap-1.5 text-sm font-medium text-ops-brand transition hover:text-ops-brand-hover"
              to={backLink.to}
            >
              <span aria-hidden>←</span>
              {backLink.label}
            </Link>
          )}

          <header
            className={cn(
              'flex flex-col gap-4 md:flex-row md:items-end md:justify-between',
              backLink ? 'mt-4' : 'mt-8',
            )}
          >
            <div>
              {eyebrow && <div className="ops-eyebrow">{eyebrow}</div>}
              <h1 className="ops-title mt-1">{title}</h1>
              {subtitle && <p className="ops-subtitle">{subtitle}</p>}
            </div>
            {actions && <div className="flex flex-wrap items-center gap-3">{actions}</div>}
          </header>

          {showApiKeyPanel && <OpsApiKeyPanel />}

          {error && (
            <OpsBanner className="mt-4" variant="error">
              {error}
            </OpsBanner>
          )}

          {keyRequiredMessage && !opsApiKey && (
            <OpsBanner className="mt-4" variant="warning">
              {keyRequiredMessage}
            </OpsBanner>
          )}

          {children}
        </div>
      </div>
    </div>
  )
}

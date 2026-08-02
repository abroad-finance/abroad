import { LogIn, LogOut, ShieldCheck } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import {
  clearOpsApiKey,
  setOpsApiKey,
  useOpsAuth,
} from '../../services/admin/opsAuthStore'
import {
  bootstrapOpsAdministrator,
  restoreOpsSession,
  signInToOps,
  signOutFromOps,
  stepUpOpsSession,
} from '../../services/admin/opsIdentityApi'
import { OpsBanner } from './shared/OpsBanner'
import { OpsStatusBadge } from './shared/opsStatus'

const formatRole = (role: null | string): string => {
  if (!role) return 'Legacy access'
  return role.charAt(0) + role.slice(1).toLowerCase()
}

const OpsApiKeyPanel = ({ compact = false }: { compact?: boolean }) => {
  const auth = useOpsAuth()
  const [draft, setDraft] = useState('')
  const [showFallback, setShowFallback] = useState(false)

  useEffect(() => {
    if (auth.status === 'initializing') {
      void restoreOpsSession().catch(() => undefined)
    }
  }, [auth.status])

  const stepUpIsCurrent = useMemo(() => {
    if (!auth.session?.stepUpExpiresAt) return false
    return Date.parse(auth.session.stepUpExpiresAt) > Date.now()
  }, [auth.session?.stepUpExpiresAt])

  if (auth.session) {
    if (compact) {
      return (
        <div className="flex min-w-0 items-center gap-2" data-testid="ops-compact-session">
          <div className="hidden min-w-0 sm:block">
            <div className="max-w-40 truncate text-xs font-semibold text-ops-text">{auth.session.displayName}</div>
            <div className="text-[10px] text-ops-muted">{formatRole(auth.session.role)}</div>
          </div>
          {stepUpIsCurrent
            ? (
                <span aria-label="Recently verified" className="flex size-8 items-center justify-center rounded-full bg-emerald-100 text-emerald-700" title="Recently verified">
                  <ShieldCheck aria-hidden size={15} />
                </span>
              )
            : (
                <button
                  className="ops-btn-neutral ops-btn-sm hidden sm:inline-flex"
                  disabled={auth.status === 'authenticating'}
                  onClick={() => void stepUpOpsSession().catch(() => undefined)}
                  type="button"
                >
                  Verify
                </button>
              )}
          <button
            aria-label="Sign out of Ops"
            className="ops-icon-btn"
            disabled={auth.status === 'authenticating'}
            onClick={() => void signOutFromOps()}
            title="Sign out"
            type="button"
          >
            <LogOut aria-hidden size={17} />
          </button>
        </div>
      )
    }
    return (
      <div className="ops-session-bar mt-5" data-testid="ops-session-bar">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-sm font-semibold text-ops-text">
              {auth.session.displayName}
            </span>
            <OpsStatusBadge tone="success">{formatRole(auth.session.role)}</OpsStatusBadge>
            {stepUpIsCurrent && (
              <span className="inline-flex items-center gap-1 text-xs font-medium text-ops-brand">
                <ShieldCheck aria-hidden size={14} />
                Recently verified
              </span>
            )}
          </div>
          <div className="truncate text-xs text-ops-muted">{auth.session.email}</div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            className="ops-btn-neutral ops-btn-sm"
            disabled={auth.status === 'authenticating'}
            onClick={() => void stepUpOpsSession().catch(() => undefined)}
            type="button"
          >
            Verify again
          </button>
          <button
            aria-label="Sign out of Ops"
            className="ops-icon-btn"
            disabled={auth.status === 'authenticating'}
            onClick={() => void signOutFromOps()}
            title="Sign out"
            type="button"
          >
            <LogOut aria-hidden size={18} />
          </button>
        </div>

        {auth.session.bootstrapRequired && (
          <div className="col-span-full w-full border-t border-ops-border pt-4">
            <OpsBanner variant="warning">
              No Ops administrator exists yet. Use the current Ops key once to make this verified account the first administrator.
            </OpsBanner>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <input
                aria-label="One-time bootstrap Ops key"
                autoComplete="off"
                className="ops-input flex-1"
                name="ops-bootstrap-key"
                onChange={event => setDraft(event.target.value)}
                placeholder="One-time bootstrap key"
                type="password"
                value={draft}
              />
              <button
                className="ops-btn-primary"
                disabled={!draft.trim() || auth.status === 'authenticating'}
                onClick={() => void bootstrapOpsAdministrator(draft).then(() => setDraft('')).catch(() => undefined)}
                type="button"
              >
                Bootstrap administrator
              </button>
            </div>
          </div>
        )}
      </div>
    )
  }

  if (auth.legacyApiKey) {
    if (compact) {
      return (
        <div className="flex items-center gap-2" data-testid="ops-compact-legacy-session">
          <OpsStatusBadge tone="warning">Legacy read-only</OpsStatusBadge>
          <button className="ops-btn-neutral ops-btn-sm" onClick={clearOpsApiKey} type="button">Clear</button>
        </div>
      )
    }
    return (
      <div className="ops-session-bar mt-5" data-testid="ops-legacy-session-bar">
        <div>
          <div className="text-sm font-semibold text-ops-text">Emergency legacy access</div>
          <div className="text-xs text-ops-muted">Read-only after named administration is enabled.</div>
        </div>
        <button
          className="ops-btn-neutral ops-btn-sm"
          onClick={clearOpsApiKey}
          type="button"
        >
          Clear key
        </button>
      </div>
    )
  }

  if (compact) return null

  return (
    <section aria-labelledby="ops-access-title" className="ops-card mt-5 px-5 py-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="ops-eyebrow">Named access</div>
          <h2 className="text-base font-semibold text-ops-text" id="ops-access-title">
            Sign in with your Abroad account
          </h2>
          <p className="mt-1 text-sm text-ops-muted">
            Your role and actions are verified by the server and recorded in the Ops audit trail.
          </p>
        </div>
        <button
          className="ops-btn-primary shrink-0"
          disabled={auth.status === 'authenticating' || auth.status === 'initializing'}
          onClick={() => void signInToOps().catch(() => undefined)}
          type="button"
        >
          <LogIn aria-hidden size={18} />
          {auth.status === 'authenticating' ? 'Signing in…' : 'Sign in with Google'}
        </button>
      </div>

      {auth.error && (
        <OpsBanner className="mt-4" variant="error">
          {auth.error}
        </OpsBanner>
      )}

      <button
        aria-expanded={showFallback}
        className="mt-4 min-h-11 text-sm font-medium text-ops-muted underline decoration-ops-border underline-offset-4 hover:text-ops-text"
        onClick={() => setShowFallback(value => !value)}
        type="button"
      >
        Emergency legacy-key access
      </button>

      {showFallback && (
        <div className="mt-3 rounded-xl border border-ops-border bg-ops-bg p-4">
          <p className="text-sm text-ops-muted">
            Use only for bootstrap or identity-provider recovery. The key remains in this tab's memory.
          </p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <input
              aria-label="Emergency Ops API key"
              autoComplete="off"
              className="ops-input flex-1"
              name="ops-emergency-key"
              onChange={event => setDraft(event.target.value)}
              placeholder="Ops API key"
              type="password"
              value={draft}
            />
            <button
              className="ops-btn-neutral"
              disabled={!draft.trim()}
              onClick={() => {
                setOpsApiKey(draft)
                setDraft('')
              }}
              type="button"
            >
              Use legacy key
            </button>
          </div>
        </div>
      )}
    </section>
  )
}

export default OpsApiKeyPanel

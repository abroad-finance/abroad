import { useTranslate } from '@tolgee/react'
import {
  ArrowRight,
  Building2,
  Cable,
  CheckCircle2,
  Clock3,
  ExternalLink,
  LoaderCircle,
  LockKeyhole,
  ShieldCheck,
  Unplug,
  XCircle,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'

import type {
  PartnerAiAuthorizationRequest,
  PartnerAiAuthorizationResolution,
  PartnerAiScope,
} from '../../services/partnerPortal/partnerPortalTypes'

import {
  approvePartnerAiAuthorization,
  denyPartnerAiAuthorization,
  getPartnerAiAuthorizationRequest,
  recordPartnerAiProductEvent,
} from '../../services/partnerPortal/partnerPortalApi'
import { PARTNER_AI_DOCUMENTATION_URL } from '../../services/partnerPortal/partnerAiConfiguration'
import { formatPartnerDateTime } from './partnerPortalPresentation'
import { PartnerNotice } from './partnerPortalUi'

type ResolutionState = {
  outcome: 'APPROVED' | 'DENIED'
  resolution: PartnerAiAuthorizationResolution
}

const PartnerAiAuthorization = () => {
  const { t } = useTranslate()
  const requestId = new URLSearchParams(window.location.search).get('request')?.trim() ?? ''
  const entryError = new URLSearchParams(window.location.search).get('error')?.trim() ?? ''
  const [authorizationRequest, setAuthorizationRequest] = useState<null | PartnerAiAuthorizationRequest>(null)
  const [error, setError] = useState<null | string>(null)
  const [loading, setLoading] = useState(Boolean(requestId))
  const [pendingAction, setPendingAction] = useState<'approve' | 'deny' | null>(null)
  const [resolutionState, setResolutionState] = useState<null | ResolutionState>(null)
  const resultHeadingRef = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    if (!requestId) return
    let active = true
    setLoading(true)
    void getPartnerAiAuthorizationRequest(requestId)
      .then((result) => {
        if (!active) return
        setAuthorizationRequest(result)
        void recordPartnerAiProductEvent({
          clientCategory: 'GENERIC',
          entryPoint: 'DIRECT',
          event: 'AI_CONNECTION_STARTED',
          outcome: 'NOT_APPLICABLE',
        }).catch(() => undefined)
      })
      .catch((caught: unknown) => {
        if (active) setError(caught instanceof Error ? caught.message : t('partner.ai.authorization.load_error', 'Authorization details could not be loaded.'))
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [requestId, t])

  useEffect(() => {
    if (!entryError && requestId) return
    void recordPartnerAiProductEvent({
      clientCategory: 'UNSUPPORTED',
      entryPoint: 'DIRECT',
      event: 'AI_CONNECTION_STARTED',
      outcome: 'FAILED',
    }).catch(() => undefined)
  }, [entryError, requestId])

  useEffect(() => {
    if (resolutionState) resultHeadingRef.current?.focus()
  }, [resolutionState])

  const resolve = async (outcome: 'APPROVED' | 'DENIED') => {
    if (!authorizationRequest || pendingAction) return
    setPendingAction(outcome === 'APPROVED' ? 'approve' : 'deny')
    setError(null)
    try {
      const resolution = outcome === 'APPROVED'
        ? await approvePartnerAiAuthorization(authorizationRequest.requestId)
        : await denyPartnerAiAuthorization(authorizationRequest.requestId)
      setResolutionState({ outcome, resolution })
      void recordPartnerAiProductEvent({
        clientCategory: 'GENERIC',
        entryPoint: 'DIRECT',
        event: 'AI_AUTHORIZATION_COMPLETED',
        outcome,
      }).catch(() => undefined)
    }
    catch (caught) {
      void recordPartnerAiProductEvent({
        clientCategory: 'GENERIC',
        entryPoint: 'DIRECT',
        event: 'AI_AUTHORIZATION_COMPLETED',
        outcome: 'FAILED',
      }).catch(() => undefined)
      setError(caught instanceof Error ? caught.message : t('partner.ai.authorization.action_error', 'The authorization decision could not be completed.'))
    }
    finally {
      setPendingAction(null)
    }
  }

  const permissionDescription = (scope: PartnerAiScope): string => ({
    'account:read': t('partner.ai.permission.account', 'View your Abroad organization name and granted connection permissions.'),
    'docs:read': t('partner.ai.permission.docs', 'Search Abroad public integration documentation.'),
    'offline_access': t('partner.ai.permission.offline', 'Keep the connection active when the AI client is not open.'),
    'requests:validate': t('partner.ai.permission.validation', 'Validate API request shape without sending the request.'),
    'transactions:read': t('partner.ai.permission.transactions', 'View this organization’s transaction ledger and transaction diagnostics.'),
    'webhooks:read': t('partner.ai.permission.webhooks', 'View bounded webhook delivery health without URLs, payloads, or secrets.'),
  })[scope]

  if (entryError || !requestId) {
    const unsupported = entryError === 'unsupported-client' || (!entryError && !requestId)
    return (
      <section className="mx-auto max-w-2xl partner-section text-center" role="status">
        {unsupported ? <Unplug aria-hidden className="mx-auto h-8 w-8 text-partner-forest" /> : <XCircle aria-hidden className="mx-auto h-8 w-8 text-rose-700" />}
        <h1 className="mt-5 text-3xl font-semibold tracking-[-0.03em] text-partner-ink">
          {unsupported ? t('partner.ai.authorization.unsupported_title', 'This AI client is not supported') : t('partner.ai.authorization.server_error_title', 'The connection could not start')}
        </h1>
        <p className="mt-3 text-sm leading-6 text-partner-muted">
          {unsupported
            ? t('partner.ai.authorization.unsupported_description', 'Use a client that supports remote Streamable HTTP MCP servers, OAuth, dynamic registration, and PKCE S256.')
            : t('partner.ai.authorization.server_error_description', 'Return to your AI client and try again. If the problem continues, use the troubleshooting guide.')}
        </p>
        <div className="mt-7 flex flex-col justify-center gap-3 sm:flex-row">
          <Link className="partner-button-primary" to="/partner/integration/ai">{t('partner.ai.authorization.back', 'Back to AI integrations')}</Link>
          <a className="partner-button-secondary" href={PARTNER_AI_DOCUMENTATION_URL} rel="noreferrer" target="_blank">
            {t('partner.ai.documentation', 'Read the setup guide')}
            <ExternalLink aria-hidden className="h-4 w-4" />
          </a>
        </div>
      </section>
    )
  }

  if (loading) {
    return (
      <div aria-busy="true" className="partner-empty-state min-h-64" role="status">
        <LoaderCircle aria-hidden className="h-5 w-5 animate-spin motion-reduce:animate-none" />
        {t('partner.ai.authorization.loading', 'Loading authorization details…')}
      </div>
    )
  }

  if (resolutionState) {
    const approved = resolutionState.outcome === 'APPROVED'
    return (
      <section className="mx-auto max-w-2xl partner-section text-center" role="status">
        {approved ? <CheckCircle2 aria-hidden className="mx-auto h-9 w-9 text-emerald-600" /> : <XCircle aria-hidden className="mx-auto h-9 w-9 text-partner-muted" />}
        <h1 className="mt-5 text-3xl font-semibold tracking-[-0.03em] text-partner-ink" ref={resultHeadingRef} tabIndex={-1}>
          {approved ? t('partner.ai.authorization.approved_title', 'Connection approved') : t('partner.ai.authorization.denied_title', 'Connection denied')}
        </h1>
        <p className="mt-3 text-sm leading-6 text-partner-muted">
          {approved
            ? t('partner.ai.authorization.approved_description', 'Return to {client} to finish connecting. Abroad did not create or change any transaction.', { client: resolutionState.resolution.clientName })
            : t('partner.ai.authorization.denied_description', '{client} was not granted access to Abroad.', { client: resolutionState.resolution.clientName })}
        </p>
        <button className="partner-button-primary mt-7 w-full sm:w-auto" onClick={() => window.location.assign(resolutionState.resolution.returnToClientUrl)} type="button">
          {t('partner.ai.authorization.return_client', 'Return to {client}', { client: resolutionState.resolution.clientName })}
          <ArrowRight aria-hidden className="h-4 w-4" />
        </button>
        <p className="mt-4 text-xs text-partner-muted">{t('partner.ai.authorization.destination', 'You will return to {destination}.', { destination: resolutionState.resolution.destinationHost })}</p>
      </section>
    )
  }

  if (!authorizationRequest) {
    return (
      <section className="mx-auto max-w-2xl partner-section text-center">
        <XCircle aria-hidden className="mx-auto h-8 w-8 text-rose-700" />
        <h1 className="mt-5 text-3xl font-semibold text-partner-ink">{t('partner.ai.authorization.expired_session_title', 'Authorization session unavailable')}</h1>
        <p className="mt-3 text-sm text-partner-muted">{error ?? t('partner.ai.authorization.expired_session_description', 'Restart the connection from your AI client.')}</p>
      </section>
    )
  }

  const stateMessages = {
    ADMIN_REQUIRED: {
      description: t('partner.ai.authorization.admin_description', 'An organization administrator must review and authorize this client.'),
      title: t('partner.ai.authorization.admin_title', 'Administrator approval required'),
    },
    APPROVED: {
      description: t('partner.ai.authorization.already_approved_description', 'This request was already approved. Return to the AI client and restart the connection if it did not finish.'),
      title: t('partner.ai.authorization.already_approved_title', 'Authorization already completed'),
    },
    DENIED: {
      description: t('partner.ai.authorization.already_denied_description', 'This request was denied and cannot be reused. Start again from the AI client if access is still needed.'),
      title: t('partner.ai.authorization.already_denied_title', 'Authorization denied'),
    },
    EXPIRED: {
      description: t('partner.ai.authorization.expired_description', 'Authorization requests expire after 15 minutes. Start the connection again from your AI client.'),
      title: t('partner.ai.authorization.expired_title', 'Authorization request expired'),
    },
    MFA_REQUIRED: {
      description: t('partner.ai.authorization.mfa_description', 'Webhook diagnostics are privileged. Enable and verify MFA, then return to this same request.'),
      title: t('partner.ai.authorization.mfa_title', 'MFA verification required'),
    },
    READY: null,
    UNSUPPORTED_CLIENT: {
      description: t('partner.ai.authorization.unsupported_description', 'Use a client that supports remote Streamable HTTP MCP servers, OAuth, dynamic registration, and PKCE S256.'),
      title: t('partner.ai.authorization.unsupported_title', 'This AI client is not supported'),
    },
  }[authorizationRequest.state]

  if (stateMessages) {
    return (
      <section className="mx-auto max-w-2xl partner-section text-center">
        {authorizationRequest.state === 'EXPIRED' ? <Clock3 aria-hidden className="mx-auto h-8 w-8 text-amber-700" /> : <LockKeyhole aria-hidden className="mx-auto h-8 w-8 text-partner-forest" />}
        <h1 className="mt-5 text-3xl font-semibold tracking-[-0.03em] text-partner-ink">{stateMessages.title}</h1>
        <p className="mt-3 text-sm leading-6 text-partner-muted">{stateMessages.description}</p>
        {authorizationRequest.state === 'MFA_REQUIRED' && (
          <Link
            className="partner-button-primary mt-7"
            to={`/partner/security?returnTo=${encodeURIComponent(`/partner/integration/ai/authorize?request=${authorizationRequest.requestId}`)}`}
          >
            {t('partner.ai.authorization.open_security', 'Open security settings')}
          </Link>
        )}
        <Link className="partner-button-secondary mt-3" to="/partner/integration/ai">{t('partner.ai.authorization.back', 'Back to AI integrations')}</Link>
      </section>
    )
  }

  return (
    <div className="mx-auto max-w-3xl">
      <header className="text-center">
        <p className="partner-eyebrow">{t('partner.ai.authorization.eyebrow', 'Review requested access')}</p>
        <h1 className="mt-2 text-4xl font-semibold tracking-[-0.04em] text-partner-ink">{t('partner.ai.authorization.title', 'Authorize an AI client')}</h1>
        <p className="mt-3 text-sm leading-6 text-partner-muted">{t('partner.ai.authorization.intro', 'Approve only if you recognize the client and agree with every permission below.')}</p>
      </header>

      <section aria-labelledby="partner-ai-client-title" className="partner-section mt-8">
        <div className="grid gap-4 sm:grid-cols-[1fr_auto_1fr] sm:items-center">
          <div className="rounded-2xl bg-partner-ledger p-4 text-center">
            <Cable aria-hidden className="mx-auto h-5 w-5 text-partner-forest" />
            <p className="mt-2 text-xs font-semibold uppercase tracking-[0.12em] text-partner-muted">{t('partner.ai.authorization.requesting_client', 'Requesting client')}</p>
            <h2 className="mt-1 truncate font-semibold text-partner-ink" id="partner-ai-client-title">{authorizationRequest.client.name}</h2>
            {!authorizationRequest.client.verified && <p className="mt-1 text-xs font-medium text-amber-800">{t('partner.ai.connections.unverified', 'Unverified client')}</p>}
          </div>
          <ArrowRight aria-hidden className="mx-auto h-5 w-5 rotate-90 text-partner-border sm:rotate-0" />
          <div className="rounded-2xl bg-partner-ledger p-4 text-center">
            <Building2 aria-hidden className="mx-auto h-5 w-5 text-partner-forest" />
            <p className="mt-2 text-xs font-semibold uppercase tracking-[0.12em] text-partner-muted">{t('partner.ai.authorization.organization', 'Abroad organization')}</p>
            <p className="mt-1 truncate font-semibold text-partner-ink">{authorizationRequest.organizationName}</p>
          </div>
        </div>
        <p className="mt-4 text-center text-xs text-partner-muted">{t('partner.ai.authorization.redirect_notice', 'After approval, Abroad will return you to {destination}.', { destination: authorizationRequest.client.destinationHost })}</p>
      </section>

      {authorizationRequest.alreadyConnected && <div className="mt-5"><PartnerNotice tone="warning">{t('partner.ai.authorization.replace_notice', 'This client is already connected. Approval will immediately replace its existing grant with the permissions below.')}</PartnerNotice></div>}

      <section aria-labelledby="partner-ai-requested-permissions" className="partner-section mt-5">
        <h2 className="text-xl font-semibold text-partner-ink" id="partner-ai-requested-permissions">{t('partner.ai.authorization.permissions_title', 'Requested permissions')}</h2>
        <ul className="mt-5 space-y-3">
          {authorizationRequest.permissions.map(permission => (
            <li className="flex items-start gap-3 rounded-2xl border border-partner-border p-4" key={permission.scope}>
              <CheckCircle2 aria-hidden className="mt-0.5 h-5 w-5 shrink-0 text-partner-forest" />
              <div>
                <p className="font-semibold text-partner-ink">{permission.scope}</p>
                <p className="mt-1 text-sm leading-6 text-partner-muted">{permissionDescription(permission.scope)}</p>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="partner-ai-cannot-title" className="mt-5 rounded-[1.25rem] border border-partner-border bg-partner-ink p-6 text-white">
        <div className="flex items-center gap-3">
          <ShieldCheck aria-hidden className="h-5 w-5 text-partner-mint" />
          <h2 className="text-lg font-semibold" id="partner-ai-cannot-title">{t('partner.ai.authorization.cannot_title', 'This client cannot')}</h2>
        </div>
        <p className="mt-3 text-sm leading-6 text-white/75">{t('partner.ai.authorization.cannot_description', 'Create or accept transactions, move funds, issue refunds, trade, replay or change webhooks, manage API keys or secrets, manage users, submit KYC, or change production infrastructure.')}</p>
      </section>

      {error && <div aria-live="assertive" className="mt-5"><PartnerNotice tone="error">{error}</PartnerNotice></div>}

      <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        <button className="partner-button-secondary" disabled={pendingAction !== null} onClick={() => void resolve('DENIED')} type="button">
          {pendingAction === 'deny' && <LoaderCircle aria-hidden className="h-4 w-4 animate-spin" />}
          {t('partner.ai.authorization.deny', 'Deny')}
        </button>
        <button className="partner-button-primary" disabled={pendingAction !== null} onClick={() => void resolve('APPROVED')} type="button">
          {pendingAction === 'approve' && <LoaderCircle aria-hidden className="h-4 w-4 animate-spin" />}
          {t('partner.ai.authorization.approve', 'Approve access')}
        </button>
      </div>
      <p className="mt-4 text-center text-xs text-partner-muted">{t('partner.ai.authorization.expires_at', 'This request expires {date}.', { date: formatPartnerDateTime(authorizationRequest.expiresAt) })}</p>
    </div>
  )
}

export default PartnerAiAuthorization

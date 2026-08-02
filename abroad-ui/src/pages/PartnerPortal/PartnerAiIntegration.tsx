import { useTranslate } from '@tolgee/react'
import {
  Ban,
  BookOpenCheck,
  Cable,
  Check,
  CircleGauge,
  Clock3,
  Copy,
  ExternalLink,
  FileCheck2,
  ListChecks,
  LoaderCircle,
  RadioTower,
  RefreshCw,
  ShieldCheck,
  Unplug,
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

import type {
  PartnerAiConnection,
  PartnerAiConnectionStatus,
  PartnerAiProductEventInput,
  PartnerAiScope,
} from '../../services/partnerPortal/partnerPortalTypes'

import {
  listPartnerAiConnections,
  recordPartnerAiProductEvent,
  revokePartnerAiConnection,
  testPartnerAiConnection,
} from '../../services/partnerPortal/partnerPortalApi'
import {
  PARTNER_AI_DOCUMENTATION_URL,
  PARTNER_AI_MCP_RESOURCE_URL,
} from '../../services/partnerPortal/partnerAiConfiguration'
import { usePartnerPortalSession } from '../../services/partnerPortal/partnerPortalSessionStore'
import { formatPartnerDateTime } from './partnerPortalPresentation'
import { PartnerConfirmDialog, PartnerNotice } from './partnerPortalUi'

const entryPointFromLocation = (): PartnerAiProductEventInput['entryPoint'] => {
  const source = new URLSearchParams(window.location.search).get('from')
  const entryPoints: Readonly<Record<string, PartnerAiProductEventInput['entryPoint']>> = {
    'documentation': 'DOCUMENTATION',
    'integration-card': 'INTEGRATION_CARD',
    'navigation': 'NAVIGATION',
    'transaction-empty': 'TRANSACTION_EMPTY_STATE',
  }
  return source ? entryPoints[source] ?? 'DIRECT' : 'DIRECT'
}

const PartnerAiIntegration = () => {
  const { t } = useTranslate()
  const session = usePartnerPortalSession()
  const [connections, setConnections] = useState<null | PartnerAiConnection[]>(null)
  const [copyAnnouncement, setCopyAnnouncement] = useState<null | string>(null)
  const [copiedValue, setCopiedValue] = useState<null | string>(null)
  const [error, setError] = useState<null | string>(null)
  const [loading, setLoading] = useState(true)
  const [notice, setNotice] = useState<null | string>(null)
  const [pendingAction, setPendingAction] = useState<null | string>(null)
  const [revokeTarget, setRevokeTarget] = useState<null | PartnerAiConnection>(null)

  const canRevoke = session?.role === 'ADMIN' && session.mfaVerified

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setConnections(await listPartnerAiConnections())
    }
    catch (caught) {
      setError(caught instanceof Error
        ? caught.message
        : t('partner.ai.connections.load_error', 'Connected clients could not be loaded.'))
    }
    finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    void load()
    void recordPartnerAiProductEvent({
      clientCategory: 'GENERIC',
      entryPoint: entryPointFromLocation(),
      event: 'AI_INTEGRATION_PAGE_VIEWED',
      outcome: 'NOT_APPLICABLE',
    }).catch(() => undefined)
  }, [load])

  const copy = async (label: string, value: string, announcement: string) => {
    try {
      await navigator.clipboard.writeText(value)
      setCopyAnnouncement(announcement)
      setCopiedValue(label)
      window.setTimeout(() => {
        setCopiedValue(current => current === label ? null : current)
        setCopyAnnouncement(null)
      }, 1_500)
    }
    catch {
      setError(t('partner.ai.copy_error', 'Could not copy. Select the text and copy it manually.'))
    }
  }

  const testConnection = async (connection: PartnerAiConnection) => {
    setPendingAction(`test-${connection.id}`)
    setError(null)
    setNotice(null)
    try {
      const metadata = await testPartnerAiConnection(connection.id)
      setNotice(t(
        'partner.ai.connections.test_success',
        'Connection verified for {organization}. No transaction or financial operation was performed.',
        { organization: metadata.organizationName },
      ))
      void recordPartnerAiProductEvent({
        clientCategory: 'GENERIC',
        entryPoint: 'DIRECT',
        event: 'AI_CONNECTION_TESTED',
        outcome: 'SUCCEEDED',
      }).catch(() => undefined)
      await load()
    }
    catch (caught) {
      void recordPartnerAiProductEvent({
        clientCategory: 'GENERIC',
        entryPoint: 'DIRECT',
        event: 'AI_CONNECTION_TESTED',
        outcome: 'FAILED',
      }).catch(() => undefined)
      setError(caught instanceof Error
        ? caught.message
        : t('partner.ai.connections.test_error', 'The connection test could not be completed.'))
    }
    finally {
      setPendingAction(null)
    }
  }

  const confirmRevoke = async () => {
    if (!revokeTarget) return
    const target = revokeTarget
    setPendingAction(`revoke-${target.id}`)
    setError(null)
    try {
      await revokePartnerAiConnection(target.id)
      setNotice(t(
        'partner.ai.connections.revoke_success',
        '{client} can no longer access Abroad. Authorize it again to reconnect.',
        { client: target.clientName },
      ))
      setRevokeTarget(null)
      void recordPartnerAiProductEvent({
        clientCategory: 'GENERIC',
        entryPoint: 'DIRECT',
        event: 'AI_CONNECTION_REVOKED',
        outcome: 'REVOKED',
      }).catch(() => undefined)
      await load()
    }
    catch (caught) {
      void recordPartnerAiProductEvent({
        clientCategory: 'GENERIC',
        entryPoint: 'DIRECT',
        event: 'AI_CONNECTION_REVOKED',
        outcome: 'FAILED',
      }).catch(() => undefined)
      setError(caught instanceof Error
        ? caught.message
        : t('partner.ai.connections.revoke_error', 'The connection could not be revoked.'))
    }
    finally {
      setPendingAction(null)
    }
  }

  const scopeLabel = (scope: PartnerAiScope): string => ({
    'account:read': t('partner.ai.scope.account', 'Account metadata'),
    'docs:read': t('partner.ai.scope.docs', 'Documentation'),
    'offline_access': t('partner.ai.scope.offline', 'Ongoing access'),
    'requests:validate': t('partner.ai.scope.validation', 'Request validation'),
    'transactions:read': t('partner.ai.scope.transactions', 'Transactions'),
    'webhooks:read': t('partner.ai.scope.webhooks', 'Webhook diagnostics'),
  })[scope]

  const statusMeta = (status: PartnerAiConnectionStatus): { label: string, styles: string } => ({
    ACTIVE: {
      label: t('partner.ai.status.active', 'Active'),
      styles: 'bg-emerald-50 text-emerald-700',
    },
    EXPIRED: {
      label: t('partner.ai.status.expired', 'Expired'),
      styles: 'bg-amber-50 text-amber-800',
    },
    FAILED: {
      label: t('partner.ai.status.failed', 'Failed'),
      styles: 'bg-rose-50 text-rose-700',
    },
    REVOKED: {
      label: t('partner.ai.status.revoked', 'Revoked'),
      styles: 'bg-partner-ledger text-partner-muted',
    },
  })[status]

  const capabilityItems = [
    {
      description: t('partner.ai.capability.docs.description', 'Find public integration guidance and field requirements.'),
      icon: BookOpenCheck,
      title: t('partner.ai.capability.docs.title', 'Documentation'),
    },
    {
      description: t('partner.ai.capability.validation.description', 'Check a request body without sending it to Abroad.'),
      icon: FileCheck2,
      title: t('partner.ai.capability.validation.title', 'Request validation'),
    },
    {
      description: t('partner.ai.capability.transactions.description', 'Inspect your organization’s transaction ledger and status details.'),
      icon: ListChecks,
      title: t('partner.ai.capability.transactions.title', 'Transaction visibility'),
    },
    {
      description: t('partner.ai.capability.webhooks.description', 'Review bounded delivery health without payloads or secrets.'),
      icon: RadioTower,
      title: t('partner.ai.capability.webhooks.title', 'Webhook diagnostics'),
    },
  ]

  const prompts = [
    t('partner.ai.prompt.quote', 'Validate this create-quote request and explain any missing fields.'),
    t('partner.ai.prompt.transaction', 'Show the latest failed transactions and summarize their failure and refund status.'),
    t('partner.ai.prompt.webhook', 'Check webhook delivery health for the last 24 hours and suggest non-destructive troubleshooting steps.'),
  ]

  return (
    <>
      <header className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="partner-eyebrow">{t('partner.ai.eyebrow', 'Read-only partner context')}</p>
          <h1 className="mt-2 text-4xl font-semibold tracking-[-0.04em] text-partner-ink sm:text-5xl">
            {t('partner.ai.title', 'AI integrations')}
          </h1>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-partner-muted sm:text-base">
            {t('partner.ai.intro', 'Connect Abroad to compatible AI assistants for documentation, request validation, transaction visibility, and webhook diagnostics.')}
          </p>
        </div>
        <a className="partner-button-secondary" href={PARTNER_AI_DOCUMENTATION_URL} rel="noreferrer" target="_blank">
          {t('partner.ai.documentation', 'Read the setup guide')}
          <ExternalLink aria-hidden className="h-4 w-4" />
        </a>
      </header>
      <p aria-live="polite" className="sr-only">{copyAnnouncement ?? ''}</p>

      <section aria-labelledby="partner-ai-address-title" className="mt-8 grid gap-5 lg:grid-cols-[1.35fr_0.65fr]">
        <div className="partner-section">
          <div className="flex items-start gap-3">
            <div className="rounded-xl bg-partner-mint/60 p-2.5 text-partner-forest"><Cable aria-hidden className="h-5 w-5" /></div>
            <div>
              <h2 className="text-xl font-semibold text-partner-ink" id="partner-ai-address-title">{t('partner.ai.address.title', 'MCP connection address')}</h2>
              <p className="mt-1 text-sm text-partner-muted">{t('partner.ai.address.description', 'MCP is the underlying standard compatible AI clients use to connect securely.')}</p>
            </div>
          </div>
          <div className="mt-6 flex flex-col gap-3 rounded-2xl border border-partner-border bg-partner-ledger p-4 sm:flex-row sm:items-center">
            <code className="min-w-0 flex-1 break-all text-sm font-semibold text-partner-ink">{PARTNER_AI_MCP_RESOURCE_URL}</code>
            <button className="partner-button-secondary shrink-0" onClick={() => void copy('mcp-url', PARTNER_AI_MCP_RESOURCE_URL, t('partner.ai.copy_announcement', 'MCP connection address copied.'))} type="button">
              {copiedValue === 'mcp-url' ? <Check aria-hidden className="h-4 w-4" /> : <Copy aria-hidden className="h-4 w-4" />}
              {copiedValue === 'mcp-url' ? t('partner.ai.copied', 'Copied') : t('partner.ai.copy_address', 'Copy address')}
            </button>
          </div>
        </div>

        <div className="partner-section bg-partner-ink text-white">
          <div className="flex items-center gap-3">
            <ShieldCheck aria-hidden className="h-5 w-5 text-partner-mint" />
            <h2 className="text-lg font-semibold">{t('partner.ai.boundary.title', 'Read-only by design')}</h2>
          </div>
          <p className="mt-4 text-sm leading-6 text-white/75">
            {t('partner.ai.boundary.description', 'AI clients cannot create transactions, move funds, replay webhooks, rotate secrets, manage users, or change production settings.')}
          </p>
        </div>
      </section>

      <section aria-labelledby="partner-ai-permissions-title" className="mt-8">
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="partner-eyebrow">{t('partner.ai.permissions.eyebrow', 'Permission ledger')}</p>
            <h2 className="mt-2 text-2xl font-semibold tracking-[-0.025em] text-partner-ink" id="partner-ai-permissions-title">{t('partner.ai.permissions.title', 'What a connected assistant can help with')}</h2>
          </div>
        </div>
        <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {capabilityItems.map((item, index) => (
            <article className="partner-section relative overflow-hidden" key={item.title}>
              <span aria-hidden className="absolute right-5 top-4 font-mono text-xs text-partner-border">{String(index + 1).padStart(2, '0')}</span>
              <item.icon aria-hidden className="h-5 w-5 text-partner-forest" />
              <h3 className="mt-5 font-semibold text-partner-ink">{item.title}</h3>
              <p className="mt-2 text-sm leading-6 text-partner-muted">{item.description}</p>
            </article>
          ))}
        </div>
      </section>

      <div className="mt-8 grid gap-8 xl:grid-cols-[0.85fr_1.15fr]">
        <section aria-labelledby="partner-ai-setup-title" className="partner-section">
          <p className="partner-eyebrow">{t('partner.ai.setup.eyebrow', 'Compatible clients')}</p>
          <h2 className="mt-2 text-2xl font-semibold text-partner-ink" id="partner-ai-setup-title">{t('partner.ai.setup.title', 'Other MCP client')}</h2>
          <p className="mt-3 text-sm leading-6 text-partner-muted">{t('partner.ai.setup.description', 'Use a client that supports remote Streamable HTTP servers and browser-based OAuth with PKCE.')}</p>
          <ol className="mt-6 space-y-4">
            {[
              t('partner.ai.setup.step_one', 'Copy the MCP connection address above.'),
              t('partner.ai.setup.step_two', 'Add a remote MCP server in your AI client and paste the address.'),
              t('partner.ai.setup.step_three', 'Sign in to Abroad, review every requested permission, then approve or deny access.'),
            ].map((step, index) => (
              <li className="flex gap-3 text-sm leading-6 text-partner-ink" key={step}>
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-partner-mint font-mono text-xs font-semibold text-partner-forest">{index + 1}</span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
          <PartnerNotice tone="neutral">
            {t('partner.ai.setup.verified_note', 'Client-specific guides appear only after Abroad verifies that client’s complete connection flow. No unverified install links are shown.')}
          </PartnerNotice>
        </section>

        <section aria-labelledby="partner-ai-prompts-title" className="partner-section">
          <p className="partner-eyebrow">{t('partner.ai.prompts.eyebrow', 'Start with a concrete task')}</p>
          <h2 className="mt-2 text-2xl font-semibold text-partner-ink" id="partner-ai-prompts-title">{t('partner.ai.prompts.title', 'Example prompts')}</h2>
          <div className="mt-6 space-y-3">
            {prompts.map((prompt, index) => (
              <div className="flex items-start gap-3 rounded-2xl border border-partner-border bg-partner-ledger p-4" key={prompt}>
                <p className="min-w-0 flex-1 text-sm leading-6 text-partner-ink">
                  “
                  {prompt}
                  ”
                </p>
                <button aria-label={t('partner.ai.prompts.copy', 'Copy example prompt')} className="partner-icon-button shrink-0" onClick={() => void copy(`prompt-${index}`, prompt, t('partner.ai.prompts.copy_announcement', 'Example prompt copied.'))} type="button">
                  {copiedValue === `prompt-${index}` ? <Check aria-hidden className="h-4 w-4" /> : <Copy aria-hidden className="h-4 w-4" />}
                </button>
              </div>
            ))}
          </div>
        </section>
      </div>

      <section aria-labelledby="partner-ai-connections-title" className="mt-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="partner-eyebrow">{t('partner.ai.connections.eyebrow', 'Access control')}</p>
            <h2 className="mt-2 text-2xl font-semibold text-partner-ink" id="partner-ai-connections-title">{t('partner.ai.connections.title', 'Connected clients')}</h2>
            <p className="mt-2 text-sm text-partner-muted">{t('partner.ai.connections.description', 'Review granted permissions, verify access safely, or revoke a client immediately.')}</p>
          </div>
          <button className="partner-button-secondary" disabled={loading} onClick={() => void load()} type="button">
            <RefreshCw aria-hidden className={`h-4 w-4 ${loading ? 'animate-spin motion-reduce:animate-none' : ''}`} />
            {t('partner.ai.connections.refresh', 'Refresh')}
          </button>
        </div>

        {(error || notice) && (
          <div aria-live="polite" className="mt-5">
            <PartnerNotice tone={error ? 'error' : 'success'}>{error ?? notice}</PartnerNotice>
          </div>
        )}

        {loading && !connections && (
          <div aria-busy="true" className="partner-empty-state mt-5" role="status">
            <LoaderCircle aria-hidden className="h-5 w-5 animate-spin motion-reduce:animate-none" />
            {t('partner.ai.connections.loading', 'Loading connected clients…')}
          </div>
        )}

        {!loading && connections?.length === 0 && (
          <div className="partner-empty-state mt-5 flex-col text-center">
            <Unplug aria-hidden className="h-6 w-6 text-partner-forest" />
            <div>
              <p className="font-semibold text-partner-ink">{t('partner.ai.connections.empty_title', 'No AI clients connected')}</p>
              <p className="mt-1">{t('partner.ai.connections.empty_description', 'Add the MCP address to a compatible client to start the Abroad authorization flow.')}</p>
            </div>
          </div>
        )}

        {connections && connections.length > 0 && (
          <div aria-busy={loading} className="mt-5 space-y-3">
            {connections.map((connection) => {
              const status = statusMeta(connection.status)
              return (
                <article className="partner-section" key={connection.id}>
                  <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="truncate text-lg font-semibold text-partner-ink">{connection.clientName}</h3>
                        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${status.styles}`}>{status.label}</span>
                        {!connection.verifiedClient && <span className="rounded-full border border-partner-border px-2.5 py-1 text-xs font-medium text-partner-muted">{t('partner.ai.connections.unverified', 'Unverified client')}</span>}
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {connection.scopes.map(scope => <span className="rounded-lg bg-partner-ledger px-2.5 py-1 text-xs font-medium text-partner-muted" key={scope}>{scopeLabel(scope)}</span>)}
                      </div>
                      <dl className="mt-4 grid gap-3 text-xs text-partner-muted sm:grid-cols-3">
                        <div>
                          <dt className="font-semibold text-partner-ink">{t('partner.ai.connections.connected', 'Connected')}</dt>
                          <dd className="mt-1">{formatPartnerDateTime(connection.connectedAt)}</dd>
                        </div>
                        <div>
                          <dt className="font-semibold text-partner-ink">{t('partner.ai.connections.last_used', 'Last used')}</dt>
                          <dd className="mt-1">{connection.lastUsedAt ? formatPartnerDateTime(connection.lastUsedAt) : t('partner.ai.never', 'Never')}</dd>
                        </div>
                        <div>
                          <dt className="font-semibold text-partner-ink">{t('partner.ai.connections.expires', 'Expires')}</dt>
                          <dd className="mt-1">{formatPartnerDateTime(connection.expiresAt)}</dd>
                        </div>
                      </dl>
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-2">
                      <button
                        aria-label={t('partner.ai.connections.test_client', 'Test connection for {client}', { client: connection.clientName })}
                        className="partner-button-secondary"
                        disabled={connection.status !== 'ACTIVE' || pendingAction !== null}
                        onClick={() => void testConnection(connection)}
                        type="button"
                      >
                        {pendingAction === `test-${connection.id}` ? <LoaderCircle aria-hidden className="h-4 w-4 animate-spin" /> : <CircleGauge aria-hidden className="h-4 w-4" />}
                        {t('partner.ai.connections.test', 'Test connection')}
                      </button>
                      {connection.status === 'ACTIVE' && (
                        <button
                          aria-label={t('partner.ai.connections.revoke_client', 'Revoke {client}', { client: connection.clientName })}
                          className="partner-button-secondary text-rose-700"
                          disabled={!canRevoke || pendingAction !== null}
                          onClick={() => setRevokeTarget(connection)}
                          type="button"
                        >
                          <Ban aria-hidden className="h-4 w-4" />
                          {t('partner.ai.connections.revoke', 'Revoke')}
                        </button>
                      )}
                    </div>
                  </div>
                  {connection.status === 'EXPIRED' && (
                    <p className="mt-4 flex items-center gap-2 text-sm text-amber-800">
                      <Clock3 aria-hidden className="h-4 w-4" />
                      {t('partner.ai.connections.expired_help', 'Authorize this client again to restore access.')}
                    </p>
                  )}
                  {connection.status === 'REVOKED' && (
                    <p className="mt-4 flex items-center gap-2 text-sm text-partner-muted">
                      <Unplug aria-hidden className="h-4 w-4" />
                      {t('partner.ai.connections.revoked_help', 'All access and refresh tokens for this connection are invalid.')}
                    </p>
                  )}
                  {connection.status === 'FAILED' && (
                    <p className="mt-4 flex items-center gap-2 text-sm text-rose-700">
                      <Ban aria-hidden className="h-4 w-4" />
                      {t('partner.ai.connections.failed_help', 'Abroad disabled this connection after a security or protocol failure. Authorize it again.')}
                    </p>
                  )}
                </article>
              )
            })}
          </div>
        )}

        {session?.role === 'ADMIN' && !session.mfaVerified && (
          <div className="mt-5"><PartnerNotice tone="warning">{t('partner.ai.connections.mfa_revoke', 'Verify MFA to revoke connected clients or approve webhook diagnostics.')}</PartnerNotice></div>
        )}
        {session?.role !== 'ADMIN' && (
          <div className="mt-5"><PartnerNotice>{t('partner.ai.connections.admin_revoke', 'You can review connections. An organization administrator must approve or revoke access.')}</PartnerNotice></div>
        )}
      </section>

      {revokeTarget && (
        <PartnerConfirmDialog
          cancelLabel={t('partner.ai.revoke.cancel', 'Keep connection')}
          confirmLabel={pendingAction === `revoke-${revokeTarget.id}` ? t('partner.ai.revoke.revoking', 'Revoking…') : t('partner.ai.revoke.confirm', 'Revoke access')}
          description={t('partner.ai.revoke.description', '{client} will lose access immediately. It must be authorized again before it can read Abroad data.', { client: revokeTarget.clientName })}
          loading={pendingAction === `revoke-${revokeTarget.id}`}
          onCancel={() => setRevokeTarget(null)}
          onConfirm={() => void confirmRevoke()}
          title={t('partner.ai.revoke.title', 'Revoke this AI client?')}
        />
      )}
    </>
  )
}

export default PartnerAiIntegration

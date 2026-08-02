import type { FormEvent } from 'react'

import { useTranslate } from '@tolgee/react'
import {
  ArrowRight, Cable, CheckCircle2, CircleDashed, KeyRound, LoaderCircle, Plus, RadioTower, RefreshCw, RotateCcw, ShieldCheck, Trash2,
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

import type {
  PartnerApiKeyScope,
  PartnerPortalApiKeyList,
  PartnerPortalWebhookConfiguration,
} from '../../services/partnerPortal/partnerPortalTypes'

import {
  activatePartnerWebhook,
  createPartnerApiKey,
  discardPartnerWebhookDraft,
  getPartnerWebhookConfiguration,
  listPartnerApiKeys,
  revokePartnerApiKey,
  rotatePartnerApiKey,
  rotatePartnerWebhookSecret,
  stagePartnerWebhookUrl,
  testPartnerWebhookDraft,
} from '../../services/partnerPortal/partnerPortalApi'
import { usePartnerPortalSession } from '../../services/partnerPortal/partnerPortalSessionStore'
import { partnerApiKeyScopes } from '../../services/partnerPortal/partnerPortalTypes'
import { formatPartnerDateTime } from './partnerPortalPresentation'
import { OneTimeSecretDialog, PartnerNotice } from './partnerPortalUi'

const scopeLabels: Record<PartnerApiKeyScope, string> = {
  'kyc:read': 'Read KYC status',
  'kyc:write': 'Submit KYC data',
  'partner-users:read': 'Read partner users',
  'partner-users:write': 'Manage partner users',
  'telemetry:write': 'Send checkout telemetry',
  'transactions:read': 'Read transactions and liquidity',
  'transactions:write': 'Create and update transactions',
}

type RevealedSecret = {
  description: string
  label: string
  value: string
}

const PartnerPortalIntegration = () => {
  const { t } = useTranslate()
  const session = usePartnerPortalSession()
  const authorized = session?.role === 'ADMIN' && session.mfaVerified
  const [apiKeys, setApiKeys] = useState<null | PartnerPortalApiKeyList>(null)
  const [confirmRevokeId, setConfirmRevokeId] = useState<null | string>(null)
  const [error, setError] = useState<null | string>(null)
  const [expiresAt, setExpiresAt] = useState('')
  const [keyName, setKeyName] = useState('')
  const [loading, setLoading] = useState(true)
  const [pendingAction, setPendingAction] = useState<null | string>(null)
  const [scopes, setScopes] = useState<PartnerApiKeyScope[]>(['transactions:read', 'transactions:write'])
  const [secret, setSecret] = useState<null | RevealedSecret>(null)
  const [success, setSuccess] = useState<null | string>(null)
  const [webhook, setWebhook] = useState<null | PartnerPortalWebhookConfiguration>(null)
  const [webhookUrl, setWebhookUrl] = useState('')

  const load = useCallback(async () => {
    if (!authorized) {
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const [nextKeys, nextWebhook] = await Promise.all([listPartnerApiKeys(), getPartnerWebhookConfiguration()])
      setApiKeys(nextKeys)
      setWebhook(nextWebhook)
      setWebhookUrl(nextWebhook.pending?.url ?? nextWebhook.active.url ?? '')
    }
    catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load integration settings')
    }
    finally {
      setLoading(false)
    }
  }, [authorized])

  useEffect(() => {
    void load()
  }, [load])

  const run = async (action: string, operation: () => Promise<void>) => {
    setPendingAction(action)
    setError(null)
    setSuccess(null)
    try {
      await operation()
    }
    catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The integration change could not be completed')
    }
    finally {
      setPendingAction(null)
    }
  }

  const submitApiKey = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!keyName.trim() || scopes.length === 0) return
    await run('create-key', async () => {
      const result = await createPartnerApiKey({
        ...(expiresAt ? { expiresAt: new Date(expiresAt).toISOString() } : {}),
        name: keyName.trim(),
        scopes,
      })
      setSecret({
        description: `API key “${result.apiKey.name}” is active with the selected scopes.`,
        label: 'API key',
        value: result.secret,
      })
      setKeyName('')
      setExpiresAt('')
      setApiKeys(await listPartnerApiKeys())
    })
  }

  const toggleScope = (scope: PartnerApiKeyScope) => {
    setScopes(current => current.includes(scope)
      ? current.filter(item => item !== scope)
      : [...current, scope])
  }

  if (!authorized) {
    return (
      <div className="partner-empty-state min-h-64 flex-col text-center">
        <ShieldCheck aria-hidden className="h-7 w-7 text-partner-forest" />
        <div>
          <h1 className="text-xl font-semibold text-partner-ink">Administrator verification required</h1>
          <p className="mt-2 text-sm text-partner-muted">Only a workspace administrator with verified MFA can manage API keys and webhook credentials.</p>
        </div>
        <Link className="partner-button-primary" to="/partner/security">Open security settings</Link>
      </div>
    )
  }

  if (loading && !apiKeys && !webhook) {
    return (
      <div className="partner-empty-state">
        <LoaderCircle aria-hidden className="h-5 w-5 animate-spin" />
        Loading integration settings…
      </div>
    )
  }

  return (
    <>
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="partner-eyebrow">Secure connection</p>
          <h1 className="mt-2 text-4xl font-semibold tracking-[-0.04em] text-partner-ink sm:text-5xl">Integration</h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-partner-muted sm:text-base">Manage scoped API access and prove webhook changes before they become active.</p>
        </div>
        <button className="partner-button-secondary" disabled={loading || pendingAction !== null} onClick={() => void load()} type="button">
          <RefreshCw aria-hidden className="h-4 w-4" />
          Refresh
        </button>
      </header>

      {(error || success) && (
        <div aria-live="polite" className="mt-6">
          <PartnerNotice tone={error ? 'error' : 'success'}>{error ?? success}</PartnerNotice>
        </div>
      )}

      <section aria-labelledby="ai-integration-card-title" className="partner-section mt-8">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <div className="rounded-xl bg-partner-mint/60 p-2.5 text-partner-forest"><Cable aria-hidden className="h-5 w-5" /></div>
            <div>
              <p className="partner-eyebrow">{t('partner.ai.integration_card.eyebrow', 'Read-only connection')}</p>
              <h2 className="mt-1 text-xl font-semibold text-partner-ink" id="ai-integration-card-title">{t('partner.ai.integration_card.title', 'AI integrations')}</h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-partner-muted">{t('partner.ai.integration_card.description', 'Connect compatible AI assistants through Abroad sign-in—without sharing an API key or webhook secret.')}</p>
            </div>
          </div>
          <Link className="partner-button-secondary shrink-0" to="/partner/integration/ai?from=integration-card">
            {t('partner.ai.integration_card.action', 'Open AI integrations')}
            <ArrowRight aria-hidden className="h-4 w-4" />
          </Link>
        </div>
      </section>

      <div className="mt-8 grid gap-8 xl:grid-cols-[1fr_1.05fr]">
        <section aria-labelledby="api-keys-title" className="partner-section">
          <div className="flex items-start gap-3">
            <div className="rounded-xl bg-partner-mint/60 p-2.5 text-partner-forest"><KeyRound aria-hidden className="h-5 w-5" /></div>
            <div>
              <h2 className="text-xl font-semibold text-partner-ink" id="api-keys-title">API keys</h2>
              <p className="mt-1 text-sm text-partner-muted">Create one key per system and grant only the access it needs.</p>
            </div>
          </div>

          {apiKeys?.legacyKeyActive && <div className="mt-5"><PartnerNotice tone="warning">A legacy key is still active. Create a managed key, update your integration, then rotate the legacy credential with Abroad.</PartnerNotice></div>}

          <form className="mt-6 border-t border-partner-border pt-6" onSubmit={event => void submitApiKey(event)}>
            <div className="grid gap-4 sm:grid-cols-2">
              <label>
                <span className="partner-label">Key name</span>
                <input className="partner-input mt-2 w-full" maxLength={64} onChange={event => setKeyName(event.target.value)} placeholder="Production checkout" value={keyName} />
              </label>
              <label>
                <span className="partner-label">Expires (optional)</span>
                <input className="partner-input mt-2 w-full" onChange={event => setExpiresAt(event.target.value)} type="datetime-local" value={expiresAt} />
              </label>
            </div>
            <fieldset className="mt-5">
              <legend className="partner-label">Scopes</legend>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {partnerApiKeyScopes.map(scope => (
                  <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-partner-border p-3 text-sm text-partner-ink hover:bg-partner-ledger" key={scope}>
                    <input checked={scopes.includes(scope)} className="mt-0.5 accent-partner-forest" onChange={() => toggleScope(scope)} type="checkbox" />
                    <span>
                      <strong className="block font-semibold">{scopeLabels[scope]}</strong>
                      <span className="mt-0.5 block font-mono text-[0.6875rem] text-partner-muted">{scope}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
            <button className="partner-button-primary mt-5" disabled={!keyName.trim() || scopes.length === 0 || pendingAction !== null} type="submit">
              {pendingAction === 'create-key' ? <LoaderCircle aria-hidden className="h-4 w-4 animate-spin" /> : <Plus aria-hidden className="h-4 w-4" />}
              Create API key
            </button>
          </form>

          <div className="mt-7 space-y-3 border-t border-partner-border pt-6">
            {apiKeys?.items.length === 0 && <PartnerNotice>No managed API keys yet.</PartnerNotice>}
            {apiKeys?.items.map(apiKey => (
              <article className="rounded-2xl border border-partner-border p-4" key={apiKey.id}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-semibold text-partner-ink">{apiKey.name}</h3>
                      <span className={`rounded-full px-2 py-0.5 text-[0.6875rem] font-semibold ${apiKey.status === 'ACTIVE' ? 'bg-emerald-50 text-emerald-700' : 'bg-partner-ledger text-partner-muted'}`}>{apiKey.status}</span>
                    </div>
                    <p className="mt-1 font-mono text-xs text-partner-muted">
                      {apiKey.displayPrefix}
                      ••••
                    </p>
                  </div>
                  {apiKey.status === 'ACTIVE' && (
                    <div className="flex flex-wrap gap-2">
                      <button
                        className="partner-button-secondary min-h-9 px-3 py-1.5 text-xs"
                        disabled={pendingAction !== null}
                        onClick={() => void run(`rotate-${apiKey.id}`, async () => {
                          const result = await rotatePartnerApiKey(apiKey.id)
                          setSecret({ description: `The prior key remains valid for at most 24 hours. Update your integration now.`, label: `Rotated API key for ${apiKey.name}`, value: result.secret })
                          setApiKeys(await listPartnerApiKeys())
                        })}
                        type="button"
                      >
                        <RotateCcw aria-hidden className="h-3.5 w-3.5" />
                        Rotate
                      </button>
                      {confirmRevokeId === apiKey.id
                        ? (
                            <button
                              className="min-h-9 rounded-xl bg-rose-700 px-3 text-xs font-semibold text-white"
                              disabled={pendingAction !== null}
                              onClick={() => void run(`revoke-${apiKey.id}`, async () => {
                                await revokePartnerApiKey(apiKey.id)
                                setConfirmRevokeId(null)
                                setApiKeys(await listPartnerApiKeys())
                                setSuccess('API key revoked immediately.')
                              })}
                              type="button"
                            >
                              Confirm revoke
                            </button>
                          )
                        : <button aria-label={`Revoke ${apiKey.name}`} className="partner-icon-button" onClick={() => setConfirmRevokeId(apiKey.id)} type="button"><Trash2 aria-hidden className="h-4 w-4" /></button>}
                    </div>
                  )}
                </div>
                <p className="mt-3 text-xs text-partner-muted">{apiKey.scopes.join(' · ')}</p>
                <p className="mt-2 text-xs text-partner-muted">{`Created ${formatPartnerDateTime(apiKey.createdAt)} · Last used ${apiKey.lastUsedAt ? formatPartnerDateTime(apiKey.lastUsedAt) : 'never'}${apiKey.expiresAt ? ` · Expires ${formatPartnerDateTime(apiKey.expiresAt)}` : ''}`}</p>
              </article>
            ))}
          </div>
        </section>

        <section aria-labelledby="webhook-title" className="partner-section">
          <div className="flex items-start gap-3">
            <div className="rounded-xl bg-partner-mint/60 p-2.5 text-partner-forest"><RadioTower aria-hidden className="h-5 w-5" /></div>
            <div>
              <h2 className="text-xl font-semibold text-partner-ink" id="webhook-title">Webhook endpoint</h2>
              <p className="mt-1 text-sm text-partner-muted">Stage a URL or secret, send one test, then activate the exact tested revision.</p>
            </div>
          </div>

          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            <div className="rounded-2xl bg-partner-ledger p-4">
              <p className="partner-label">Active</p>
              <p className="mt-2 break-all text-sm font-semibold text-partner-ink">{webhook?.active.url ?? 'Not configured'}</p>
              <p className="mt-2 text-xs text-partner-muted">{webhook?.active.managedSecret ? `Managed secret ${webhook.active.secretPrefix ?? ''} · v${webhook.active.version}` : 'Legacy signing secret'}</p>
            </div>
            <div className="rounded-2xl border border-dashed border-partner-border p-4">
              <p className="partner-label">Draft</p>
              <p className="mt-2 break-all text-sm font-semibold text-partner-ink">{webhook?.pending?.url ?? 'No pending changes'}</p>
              {webhook?.pending && <p className="mt-2 text-xs text-partner-muted">{`Revision ${webhook.pending.revision}${webhook.pending.rotatesSecret ? ' · secret rotation staged' : ''}`}</p>}
            </div>
          </div>

          <form
            className="mt-6"
            onSubmit={(event) => {
              event.preventDefault()
              void run('stage-url', async () => {
                const configuration = await stagePartnerWebhookUrl(webhookUrl)
                setWebhook(configuration)
                setSuccess('Webhook URL staged. Test this draft before activation.')
              })
            }}
          >
            <label className="partner-label" htmlFor="partner-webhook-url">HTTPS endpoint</label>
            <div className="mt-2 flex flex-col gap-2 sm:flex-row">
              <input className="partner-input w-full sm:min-w-0 sm:flex-1" id="partner-webhook-url" onChange={event => setWebhookUrl(event.target.value)} placeholder="https://api.example.com/abroad/webhook" type="url" value={webhookUrl} />
              <button className="partner-button-secondary" disabled={!webhookUrl.trim() || pendingAction !== null} type="submit">Stage URL</button>
            </div>
          </form>

          {webhook?.pending?.lastTest && (
            <div className="mt-5 rounded-2xl border border-partner-border p-4">
              <div className="flex items-start gap-3">
                {webhook.pending.lastTest.status === 'DELIVERED' ? <CheckCircle2 aria-hidden className="h-5 w-5 text-emerald-600" /> : <CircleDashed aria-hidden className="h-5 w-5 text-rose-600" />}
                <div>
                  <p className="text-sm font-semibold text-partner-ink">{webhook.pending.lastTest.status === 'DELIVERED' ? 'Draft test delivered' : 'Draft test failed'}</p>
                  <p className="mt-1 text-xs text-partner-muted">{`${formatPartnerDateTime(webhook.pending.lastTest.attemptedAt)} · HTTP ${webhook.pending.lastTest.httpStatus ?? 'unavailable'} · ${webhook.pending.lastTest.durationMs ?? '—'} ms${webhook.pending.lastTest.failureCode ? ` · ${webhook.pending.lastTest.failureCode}` : ''}`}</p>
                </div>
              </div>
            </div>
          )}

          <div className="mt-6 flex flex-wrap gap-2 border-t border-partner-border pt-6">
            <button
              className="partner-button-secondary"
              disabled={(!webhook?.active.url && !webhook?.pending?.url) || pendingAction !== null}
              onClick={() => void run('rotate-webhook-secret', async () => {
                const result = await rotatePartnerWebhookSecret()
                setWebhook(result.configuration)
                setSecret({ description: 'Configure this signing secret at your endpoint before testing the draft.', label: 'Webhook signing secret', value: result.secret })
              })}
              type="button"
            >
              <ShieldCheck aria-hidden className="h-4 w-4" />
              Rotate secret
            </button>
            <button
              className="partner-button-secondary"
              disabled={!webhook?.pending || pendingAction !== null}
              onClick={() => void run('test-webhook', async () => {
                await testPartnerWebhookDraft()
                setWebhook(await getPartnerWebhookConfiguration())
              })}
              type="button"
            >
              Send test
            </button>
            <button
              className="partner-button-primary"
              disabled={webhook?.pending?.lastTest?.status !== 'DELIVERED' || pendingAction !== null}
              onClick={() => void run('activate-webhook', async () => {
                setWebhook(await activatePartnerWebhook())
                setSuccess('The tested webhook draft is now active.')
              })}
              type="button"
            >
              Activate tested draft
            </button>
            <button
              className="partner-button-secondary"
              disabled={!webhook?.pending || pendingAction !== null}
              onClick={() => void run('discard-webhook', async () => {
                setWebhook(await discardPartnerWebhookDraft())
                setWebhookUrl(webhook?.active.url ?? '')
              })}
              type="button"
            >
              Discard draft
            </button>
          </div>
        </section>
      </div>

      {secret && <OneTimeSecretDialog description={secret.description} label={secret.label} onClose={() => setSecret(null)} secret={secret.value} />}
    </>
  )
}

export default PartnerPortalIntegration

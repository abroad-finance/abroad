import {
  BookOpenCheck,
  ExternalLink,
  Plus,
  ShieldCheck,
} from 'lucide-react'
import {
  useCallback,
  useEffect,
  useState,
} from 'react'

import type {
  OpsIntegration,
  OpsIntegrationCatalog,
  OpsIntegrationInput,
  OpsRunbook,
  OpsRunbookInput,
} from '../../services/admin/integrationTypes'

import {
  createOpsIntegration,
  createOpsRunbook,
  getOpsIntegrationCatalog,
  updateOpsIntegration,
  updateOpsRunbook,
} from '../../services/admin/integrationAdminApi'
import { useOpsApiKey, useOpsSession } from '../../services/admin/opsAuthStore'
import {
  formatDateTime,
  humanizeStatus,
  OpsDialog,
  OpsEmptyState,
  OpsField,
  OpsLoading,
  OpsPageShell,
  OpsStatusBadge,
} from './shared'
import { isOpsMutationCancelledError, useOpsMutation } from './shared/opsMutationContext'

type IntegrationEditor = {
  id?: string
  input: OpsIntegrationInput
  version?: number
}

type RunbookEditor = {
  id?: string
  input: OpsRunbookInput
  version?: number
}

const emptyIntegration = (): IntegrationEditor => ({
  input: {
    configuration: {
      destinationLabel: '', eventKinds: [], healthcheckName: '', provider: '',
    },
    description: '',
    kind: 'NOTIFICATION',
    name: '',
    status: 'ACTIVE',
  },
})

const emptyRunbook = (): RunbookEditor => ({
  input: {
    active: true,
    description: '',
    incidentKinds: [],
    name: '',
    slug: '',
    url: '',
  },
})

const integrationTone = (status: OpsIntegration['status']) => {
  if (status === 'ACTIVE') return 'success' as const
  if (status === 'DEGRADED') return 'warning' as const
  return 'neutral' as const
}

const OpsIntegrations = () => {
  const [catalog, setCatalog] = useState<null | OpsIntegrationCatalog>(null)
  const [integrationEditor, setIntegrationEditor] = useState<IntegrationEditor | null>(null)
  const [runbookEditor, setRunbookEditor] = useState<null | RunbookEditor>(null)
  const [eventsText, setEventsText] = useState('')
  const [kindsText, setKindsText] = useState('')
  const [loading, setLoading] = useState(false)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<null | string>(null)
  const isAuthenticated = useOpsApiKey()
  const session = useOpsSession()
  const canManage = Boolean(session?.kind === 'ops_user' && session.permissions.includes('administration:integrations'))
  const { requestMutation } = useOpsMutation()

  const load = useCallback(async () => {
    if (!isAuthenticated) return
    setLoading(true)
    setError(null)
    try {
      setCatalog(await getOpsIntegrationCatalog())
    }
    catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Integration metadata could not be loaded')
    }
    finally {
      setLoading(false)
    }
  }, [isAuthenticated])

  useEffect(() => {
    void load()
  }, [load])

  const editIntegration = (integration: OpsIntegration): void => {
    setEventsText((integration.configuration.eventKinds ?? []).join(', '))
    setIntegrationEditor({
      id: integration.id,
      input: {
        configuration: integration.configuration,
        description: integration.description,
        kind: integration.kind,
        name: integration.name,
        status: integration.status,
      },
      version: integration.version,
    })
  }

  const editRunbook = (runbook: OpsRunbook): void => {
    setKindsText(runbook.incidentKinds.join(', '))
    setRunbookEditor({
      id: runbook.id,
      input: {
        active: runbook.active,
        description: runbook.description,
        incidentKinds: runbook.incidentKinds,
        name: runbook.name,
        slug: runbook.slug,
        url: runbook.url,
      },
      version: runbook.version,
    })
  }

  const saveIntegration = async (): Promise<void> => {
    if (!integrationEditor) return
    const input: OpsIntegrationInput = {
      ...integrationEditor.input,
      configuration: {
        ...integrationEditor.input.configuration,
        eventKinds: eventsText.split(',').map(value => value.trim()).filter(Boolean),
      },
    }
    setWorking(true)
    setError(null)
    try {
      await requestMutation({
        action: integrationEditor.id ? 'integration.update' : 'integration.create',
        execute: mutation => integrationEditor.id
          ? updateOpsIntegration(integrationEditor.id, input, mutation)
          : createOpsIntegration(input, mutation),
        expectedVersion: integrationEditor.version,
        resourceLabel: input.name,
        title: integrationEditor.id ? 'Update system integration' : 'Create system integration',
      })
      setIntegrationEditor(null)
      await load()
    }
    catch (saveError) {
      if (!isOpsMutationCancelledError(saveError)) setError(saveError instanceof Error ? saveError.message : 'Integration could not be saved')
    }
    finally {
      setWorking(false)
    }
  }

  const saveRunbook = async (): Promise<void> => {
    if (!runbookEditor) return
    const input: OpsRunbookInput = {
      ...runbookEditor.input,
      incidentKinds: kindsText.split(',').map(value => value.trim().toUpperCase()).filter(Boolean),
    }
    setWorking(true)
    setError(null)
    try {
      await requestMutation({
        action: runbookEditor.id ? 'runbook.update' : 'runbook.create',
        execute: mutation => runbookEditor.id
          ? updateOpsRunbook(runbookEditor.id, input, mutation)
          : createOpsRunbook(input, mutation),
        expectedVersion: runbookEditor.version,
        resourceLabel: input.name,
        title: runbookEditor.id ? 'Update incident runbook' : 'Create incident runbook',
      })
      setRunbookEditor(null)
      await load()
    }
    catch (saveError) {
      if (!isOpsMutationCancelledError(saveError)) setError(saveError instanceof Error ? saveError.message : 'Runbook could not be saved')
    }
    finally {
      setWorking(false)
    }
  }

  return (
    <OpsPageShell
      actions={canManage
        ? (
            <div className="flex flex-wrap gap-2">
              <button
                className="ops-btn-neutral"
                onClick={() => {
                  setKindsText('')
                  setRunbookEditor(emptyRunbook())
                }}
                type="button"
              >
                <BookOpenCheck aria-hidden size={17} />
                New runbook
              </button>
              <button
                className="ops-btn-primary"
                onClick={() => {
                  setEventsText('')
                  setIntegrationEditor(emptyIntegration())
                }}
                type="button"
              >
                <Plus aria-hidden size={17} />
                New integration
              </button>
            </div>
          )
        : undefined}
      error={error}
      eyebrow="Administration"
      keyRequiredMessage="Sign in to review system integrations."
      subtitle="Non-secret provider, webhook, notification, escalation, and runbook metadata. Credentials and destination URLs are intentionally never displayed or stored here."
      title="System Integrations"
    >
      {catalog && (
        <div className={loading ? 'opacity-60' : ''}>
          <section aria-labelledby="integration-health-title" className="mt-6">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold text-ops-text" id="integration-health-title">Delivery and provider health</h2>
              <button className="ops-btn-ghost" disabled={loading} onClick={() => void load()} type="button">Refresh</button>
            </div>
            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              {catalog.integrations.map(integration => (
                <article className="ops-card p-5" key={integration.id}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <OpsStatusBadge label={humanizeStatus(integration.status)} tone={integrationTone(integration.status)} />
                        <span className="text-xs font-semibold uppercase tracking-wide text-ops-muted">{humanizeStatus(integration.kind)}</span>
                      </div>
                      <h3 className="mt-3 text-base font-semibold text-ops-text">{integration.name}</h3>
                      <p className="mt-1 text-sm leading-6 text-ops-muted">{integration.description}</p>
                    </div>
                    {canManage && <button className="ops-btn-ghost shrink-0" onClick={() => editIntegration(integration)} type="button">Edit</button>}
                  </div>
                  <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
                    <div>
                      <dt className="text-xs text-ops-muted">Public destination alias</dt>
                      <dd className="mt-0.5 font-medium">{integration.configuration.destinationLabel ?? 'Not configured'}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-ops-muted">Provider</dt>
                      <dd className="mt-0.5 font-medium">{integration.configuration.provider ?? 'Internal'}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-ops-muted">Last checked</dt>
                      <dd className="mt-0.5 font-medium">{formatDateTime(integration.lastCheckedAt)}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-ops-muted">Last safe error code</dt>
                      <dd className="mt-0.5 font-mono text-xs">{integration.lastErrorCode ?? 'None'}</dd>
                    </div>
                  </dl>
                  {(integration.configuration.eventKinds?.length ?? 0) > 0 && (
                    <div className="mt-4 flex flex-wrap gap-2">
                      {integration.configuration.eventKinds?.map(event => <span className="rounded-full border border-ops-border px-2 py-1 text-xs text-ops-muted" key={event}>{event}</span>)}
                    </div>
                  )}
                </article>
              ))}
              {catalog.integrations.length === 0 && <OpsEmptyState>No system integrations have been registered.</OpsEmptyState>}
            </div>
          </section>

          <section aria-labelledby="runbooks-title" className="mt-10">
            <h2 className="text-lg font-semibold text-ops-text" id="runbooks-title">Incident runbooks</h2>
            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              {catalog.runbooks.map(runbook => (
                <article className="ops-card p-5" key={runbook.id}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2"><OpsStatusBadge label={runbook.active ? 'Active' : 'Inactive'} tone={runbook.active ? 'success' : 'neutral'} /></div>
                      <h3 className="mt-3 text-base font-semibold text-ops-text">{runbook.name}</h3>
                      <p className="mt-1 text-sm leading-6 text-ops-muted">{runbook.description}</p>
                    </div>
                    {canManage && <button className="ops-btn-ghost shrink-0" onClick={() => editRunbook(runbook)} type="button">Edit</button>}
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {runbook.incidentKinds.map(kind => <span className="rounded-full border border-ops-border px-2 py-1 text-xs text-ops-muted" key={kind}>{humanizeStatus(kind)}</span>)}
                  </div>
                  <a className="mt-4 inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-ops-brand" href={runbook.url} rel="noreferrer" target="_blank">
                    Open runbook
                    <ExternalLink aria-hidden size={14} />
                  </a>
                </article>
              ))}
              {catalog.runbooks.length === 0 && <OpsEmptyState>No incident runbooks have been published.</OpsEmptyState>}
            </div>
          </section>

          <div className="mt-8 flex items-start gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
            <ShieldCheck aria-hidden className="mt-0.5 shrink-0" size={19} />
            This catalog accepts public aliases and safe health codes only. Secrets, tokens, endpoint URLs, and credential-bearing runbook links are rejected by the server.
          </div>
        </div>
      )}
      {loading && !catalog && <OpsLoading className="mt-8" label="Loading system integration health…" />}

      {integrationEditor && (
        <OpsDialog description="Only public aliases and operational categories are accepted. Configure credentials in Secret Manager, outside this catalog." eyebrow="Administration" onClose={() => setIntegrationEditor(null)} title={integrationEditor.id ? 'Edit integration metadata' : 'Register integration metadata'}>
          <div className="space-y-4">
            <OpsField label="Name"><input autoFocus className="ops-input" maxLength={120} name="integration-name" onChange={event => setIntegrationEditor(current => current && ({ ...current, input: { ...current.input, name: event.target.value } }))} value={integrationEditor.input.name} /></OpsField>
            <div className="grid gap-4 sm:grid-cols-2">
              <OpsField label="Kind">
                <select className="ops-input" name="integration-kind" onChange={event => setIntegrationEditor(current => current && ({ ...current, input: { ...current.input, kind: event.target.value as OpsIntegrationInput['kind'] } }))} value={integrationEditor.input.kind}>
                  {[
                    'NOTIFICATION',
                    'PROVIDER',
                    'WEBHOOK',
                    'RUNBOOK',
                  ].map(kind => <option key={kind} value={kind}>{humanizeStatus(kind)}</option>)}
                </select>
              </OpsField>
              <OpsField label="Health state">
                <select className="ops-input" name="integration-status" onChange={event => setIntegrationEditor(current => current && ({ ...current, input: { ...current.input, status: event.target.value as OpsIntegrationInput['status'] } }))} value={integrationEditor.input.status}>
                  {[
                    'ACTIVE',
                    'DEGRADED',
                    'DISABLED',
                  ].map(status => <option key={status} value={status}>{humanizeStatus(status)}</option>)}
                </select>
              </OpsField>
            </div>
            <OpsField label="Description"><textarea className="ops-input min-h-24" maxLength={1_000} name="integration-description" onChange={event => setIntegrationEditor(current => current && ({ ...current, input: { ...current.input, description: event.target.value } }))} value={integrationEditor.input.description} /></OpsField>
            <div className="grid gap-4 sm:grid-cols-2">
              <OpsField hint="Example: #ops-incidents; never paste a URL." label="Destination alias"><input className="ops-input" maxLength={120} name="integration-destination" onChange={event => setIntegrationEditor(current => current && ({ ...current, input: { ...current.input, configuration: { ...current.input.configuration, destinationLabel: event.target.value } } }))} value={integrationEditor.input.configuration.destinationLabel ?? ''} /></OpsField>
              <OpsField label="Provider label"><input className="ops-input" maxLength={120} name="integration-provider" onChange={event => setIntegrationEditor(current => current && ({ ...current, input: { ...current.input, configuration: { ...current.input.configuration, provider: event.target.value } } }))} value={integrationEditor.input.configuration.provider ?? ''} /></OpsField>
            </div>
            <OpsField hint="Comma-separated safe event categories." label="Event categories"><input className="ops-input" name="integration-events" onChange={event => setEventsText(event.target.value)} value={eventsText} /></OpsField>
            <OpsField label="Healthcheck alias"><input className="ops-input" maxLength={120} name="integration-healthcheck" onChange={event => setIntegrationEditor(current => current && ({ ...current, input: { ...current.input, configuration: { ...current.input.configuration, healthcheckName: event.target.value } } }))} value={integrationEditor.input.configuration.healthcheckName ?? ''} /></OpsField>
            <div className="flex flex-col-reverse gap-2 border-t border-ops-border pt-4 sm:flex-row sm:justify-end">
              <button className="ops-btn-neutral" onClick={() => setIntegrationEditor(null)} type="button">Cancel</button>
              <button className="ops-btn-primary" disabled={working || !integrationEditor.input.name.trim() || !integrationEditor.input.description.trim()} onClick={() => void saveIntegration()} type="button">Continue to protected save</button>
            </div>
          </div>
        </OpsDialog>
      )}

      {runbookEditor && (
        <OpsDialog description="Runbook links must be HTTPS without embedded credentials, query parameters, or fragments." eyebrow="Administration" onClose={() => setRunbookEditor(null)} title={runbookEditor.id ? 'Edit incident runbook' : 'Publish incident runbook'}>
          <div className="space-y-4">
            <OpsField label="Name"><input autoFocus className="ops-input" maxLength={120} name="runbook-name" onChange={event => setRunbookEditor(current => current && ({ ...current, input: { ...current.input, name: event.target.value } }))} value={runbookEditor.input.name} /></OpsField>
            <OpsField label="Slug"><input className="ops-input" maxLength={100} name="runbook-slug" onChange={event => setRunbookEditor(current => current && ({ ...current, input: { ...current.input, slug: event.target.value } }))} placeholder="provider-liquidity" value={runbookEditor.input.slug} /></OpsField>
            <OpsField label="Description"><textarea className="ops-input min-h-24" maxLength={1_000} name="runbook-description" onChange={event => setRunbookEditor(current => current && ({ ...current, input: { ...current.input, description: event.target.value } }))} value={runbookEditor.input.description} /></OpsField>
            <OpsField label="HTTPS runbook URL"><input className="ops-input" name="runbook-url" onChange={event => setRunbookEditor(current => current && ({ ...current, input: { ...current.input, url: event.target.value } }))} placeholder="https://docs.example.com/runbooks/provider-liquidity" type="url" value={runbookEditor.input.url} /></OpsField>
            <OpsField hint="Comma-separated detector kinds such as LIQUIDITY, PROVIDER, BRIDGE." label="Incident kinds"><input className="ops-input" name="runbook-kinds" onChange={event => setKindsText(event.target.value)} value={kindsText} /></OpsField>
            <label className="flex min-h-11 items-center gap-3 rounded-xl border border-ops-border p-3 text-sm">
              <input checked={runbookEditor.input.active} name="runbook-active" onChange={event => setRunbookEditor(current => current && ({ ...current, input: { ...current.input, active: event.target.checked } }))} type="checkbox" />
              Show this runbook on matching incidents
            </label>
            <div className="flex flex-col-reverse gap-2 border-t border-ops-border pt-4 sm:flex-row sm:justify-end">
              <button className="ops-btn-neutral" onClick={() => setRunbookEditor(null)} type="button">Cancel</button>
              <button className="ops-btn-primary" disabled={working || !runbookEditor.input.name.trim() || !runbookEditor.input.url.trim() || !kindsText.trim()} onClick={() => void saveRunbook()} type="button">Continue to protected save</button>
            </div>
          </div>
        </OpsDialog>
      )}
    </OpsPageShell>
  )
}

export default OpsIntegrations

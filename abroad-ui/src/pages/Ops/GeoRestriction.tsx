import { Globe } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

import type { OpsGeoRestriction } from '../../services/admin/geoRestrictionTypes'

import { getGeoRestriction, updateGeoRestriction } from '../../services/admin/geoRestrictionAdminApi'
import { useOpsSession } from '../../services/admin/opsAuthStore'
import {
  formatDateTime,
  OpsBanner,
  OpsLoading,
  OpsPageShell,
  OpsStatusBadge,
} from './shared'
import { isOpsMutationCancelledError, useOpsMutation } from './shared/opsMutationContext'

// Serving instances cache the setting, so a toggle is not instantaneous fleet
// wide. The number mirrors CACHE_TTL_MS in the server's GeoRestrictionService.
const PROPAGATION_SECONDS = 30

const regionNames = new Intl.DisplayNames(['en'], { type: 'region' })

const countryName = (code: string): string => regionNames.of(code) ?? code

const GeoRestriction = () => {
  const session = useOpsSession()
  const { requestMutation } = useOpsMutation()
  const [setting, setSetting] = useState<null | OpsGeoRestriction>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<null | string>(null)
  const canRead = Boolean(session?.permissions.includes('configuration:read'))
  const canManage = Boolean(session?.permissions.includes('configuration:manage'))

  const load = useCallback(async () => {
    if (!canRead) {
      setSetting(null)
      return
    }
    setLoading(true)
    setError(null)
    try {
      setSetting(await getGeoRestriction())
    }
    catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load the region restriction')
    }
    finally {
      setLoading(false)
    }
  }, [canRead])

  useEffect(() => {
    void load()
  }, [load])

  const handleToggle = async (current: OpsGeoRestriction): Promise<void> => {
    const enabled = !current.enabled
    setSaving(true)
    setError(null)
    try {
      const updated = await requestMutation({
        action: 'configuration.geo_restriction.update',
        execute: mutation => updateGeoRestriction({ enabled }, mutation),
        expectedVersion: current.version,
        resourceLabel: `Region restriction · ${enabled ? 'enabled' : 'disabled'}`,
        title: enabled ? 'Enable the region restriction' : 'Disable the region restriction',
      })
      setSetting(updated)
    }
    catch (toggleError) {
      if (isOpsMutationCancelledError(toggleError)) return
      setError(toggleError instanceof Error ? toggleError.message : 'Failed to update the region restriction')
    }
    finally {
      setSaving(false)
    }
  }

  return (
    <OpsPageShell
      actions={(
        <button className="ops-btn-ghost" disabled={!canRead || loading} onClick={() => void load()} type="button">
          Refresh
        </button>
      )}
      error={error}
      eyebrow="Configuration"
      subtitle="Controls whether visitors geolocated to a restricted country are refused the product and shown the unavailable-in-region page."
      title="Region Restriction"
    >
      {!canRead && session && (
        <OpsBanner className="mt-6" variant="warning">
          Your current role cannot view the region restriction.
        </OpsBanner>
      )}

      {canRead && loading && <div className="mt-6"><OpsLoading label="Loading the region restriction…" /></div>}

      {canRead && !loading && setting && (
        <section aria-labelledby="geo-restriction-state" className="ops-card mt-8 p-5">
          <div className="flex items-start gap-3">
            <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-ops-brand/10 text-ops-brand">
              <Globe aria-hidden size={20} />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-semibold text-ops-text" id="geo-restriction-state">
                  Restricted regions
                </h2>
                <OpsStatusBadge tone={setting.enabled ? 'success' : 'danger'}>
                  {setting.enabled ? 'Enforced' : 'Not enforced'}
                </OpsStatusBadge>
              </div>
              <p className="mt-1 text-sm text-ops-muted">
                {setting.enabled
                  ? 'Visitors geolocated to a restricted country are refused.'
                  : 'Every region can reach the product, including restricted countries.'}
              </p>
            </div>
          </div>

          <dl className="mt-5 grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-ops-muted">Restricted countries</dt>
              <dd className="mt-1 flex flex-wrap gap-2">
                {setting.restrictedCountries.map(code => (
                  <span className="rounded-full border border-ops-border bg-white px-3 py-1 text-xs text-ops-text" key={code}>
                    {code}
                    {' · '}
                    {countryName(code)}
                  </span>
                ))}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-ops-muted">Last changed</dt>
              <dd className="mt-1 text-ops-text">{formatDateTime(setting.updatedAt)}</dd>
            </div>
          </dl>

          <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-ops-border pt-5">
            <button
              className={setting.enabled ? 'ops-btn-danger' : 'ops-btn-primary'}
              disabled={!canManage || saving}
              onClick={() => void handleToggle(setting)}
              type="button"
            >
              {saving
                ? 'Updating…'
                : setting.enabled ? 'Disable restriction' : 'Enable restriction'}
            </button>
            <p className="text-xs text-ops-muted">
              Takes effect for every serving instance within
              {' '}
              {PROPAGATION_SECONDS}
              {' '}
              seconds.
            </p>
          </div>

          {!canManage && (
            <OpsBanner className="mt-5" variant="warning">
              Your current role can view this setting but cannot change it.
            </OpsBanner>
          )}
        </section>
      )}
    </OpsPageShell>
  )
}

export default GeoRestriction

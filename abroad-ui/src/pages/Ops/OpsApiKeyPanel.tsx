import { useEffect, useState } from 'react'

import { clearOpsApiKey, setOpsApiKey, useOpsApiKey } from '../../services/admin/opsAuthStore'
import { OpsStatusBadge } from './shared/opsStatus'

const OpsApiKeyPanel = () => {
  const apiKey = useOpsApiKey()
  const [draft, setDraft] = useState(apiKey ?? '')

  useEffect(() => {
    setDraft(apiKey ?? '')
  }, [apiKey])

  const isReady = Boolean(apiKey)
  const trimmedDraft = draft.trim()
  const canSetKey = trimmedDraft.length > 0 && trimmedDraft !== (apiKey ?? '')

  return (
    <div className="ops-card mt-6 px-5 py-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="ops-eyebrow">Ops Access</div>
          <div className="text-sm text-ops-muted">Enter the ops API key for this session. It stays in memory only.</div>
        </div>
        <OpsStatusBadge tone={isReady ? 'success' : 'danger'}>
          {isReady ? 'Key Loaded' : 'Key Required'}
        </OpsStatusBadge>
      </div>
      <div className="mt-4 flex flex-col gap-3 md:flex-row md:items-center">
        <input
          aria-label="Ops API key"
          className="flex-1 ops-input"
          onChange={event => setDraft(event.target.value)}
          placeholder="ops_********"
          type="password"
          value={draft}
        />
        <button
          className="ops-btn-primary"
          disabled={!canSetKey}
          onClick={() => setOpsApiKey(draft)}
          type="button"
        >
          Set Key
        </button>
        <button
          className="ops-btn-neutral"
          disabled={!isReady && trimmedDraft.length === 0}
          onClick={() => {
            clearOpsApiKey()
            setDraft('')
          }}
          type="button"
        >
          Clear
        </button>
      </div>
    </div>
  )
}

export default OpsApiKeyPanel

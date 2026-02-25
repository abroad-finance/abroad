import { useEffect, useState } from 'react'

import { clearOpsApiKey, setOpsApiKey, useOpsApiKey } from '../../services/admin/opsAuthStore'

const OpsApiKeyPanel = () => {
  const apiKey = useOpsApiKey()
  const [draft, setDraft] = useState(apiKey ?? '')

  useEffect(() => {
    setDraft(apiKey ?? '')
  }, [apiKey])

  const isReady = Boolean(apiKey)

  return (
    <div className="mt-6 rounded-2xl border border-white/70 bg-white/80 px-5 py-4 shadow-[0_20px_45px_-35px_rgba(15,23,42,0.45)]">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="text-xs uppercase tracking-[0.3em] text-abroad-dark">Ops Access</div>
          <div className="text-sm text-gray-600">Enter the ops API key for this session. It stays in memory only.</div>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold ${
              isReady ? 'bg-emerald-100 text-emerald-800 border-emerald-200' : 'bg-rose-100 text-rose-800 border-rose-200'
            }`}
          >
            {isReady ? 'Key Loaded' : 'Key Required'}
          </span>
        </div>
      </div>
      <div className="mt-4 flex flex-col gap-3 md:flex-row md:items-center">
        <input
          className="flex-1 ops-input"
          onChange={event => setDraft(event.target.value)}
          placeholder="ops_********"
          type="password"
          value={draft}
        />
        <button
          className="ops-btn-primary"
          onClick={() => setOpsApiKey(draft)}
          type="button"
        >
          Set Key
        </button>
        <button
          className="rounded-xl border border-ops-border bg-white px-4 py-2 text-sm font-medium text-gray-800 hover:bg-neutral-100 transition"
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

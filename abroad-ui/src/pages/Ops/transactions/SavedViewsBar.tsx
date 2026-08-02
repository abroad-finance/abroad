import {
  BookmarkPlus, RefreshCw, Trash2, Users,
} from 'lucide-react'
import { useState } from 'react'

import type { OpsSavedView } from '../../../services/admin/opsInvestigationTypes'

import { OpsDialog, OpsField } from '../shared'

type Props = {
  canManage: boolean
  loading: boolean
  onApply: (view: OpsSavedView) => void
  onCreate: (input: { name: string, scope: 'PRIVATE' | 'TEAM' }) => Promise<void>
  onDelete: (view: OpsSavedView) => Promise<void>
  onUpdate: (view: OpsSavedView) => Promise<void>
  resourceName?: 'flows' | 'incidents' | 'transactions'
  views: OpsSavedView[]
}

const SavedViewsBar = ({
  canManage,
  loading,
  onApply,
  onCreate,
  onDelete,
  onUpdate,
  resourceName = 'transactions',
  views,
}: Props) => {
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [scope, setScope] = useState<'PRIVATE' | 'TEAM'>('PRIVATE')
  const [selectedId, setSelectedId] = useState('')
  const selected = views.find(view => view.id === selectedId)

  const create = async (): Promise<void> => {
    if (!name.trim()) return
    await onCreate({ name: name.trim(), scope })
    setCreating(false)
    setName('')
    setScope('PRIVATE')
  }

  return (
    <>
      <section aria-labelledby="saved-views-title" className="mt-4 flex flex-col gap-3 rounded-2xl border border-ops-border bg-white/70 p-3 sm:flex-row sm:items-end sm:justify-between sm:p-4">
        <div className="min-w-0 flex-1">
          <label className="ops-label" htmlFor={`${resourceName}-saved-view`} id="saved-views-title">Saved views</label>
          <select
            className="ops-input mt-2"
            id={`${resourceName}-saved-view`}
            name={`${resourceName}-saved-view`}
            onChange={(event) => {
              setSelectedId(event.target.value)
              const view = views.find(item => item.id === event.target.value)
              if (view) onApply(view)
            }}
            value={selectedId}
          >
            <option value="">Choose a personal or team view</option>
            {views.map(view => (
              <option key={view.id} value={view.id}>
                {view.scope === 'TEAM' ? 'Team · ' : 'Mine · '}
                {view.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="ops-btn-neutral min-h-11" disabled={!canManage || loading} onClick={() => setCreating(true)} type="button">
            <BookmarkPlus aria-hidden size={16} />
            Save current
          </button>
          {selected && (
            <>
              <button className="ops-btn-neutral min-h-11" disabled={!canManage || loading} onClick={() => void onUpdate(selected)} type="button">
                <RefreshCw aria-hidden size={16} />
                Replace
              </button>
              <button className="ops-btn-danger min-h-11" disabled={!canManage || loading} onClick={() => void onDelete(selected)} type="button">
                <Trash2 aria-hidden size={16} />
                Delete
              </button>
            </>
          )}
        </div>
      </section>

      {creating && (
        <OpsDialog
          description="Saved views open the same shareable URL filters. Team views are visible to every named operator."
          eyebrow="Investigation workspace"
          onClose={() => setCreating(false)}
          title="Save current filters"
        >
          <div className="space-y-5">
            <OpsField label="View name">
              <input
                autoFocus
                className="ops-input"
                maxLength={80}
                name="saved-view-name"
                onChange={event => setName(event.target.value)}
                placeholder={resourceName === 'flows'
                  ? 'Example: PIX flows waiting 30m'
                  : resourceName === 'incidents'
                    ? 'Example: Unowned provider incidents'
                    : 'Example: PIX proof missing'}
                value={name}
              />
            </OpsField>
            <fieldset>
              <legend className="ops-label">Visibility</legend>
              <div className="mt-2 grid gap-3 sm:grid-cols-2">
                {(['PRIVATE', 'TEAM'] as const).map(value => (
                  <label className={`flex min-h-14 cursor-pointer items-center gap-3 rounded-xl border p-3 ${scope === value ? 'border-ops-brand bg-emerald-50' : 'border-ops-border bg-white'}`} key={value}>
                    <input checked={scope === value} name="saved-view-scope" onChange={() => setScope(value)} type="radio" value={value} />
                    <span>
                      <span className="flex items-center gap-1.5 text-sm font-semibold text-ops-text">
                        {value === 'TEAM' && <Users aria-hidden size={15} />}
                        {value === 'TEAM' ? 'Operations team' : 'Only me'}
                      </span>
                      <span className="mt-0.5 block text-xs text-ops-muted">
                        {value === 'TEAM' ? 'Shared with named Ops users' : 'Private to your account'}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="flex flex-col-reverse gap-2 border-t border-ops-border pt-5 sm:flex-row sm:justify-end">
              <button className="ops-btn-neutral" onClick={() => setCreating(false)} type="button">Cancel</button>
              <button className="ops-btn-primary" disabled={!name.trim() || loading} onClick={() => void create()} type="button">Continue to save</button>
            </div>
          </div>
        </OpsDialog>
      )}
    </>
  )
}

export default SavedViewsBar

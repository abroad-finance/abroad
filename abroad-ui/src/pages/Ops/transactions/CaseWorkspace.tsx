import {
  ArrowRightLeft,
  BriefcaseBusiness,
  MessageSquarePlus,
  ShieldAlert,
  UserRoundCheck,
} from 'lucide-react'
import { useEffect, useState } from 'react'

import type { OpsCaseUser, OpsTransactionCaseDetail } from '../../../services/admin/transactionAdminTypes'

import {
  addOpsCaseNote,
  createOpsCase,
  handoffOpsCase,
  updateOpsCase,
} from '../../../services/admin/opsInvestigationApi'
import {
  formatDateTime,
  humanizeStatus,
  OpsBanner,
  OpsDialog,
  OpsField,
  OpsStatusBadge,
} from '../shared'
import { isOpsMutationCancelledError, useOpsMutation } from '../shared/opsMutationContext'

type Props = {
  canManage: boolean
  caseItem: null | OpsTransactionCaseDetail
  onChanged: () => Promise<void>
  owners: OpsCaseUser[]
  transactionId: string
}

const CaseWorkspace = ({
  canManage,
  caseItem,
  onChanged,
  owners,
  transactionId,
}: Props) => {
  const { requestMutation } = useOpsMutation()
  const [error, setError] = useState<null | string>(null)
  const [loading, setLoading] = useState(false)
  const [ownerId, setOwnerId] = useState(caseItem?.owner?.id ?? '')
  const [priority, setPriority] = useState(caseItem?.priority ?? 'NORMAL')
  const [status, setStatus] = useState(caseItem?.status ?? 'OPEN')
  const [team, setTeam] = useState(caseItem?.team ?? '')
  const [note, setNote] = useState('')
  const [noteKind, setNoteKind] = useState<'ESCALATION' | 'NOTE' | 'RESOLUTION'>('NOTE')
  const [handoffOpen, setHandoffOpen] = useState(false)
  const [handoffNote, setHandoffNote] = useState('')
  const [handoffOwnerId, setHandoffOwnerId] = useState(caseItem?.owner?.id ?? '')
  const [handoffTeam, setHandoffTeam] = useState(caseItem?.team ?? '')

  useEffect(() => {
    setOwnerId(caseItem?.owner?.id ?? '')
    setPriority(caseItem?.priority ?? 'NORMAL')
    setStatus(caseItem?.status ?? 'OPEN')
    setTeam(caseItem?.team ?? '')
    setHandoffOwnerId(caseItem?.owner?.id ?? '')
    setHandoffTeam(caseItem?.team ?? '')
  }, [caseItem])

  const finish = async (): Promise<void> => {
    await onChanged()
    setError(null)
  }

  const openCase = async (): Promise<void> => {
    setLoading(true)
    setError(null)
    try {
      await requestMutation({
        action: 'case.create',
        execute: mutation => createOpsCase({
          ownerUserId: ownerId || undefined,
          priority,
          team: team.trim() || undefined,
          transactionId,
        }, mutation),
        resourceLabel: transactionId,
        title: 'Open transaction case',
      })
      await finish()
    }
    catch (operationError) {
      if (!isOpsMutationCancelledError(operationError)) {
        setError(operationError instanceof Error ? operationError.message : 'Failed to open the case')
      }
    }
    finally {
      setLoading(false)
    }
  }

  const updateCase = async (): Promise<void> => {
    if (!caseItem) return
    setLoading(true)
    setError(null)
    try {
      await requestMutation({
        action: 'case.update',
        execute: mutation => updateOpsCase(caseItem.id, {
          ownerUserId: ownerId || null,
          priority,
          status,
          team: team.trim() || null,
        }, mutation),
        expectedVersion: caseItem.version,
        resourceLabel: `Case ${caseItem.id}`,
        title: 'Update transaction case',
      })
      await finish()
    }
    catch (operationError) {
      if (!isOpsMutationCancelledError(operationError)) {
        setError(operationError instanceof Error ? operationError.message : 'Failed to update the case')
      }
    }
    finally {
      setLoading(false)
    }
  }

  const addNote = async (): Promise<void> => {
    if (!caseItem || !note.trim()) return
    setLoading(true)
    setError(null)
    try {
      await requestMutation({
        action: noteKind === 'ESCALATION' ? 'case.escalate' : 'case.note.add',
        execute: mutation => addOpsCaseNote(caseItem.id, { body: note.trim(), kind: noteKind }, mutation),
        resourceLabel: `Case ${caseItem.id} · ${humanizeStatus(noteKind)}`,
        title: noteKind === 'ESCALATION' ? 'Escalate transaction case' : 'Add case note',
      })
      setNote('')
      await finish()
    }
    catch (operationError) {
      if (!isOpsMutationCancelledError(operationError)) {
        setError(operationError instanceof Error ? operationError.message : 'Failed to add the note')
      }
    }
    finally {
      setLoading(false)
    }
  }

  const handoff = async (): Promise<void> => {
    if (!caseItem || !handoffNote.trim()) return
    setLoading(true)
    setError(null)
    try {
      await requestMutation({
        action: 'case.handoff',
        execute: mutation => handoffOpsCase(caseItem.id, {
          note: handoffNote.trim(),
          toTeam: handoffTeam.trim() || null,
          toUserId: handoffOwnerId || null,
        }, mutation),
        expectedVersion: caseItem.version,
        resourceLabel: `Case ${caseItem.id} · ${handoffTeam || 'No team'}`,
        title: 'Hand off unresolved work',
      })
      setHandoffOpen(false)
      setHandoffNote('')
      await finish()
    }
    catch (operationError) {
      if (!isOpsMutationCancelledError(operationError)) {
        setError(operationError instanceof Error ? operationError.message : 'Failed to hand off the case')
      }
    }
    finally {
      setLoading(false)
    }
  }

  return (
    <section aria-labelledby="case-workspace-title" className="ops-card p-5 sm:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-ops-brand">
            <BriefcaseBusiness aria-hidden size={18} />
            <p className="ops-eyebrow">Durable coordination</p>
          </div>
          <h2 className="mt-1 text-xl font-semibold text-ops-text" id="case-workspace-title">Operations case</h2>
          <p className="mt-1 text-sm text-ops-muted">Assign responsibility, record PII-free evidence, escalate, and hand off unresolved work.</p>
        </div>
        {caseItem && <OpsStatusBadge label={humanizeStatus(caseItem.status)} tone={caseItem.status === 'RESOLVED' ? 'success' : caseItem.priority === 'CRITICAL' ? 'danger' : 'warning'} />}
      </div>

      {error && <OpsBanner className="mt-4" variant="error">{error}</OpsBanner>}
      {!canManage && <OpsBanner className="mt-4" variant="warning">Your role can read this case but cannot change ownership, status, or notes.</OpsBanner>}

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <OpsField label="Owner">
          <select className="ops-input" disabled={!canManage || loading} name="case-owner" onChange={event => setOwnerId(event.target.value)} value={ownerId}>
            <option value="">Unassigned</option>
            {owners.map(owner => <option key={owner.id} value={owner.id}>{owner.displayName}</option>)}
          </select>
        </OpsField>
        <OpsField label="Team">
          <input autoComplete="off" className="ops-input" disabled={!canManage || loading} maxLength={60} name="case-team" onChange={event => setTeam(event.target.value)} placeholder="Support, Operations, Finance…" value={team} />
        </OpsField>
        <OpsField label="Priority">
          <select className="ops-input" disabled={!canManage || loading} name="case-priority" onChange={event => setPriority(event.target.value as typeof priority)} value={priority}>
            <option value="LOW">Low</option>
            <option value="NORMAL">Normal</option>
            <option value="HIGH">High</option>
            <option value="CRITICAL">Critical</option>
          </select>
        </OpsField>
        <OpsField label="State">
          <select className="ops-input" disabled={!caseItem || !canManage || loading} name="case-status" onChange={event => setStatus(event.target.value as typeof status)} value={status}>
            <option value="OPEN">Open</option>
            <option value="ACKNOWLEDGED">Acknowledged</option>
            <option value="RESOLVED">Resolved</option>
          </select>
        </OpsField>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {caseItem
          ? (
              <>
                <button className="ops-btn-primary min-h-11" disabled={!canManage || loading} onClick={() => void updateCase()} type="button">
                  <UserRoundCheck aria-hidden size={16} />
                  Update case
                </button>
                <button className="ops-btn-neutral min-h-11" disabled={!canManage || loading} onClick={() => setHandoffOpen(true)} type="button">
                  <ArrowRightLeft aria-hidden size={16} />
                  Hand off
                </button>
              </>
            )
          : (
              <button className="ops-btn-primary min-h-11" disabled={!canManage || loading} onClick={() => void openCase()} type="button">
                <BriefcaseBusiness aria-hidden size={16} />
                Open case
              </button>
            )}
      </div>

      {caseItem && (
        <>
          <div className="mt-6 border-t border-ops-border pt-5">
            <h3 className="text-sm font-semibold text-ops-text">Add case evidence</h3>
            <div className="mt-3 grid gap-3 sm:grid-cols-[10rem_minmax(0,1fr)]">
              <select className="ops-input" disabled={!canManage || loading} name="case-note-kind" onChange={event => setNoteKind(event.target.value as typeof noteKind)} value={noteKind}>
                <option value="NOTE">Note</option>
                <option value="ESCALATION">Escalation</option>
                <option disabled={caseItem.status !== 'RESOLVED'} value="RESOLUTION">Resolution</option>
              </select>
              <textarea
                aria-describedby="case-note-hint"
                className="ops-input min-h-24 resize-y"
                disabled={!canManage || loading}
                maxLength={4000}
                name="case-note"
                onChange={event => setNote(event.target.value)}
                placeholder="Record what was verified, the current ambiguity, and the next action."
                value={note}
              />
            </div>
            <p className="mt-2 text-xs text-ops-muted" id="case-note-hint">Do not paste recipient, account, tax, document, QR, wallet, secret, or provider-body data.</p>
            <button className="ops-btn-neutral mt-3 min-h-11" disabled={!canManage || loading || !note.trim()} onClick={() => void addNote()} type="button">
              {noteKind === 'ESCALATION' ? <ShieldAlert aria-hidden size={16} /> : <MessageSquarePlus aria-hidden size={16} />}
              {noteKind === 'ESCALATION' ? 'Escalate case' : 'Add note'}
            </button>
          </div>

          <div className="mt-6 grid gap-6 border-t border-ops-border pt-5 lg:grid-cols-2">
            <div>
              <h3 className="text-sm font-semibold text-ops-text">Notes</h3>
              {caseItem.notes.length === 0
                ? <p className="mt-3 text-sm text-ops-muted">No operator notes yet.</p>
                : (
                    <ol className="mt-3 space-y-3">
                      {caseItem.notes.map(item => (
                        <li className="rounded-xl border border-ops-border bg-ops-bg/60 p-3" key={item.id}>
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="text-xs font-semibold text-ops-text">
                              {item.author.displayName}
                              {' '}
                              ·
                              {' '}
                              {humanizeStatus(item.kind)}
                            </span>
                            <time className="text-[11px] text-ops-muted" dateTime={item.createdAt}>{formatDateTime(item.createdAt)}</time>
                          </div>
                          <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-ops-muted">{item.body}</p>
                        </li>
                      ))}
                    </ol>
                  )}
            </div>
            <div>
              <h3 className="text-sm font-semibold text-ops-text">Handoff history</h3>
              {caseItem.handoffs.length === 0
                ? <p className="mt-3 text-sm text-ops-muted">No ownership handoff yet.</p>
                : (
                    <ol className="mt-3 space-y-3">
                      {caseItem.handoffs.map(item => (
                        <li className="rounded-xl border border-ops-border bg-ops-bg/60 p-3" key={item.id}>
                          <p className="text-xs font-semibold text-ops-text">
                            {item.fromUser?.displayName ?? item.fromTeam ?? 'Unassigned'}
                            {' → '}
                            {item.toUser?.displayName ?? item.toTeam ?? 'Unassigned'}
                          </p>
                          <p className="mt-1 text-xs text-ops-muted">{item.note}</p>
                          <time className="mt-2 block text-[11px] text-ops-muted" dateTime={item.createdAt}>{formatDateTime(item.createdAt)}</time>
                        </li>
                      ))}
                    </ol>
                  )}
            </div>
          </div>
        </>
      )}

      {handoffOpen && caseItem && (
        <OpsDialog
          description="This creates an immutable handoff record and changes the explicit owner/team."
          eyebrow="Unresolved work"
          onClose={() => setHandoffOpen(false)}
          title="Hand off transaction case"
        >
          <div className="space-y-4">
            <OpsField label="New owner">
              <select className="ops-input" name="handoff-owner" onChange={event => setHandoffOwnerId(event.target.value)} value={handoffOwnerId}>
                <option value="">Unassigned individual</option>
                {owners.map(owner => <option key={owner.id} value={owner.id}>{owner.displayName}</option>)}
              </select>
            </OpsField>
            <OpsField label="New team">
              <input className="ops-input" maxLength={60} name="handoff-team" onChange={event => setHandoffTeam(event.target.value)} value={handoffTeam} />
            </OpsField>
            <OpsField hint="Explain current evidence, ambiguity, and expected next action. Do not include customer PII." label="Handoff note">
              <textarea className="ops-input min-h-28 resize-y" maxLength={1000} name="handoff-note" onChange={event => setHandoffNote(event.target.value)} value={handoffNote} />
            </OpsField>
            <div className="flex flex-col-reverse gap-2 border-t border-ops-border pt-4 sm:flex-row sm:justify-end">
              <button className="ops-btn-neutral" onClick={() => setHandoffOpen(false)} type="button">Cancel</button>
              <button className="ops-btn-primary" disabled={loading || !handoffNote.trim()} onClick={() => void handoff()} type="button">Continue to handoff</button>
            </div>
          </div>
        </OpsDialog>
      )}
    </section>
  )
}

export default CaseWorkspace

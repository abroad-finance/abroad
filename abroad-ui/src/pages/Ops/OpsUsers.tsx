import { ShieldCheck, UserPlus } from 'lucide-react'
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react'

import type { OpsAdministrationRole, OpsUser } from '../../services/admin/administrationTypes'

import {
  disableOpsUser,
  enableOpsUser,
  inviteOpsUser,
  listOpsUsers,
  revokeOpsUserSessions,
  updateOpsUserRole,
} from '../../services/admin/administrationAdminApi'
import { opsRoles } from '../../services/admin/administrationTypes'
import { useOpsSession } from '../../services/admin/opsAuthStore'
import {
  formatDateTime,
  humanizeStatus,
  OpsBanner,
  OpsEmptyState,
  OpsField,
  OpsLoading,
  OpsPageShell,
  OpsStatusBadge,
  OpsTone,
} from './shared'
import { isOpsMutationCancelledError, useOpsMutation } from './shared/opsMutationContext'

const roleDescription: Record<OpsAdministrationRole, string> = {
  ADMINISTRATOR: 'Identity, audit, integrations, configuration, and all operational actions',
  COMPLIANCE: 'KYC decisions, evidence review, cases, and read-only operational context',
  FINANCE: 'Treasury, reconciliation, proof, exports, and case ownership',
  OPERATIONS: 'Incident and flow recovery, reconciliation, proof, exports, and cases',
  SUPPORT: 'Transaction investigation, proof, exports, saved views, and cases',
  VIEWER: 'Read-only operational, transaction, flow, partner, treasury, and configuration context',
}

const statusTone: Record<OpsUser['status'], OpsTone> = {
  ACTIVE: 'success',
  DISABLED: 'danger',
  INVITED: 'info',
}

type InviteDraft = {
  displayName: string
  email: string
  role: OpsAdministrationRole
}

const emptyInvite: InviteDraft = {
  displayName: '',
  email: '',
  role: 'VIEWER',
}

const OpsUsers = () => {
  const session = useOpsSession()
  const { requestMutation } = useOpsMutation()
  const [users, setUsers] = useState<OpsUser[]>([])
  const [roleDrafts, setRoleDrafts] = useState<Record<string, OpsAdministrationRole>>({})
  const [invite, setInvite] = useState<InviteDraft>(emptyInvite)
  const [loading, setLoading] = useState(false)
  const [actionLoading, setActionLoading] = useState<null | string>(null)
  const [error, setError] = useState<null | string>(null)
  const canManage = Boolean(session?.permissions.includes('administration:users'))

  const replaceUser = useCallback((next: OpsUser) => {
    setUsers(current => current.map(user => user.id === next.id ? next : user))
    setRoleDrafts(current => ({ ...current, [next.id]: next.role }))
  }, [])

  const load = useCallback(async () => {
    if (!canManage) {
      setUsers([])
      return
    }
    setLoading(true)
    setError(null)
    try {
      const response = await listOpsUsers()
      setUsers(response.items)
      setRoleDrafts(Object.fromEntries(response.items.map(user => [user.id, user.role])))
    }
    catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load Ops users')
    }
    finally {
      setLoading(false)
    }
  }, [canManage])

  useEffect(() => {
    void load()
  }, [load])

  const roleCounts = useMemo(() => Object.fromEntries(opsRoles.map(role => [role, users.filter(user => user.role === role && user.status !== 'DISABLED').length])), [users])

  const handleInvite = async (): Promise<void> => {
    if (!invite.displayName.trim() || !invite.email.trim()) {
      setError('Name and organization email are required.')
      return
    }
    setActionLoading('invite')
    setError(null)
    try {
      const payload = {
        displayName: invite.displayName.trim(),
        email: invite.email.trim().toLowerCase(),
        role: invite.role,
      }
      const created = await requestMutation({
        action: 'administration.user.invite',
        execute: mutation => inviteOpsUser(payload, mutation),
        resourceLabel: payload.email,
        title: 'Grant Ops access',
      })
      setUsers(current => [...current, created].sort((left, right) => (
        left.displayName.localeCompare(right.displayName)
      )))
      setRoleDrafts(current => ({ ...current, [created.id]: created.role }))
      setInvite(emptyInvite)
    }
    catch (inviteError) {
      if (isOpsMutationCancelledError(inviteError)) return
      setError(inviteError instanceof Error ? inviteError.message : 'Failed to grant Ops access')
    }
    finally {
      setActionLoading(null)
    }
  }

  const handleRoleUpdate = async (user: OpsUser): Promise<void> => {
    const role = roleDrafts[user.id] ?? user.role
    if (role === user.role) return
    setActionLoading(`role:${user.id}`)
    setError(null)
    try {
      const updated = await requestMutation({
        action: 'administration.user.role_update',
        execute: mutation => updateOpsUserRole(user.id, role, mutation),
        expectedVersion: user.version,
        resourceLabel: `${user.displayName} · ${user.role} to ${role}`,
        title: 'Change operator role',
      })
      replaceUser(updated)
    }
    catch (updateError) {
      if (isOpsMutationCancelledError(updateError)) return
      setError(updateError instanceof Error ? updateError.message : 'Failed to update role')
    }
    finally {
      setActionLoading(null)
    }
  }

  const handleStatus = async (user: OpsUser): Promise<void> => {
    const enable = user.status === 'DISABLED'
    setActionLoading(`status:${user.id}`)
    setError(null)
    try {
      const updated = await requestMutation({
        action: enable ? 'administration.user.enable' : 'administration.user.disable',
        execute: mutation => enable
          ? enableOpsUser(user.id, mutation)
          : disableOpsUser(user.id, mutation),
        expectedVersion: user.version,
        resourceLabel: `${user.displayName} · ${user.email}`,
        title: enable ? 'Enable operator account' : 'Disable operator account',
      })
      replaceUser(updated)
    }
    catch (statusError) {
      if (isOpsMutationCancelledError(statusError)) return
      setError(statusError instanceof Error ? statusError.message : 'Failed to update account status')
    }
    finally {
      setActionLoading(null)
    }
  }

  const handleRevokeSessions = async (user: OpsUser): Promise<void> => {
    setActionLoading(`sessions:${user.id}`)
    setError(null)
    try {
      const updated = await requestMutation({
        action: 'administration.user.revoke_sessions',
        execute: mutation => revokeOpsUserSessions(user.id, mutation),
        expectedVersion: user.version,
        resourceLabel: `${user.displayName} · ${user.email}`,
        title: 'Revoke operator sessions',
      })
      replaceUser(updated)
    }
    catch (revokeError) {
      if (isOpsMutationCancelledError(revokeError)) return
      setError(revokeError instanceof Error ? revokeError.message : 'Failed to revoke sessions')
    }
    finally {
      setActionLoading(null)
    }
  }

  return (
    <OpsPageShell
      actions={(
        <button className="ops-btn-ghost" disabled={!canManage || loading} onClick={() => void load()} type="button">
          Refresh
        </button>
      )}
      error={error}
      eyebrow="Administration"
      subtitle="Admit named organization accounts, assign effective roles, and invalidate access without sharing credentials."
      title="Users & Roles"
      width="full"
    >
      {!canManage && session && (
        <OpsBanner className="mt-6" variant="warning">
          Your current role cannot view or manage Ops identities.
        </OpsBanner>
      )}

      {canManage && (
        <>
          <section aria-labelledby="invite-ops-user" className="ops-card mt-8 p-5">
            <div className="flex items-start gap-3">
              <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-ops-brand/10 text-ops-brand">
                <UserPlus aria-hidden size={20} />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-ops-text" id="invite-ops-user">Grant named access</h2>
                <p className="mt-1 text-sm text-ops-muted">The account remains invited until that exact abroad.finance email signs in with Google.</p>
              </div>
            </div>
            <div className="mt-5 grid gap-4 lg:grid-cols-[1fr_1.2fr_1fr_auto] lg:items-end">
              <OpsField label="Display name">
                <input
                  autoComplete="name"
                  className="ops-input"
                  name="ops-invite-name"
                  onChange={event => setInvite(current => ({ ...current, displayName: event.target.value }))}
                  value={invite.displayName}
                />
              </OpsField>
              <OpsField hint="Only verified @abroad.finance accounts are accepted." label="Organization email">
                <input
                  autoComplete="email"
                  className="ops-input"
                  name="ops-invite-email"
                  onChange={event => setInvite(current => ({ ...current, email: event.target.value }))}
                  type="email"
                  value={invite.email}
                />
              </OpsField>
              <OpsField label="Initial role">
                <select
                  className="ops-input"
                  name="ops-invite-role"
                  onChange={event => setInvite(current => ({
                    ...current,
                    role: event.target.value as OpsAdministrationRole,
                  }))}
                  value={invite.role}
                >
                  {opsRoles.map(role => <option key={role} value={role}>{role}</option>)}
                </select>
              </OpsField>
              <button
                className="ops-btn-primary"
                disabled={actionLoading === 'invite'}
                onClick={() => void handleInvite()}
                type="button"
              >
                {actionLoading === 'invite' ? 'Authorizing…' : 'Grant access'}
              </button>
            </div>
            <p className="mt-3 text-xs text-ops-muted">{roleDescription[invite.role]}</p>
          </section>

          <div aria-label="Enabled users by role" className="mt-6 flex flex-wrap gap-2">
            {opsRoles.map(role => (
              <span className="rounded-full border border-ops-border bg-white px-3 py-1.5 text-xs text-ops-muted" key={role}>
                <strong className="text-ops-text">{roleCounts[role] ?? 0}</strong>
                {' '}
                {role}
              </span>
            ))}
          </div>

          {loading && <div className="mt-6"><OpsLoading label="Loading Ops users…" /></div>}
          {!loading && users.length === 0 && <div className="mt-6"><OpsEmptyState>No Ops users have been admitted.</OpsEmptyState></div>}

          <section aria-label="Ops user directory" className="mt-6 grid gap-4 xl:grid-cols-2">
            {users.map((user) => {
              const selectedRole = roleDrafts[user.id] ?? user.role
              const busy = actionLoading?.endsWith(user.id) ?? false
              const isCurrentUser = user.id === session?.userId
              return (
                <article className="ops-card min-w-0 p-5" key={user.id}>
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <OpsStatusBadge tone={statusTone[user.status]}>{humanizeStatus(user.status)}</OpsStatusBadge>
                        {isCurrentUser && <OpsStatusBadge tone="info">Current session</OpsStatusBadge>}
                      </div>
                      <h2 className="mt-3 break-words text-lg font-semibold text-ops-text">{user.displayName}</h2>
                      <div className="break-all text-sm text-ops-muted">{user.email}</div>
                      <dl className="mt-3 grid gap-1 text-xs text-ops-muted sm:grid-cols-2">
                        <div>
                          <dt className="inline font-medium">Last login:</dt>
                          {' '}
                          <dd className="inline">{formatDateTime(user.lastLoginAt)}</dd>
                        </div>
                        <div>
                          <dt className="inline font-medium">Invited:</dt>
                          {' '}
                          <dd className="inline">{formatDateTime(user.createdAt)}</dd>
                        </div>
                        <div>
                          <dt className="inline font-medium">Sessions revoked:</dt>
                          {' '}
                          <dd className="inline">{formatDateTime(user.sessionsRevokedAt)}</dd>
                        </div>
                        <div>
                          <dt className="inline font-medium">Access version:</dt>
                          {' '}
                          <dd className="inline">{user.version}</dd>
                        </div>
                      </dl>
                    </div>
                    <ShieldCheck aria-hidden className="shrink-0 text-ops-brand" size={24} />
                  </div>

                  <div className="mt-5 rounded-2xl border border-ops-border bg-ops-bg p-4">
                    <fieldset>
                      <legend className="ops-label">Effective role</legend>
                      <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                        <select
                          aria-describedby={`role-description-${user.id}`}
                          aria-label={`Role for ${user.displayName}`}
                          className="ops-input min-w-0 flex-1"
                          disabled={busy || user.status === 'DISABLED'}
                          onChange={event => setRoleDrafts(current => ({
                            ...current,
                            [user.id]: event.target.value as OpsAdministrationRole,
                          }))}
                          value={selectedRole}
                        >
                          {opsRoles.map(role => <option key={role} value={role}>{role}</option>)}
                        </select>
                        <button
                          className="ops-btn-primary ops-btn-sm"
                          disabled={busy || selectedRole === user.role || user.status === 'DISABLED'}
                          onClick={() => void handleRoleUpdate(user)}
                          type="button"
                        >
                          Save role
                        </button>
                      </div>
                      <p className="mt-2 text-xs leading-5 text-ops-muted" id={`role-description-${user.id}`}>
                        {roleDescription[selectedRole]}
                      </p>
                    </fieldset>
                  </div>

                  <details className="mt-4 rounded-xl border border-ops-border px-4 py-3 text-sm">
                    <summary className="cursor-pointer font-medium text-ops-text">
                      {user.permissions.length}
                      {' '}
                      effective permissions
                    </summary>
                    <ul className="mt-3 grid gap-1 text-xs text-ops-muted sm:grid-cols-2">
                      {user.permissions.map(permission => <li className="font-mono" key={permission}>{permission}</li>)}
                    </ul>
                  </details>

                  <div className="mt-4 flex flex-wrap gap-2">
                    <button
                      className="ops-btn-neutral ops-btn-sm"
                      disabled={busy || user.status !== 'ACTIVE'}
                      onClick={() => void handleRevokeSessions(user)}
                      type="button"
                    >
                      Revoke sessions
                    </button>
                    <button
                      className={user.status === 'DISABLED' ? 'ops-btn-primary ops-btn-sm' : 'ops-btn-danger ops-btn-sm'}
                      disabled={busy || isCurrentUser || user.status === 'INVITED'}
                      onClick={() => void handleStatus(user)}
                      type="button"
                    >
                      {user.status === 'DISABLED' ? 'Enable account' : 'Disable account'}
                    </button>
                  </div>
                </article>
              )
            })}
          </section>
        </>
      )}
    </OpsPageShell>
  )
}

export default OpsUsers

import type { FormEvent } from 'react'

import { useTranslate } from '@tolgee/react'
import {
  Activity, KeyRound, LoaderCircle, LockKeyhole, Plus, RefreshCw, ShieldCheck, UserRound, UsersRound,
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'

import type {
  PartnerPortalAuditEvent,
  PartnerPortalMfaEnrollment,
  PartnerPortalRole,
  PartnerPortalUser,
} from '../../services/partnerPortal/partnerPortalTypes'

import {
  beginPartnerMfaEnrollment,
  changePartnerPortalPassword,
  confirmPartnerMfaEnrollment,
  createPartnerPortalUser,
  issuePartnerPasswordReset,
  listPartnerAuditEvents,
  listPartnerPortalUsers,
  regeneratePartnerRecoveryCodes,
  resetPartnerMfa,
  updatePartnerPortalUser,
} from '../../services/partnerPortal/partnerPortalApi'
import {
  clearPartnerPortalSession,
  setPartnerPortalSession,
  usePartnerPortalSession,
} from '../../services/partnerPortal/partnerPortalSessionStore'
import { formatPartnerDateTime } from './partnerPortalPresentation'
import { OneTimeSecretDialog, PartnerNotice } from './partnerPortalUi'

type RevealedValue = { description: string, label: string, value: string }

const AI_AUTHORIZATION_REQUEST_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu

const safeAiAuthorizationReturnPath = (candidate: null | string): null | string => {
  if (!candidate) return null
  try {
    const url = new URL(candidate, window.location.origin)
    const requestId = url.searchParams.get('request')
    if (
      url.origin !== window.location.origin
      || url.pathname !== '/partner/integration/ai/authorize'
      || url.searchParams.size !== 1
      || !requestId
      || !AI_AUTHORIZATION_REQUEST_ID_PATTERN.test(requestId)
    ) {
      return null
    }
    return `${url.pathname}?request=${encodeURIComponent(requestId)}`
  }
  catch {
    return null
  }
}

const actionLabel = (action: string): string => action
  .replace(/\./gu, ' · ')
  .replace(/_/gu, ' ')

const resetLink = (token: string): string => {
  const origin = typeof window === 'undefined' ? 'https://abroad.finance' : window.location.origin
  return `${origin}/partner/password-reset?token=${encodeURIComponent(token)}`
}

const PartnerPortalTeamSecurity = () => {
  const { t } = useTranslate()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const session = usePartnerPortalSession()
  const aiAuthorizationReturnPath = safeAiAuthorizationReturnPath(searchParams.get('returnTo'))
  const canManageTeam = session?.role === 'ADMIN' && session.mfaVerified
  const [auditEvents, setAuditEvents] = useState<PartnerPortalAuditEvent[]>([])
  const [confirmationCode, setConfirmationCode] = useState('')
  const [email, setEmail] = useState('')
  const [enrollment, setEnrollment] = useState<null | PartnerPortalMfaEnrollment>(null)
  const [error, setError] = useState<null | string>(null)
  const [mfaCurrentPassword, setMfaCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [passwordConfirmation, setPasswordConfirmation] = useState('')
  const [passwordCurrentPassword, setPasswordCurrentPassword] = useState('')
  const [pendingAction, setPendingAction] = useState<null | string>(null)
  const [revealed, setRevealed] = useState<null | RevealedValue>(null)
  const [returnAfterMfaSecret, setReturnAfterMfaSecret] = useState(false)
  const [role, setRole] = useState<PartnerPortalRole>('MEMBER')
  const [success, setSuccess] = useState<null | string>(null)
  const [users, setUsers] = useState<PartnerPortalUser[]>([])

  const loadTeam = useCallback(async () => {
    if (!canManageTeam) return
    setPendingAction('load-team')
    setError(null)
    try {
      const [nextUsers, nextEvents] = await Promise.all([listPartnerPortalUsers(), listPartnerAuditEvents()])
      setUsers(nextUsers)
      setAuditEvents(nextEvents)
    }
    catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load team security')
    }
    finally {
      setPendingAction(null)
    }
  }, [canManageTeam])

  useEffect(() => {
    void loadTeam()
  }, [loadTeam])

  const run = async (action: string, operation: () => Promise<void>) => {
    setPendingAction(action)
    setError(null)
    setSuccess(null)
    try {
      await operation()
    }
    catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The security change could not be completed')
    }
    finally {
      setPendingAction(null)
    }
  }

  const submitInvite = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!email.trim()) return
    await run('invite', async () => {
      const result = await createPartnerPortalUser(email.trim().toLowerCase(), role)
      setRevealed({
        description: `Share this one-time ${role.toLowerCase()} invitation link with ${result.user.email}. It expires ${formatPartnerDateTime(result.expiresAt)}.`,
        label: 'Invitation link',
        value: resetLink(result.token),
      })
      setEmail('')
      await loadTeam()
    })
  }

  if (!session) return null

  return (
    <>
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="partner-eyebrow">Access control</p>
          <h1 className="mt-2 text-4xl font-semibold tracking-[-0.04em] text-partner-ink sm:text-5xl">Team &amp; security</h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-partner-muted sm:text-base">Protect your individual account and, for administrators, manage every person with workspace access.</p>
        </div>
        {canManageTeam && (
          <button className="partner-button-secondary" disabled={pendingAction !== null} onClick={() => void loadTeam()} type="button">
            <RefreshCw aria-hidden className="h-4 w-4" />
            Refresh
          </button>
        )}
      </header>

      {(error || success) && <div aria-live="polite" className="mt-6"><PartnerNotice tone={error ? 'error' : 'success'}>{error ?? success}</PartnerNotice></div>}

      {aiAuthorizationReturnPath && (
        <div className="mt-6">
          <PartnerNotice tone="neutral">
            {session.mfaEnabled && session.mfaVerified
              ? (
                  <Link className="font-semibold text-partner-forest underline-offset-4 hover:underline" to={aiAuthorizationReturnPath}>
                    {t('partner.ai.authorization.return_to_request', 'Return to authorization request')}
                  </Link>
                )
              : t('partner.ai.authorization.return_after_mfa', 'After you enable MFA and save your recovery codes, Abroad will return you to this authorization request.')}
          </PartnerNotice>
        </div>
      )}

      <div className="mt-8 grid gap-8 xl:grid-cols-2">
        <section aria-labelledby="personal-security-title" className="partner-section">
          <div className="flex items-start gap-3">
            <div className="rounded-xl bg-partner-mint/60 p-2.5 text-partner-forest"><ShieldCheck aria-hidden className="h-5 w-5" /></div>
            <div>
              <h2 className="text-xl font-semibold text-partner-ink" id="personal-security-title">Personal security</h2>
              <p className="mt-1 text-sm text-partner-muted">
                {session.email}
                {' '}
                ·
                {' '}
                {session.role === 'ADMIN' ? 'Administrator' : 'Member'}
              </p>
            </div>
          </div>

          <div className="mt-6 rounded-2xl bg-partner-ledger p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-partner-ink">Multi-factor authentication</p>
                <p className="mt-1 text-xs text-partner-muted">{session.mfaEnabled ? 'Authenticator factor enabled' : 'Required for administrator actions'}</p>
              </div>
              <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${session.mfaEnabled ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-900'}`}>{session.mfaEnabled ? 'Enabled' : 'Not enabled'}</span>
            </div>

            {!session.mfaEnabled && !enrollment && (
              <form
                className="mt-5 flex flex-col gap-3 sm:flex-row"
                onSubmit={(event) => {
                  event.preventDefault()
                  void run('begin-mfa', async () => {
                    setEnrollment(await beginPartnerMfaEnrollment(mfaCurrentPassword))
                    setMfaCurrentPassword('')
                  })
                }}
              >
                <input autoComplete="current-password" className="partner-input w-full sm:min-w-0 sm:flex-1" onChange={event => setMfaCurrentPassword(event.target.value)} placeholder="Current password" type="password" value={mfaCurrentPassword} />
                <button className="partner-button-primary" disabled={!mfaCurrentPassword || pendingAction !== null} type="submit">Set up MFA</button>
              </form>
            )}

            {enrollment && (
              <form
                className="mt-5 rounded-2xl border border-partner-border bg-white p-4"
                onSubmit={(event) => {
                  event.preventDefault()
                  void run('confirm-mfa', async () => {
                    const result = await confirmPartnerMfaEnrollment(confirmationCode.trim())
                    setPartnerPortalSession(result.session)
                    setEnrollment(null)
                    setConfirmationCode('')
                    setReturnAfterMfaSecret(Boolean(aiAuthorizationReturnPath))
                    setRevealed({ description: 'Store all ten codes in a password manager. Each code works once.', label: 'MFA recovery codes', value: result.recoveryCodes.join('\n') })
                  })
                }}
              >
                <p className="text-sm font-semibold text-partner-ink">Add Abroad to your authenticator</p>
                <p className="mt-2 text-xs leading-5 text-partner-muted">Manual entry key</p>
                <code className="mt-1 block break-all rounded-xl bg-partner-ledger p-3 text-sm font-semibold text-partner-ink">{enrollment.manualEntryKey}</code>
                <a className="mt-3 inline-block text-xs font-semibold text-partner-forest hover:text-partner-ink" href={enrollment.otpauthUri}>Open in authenticator app</a>
                <label className="partner-label mt-4 block" htmlFor="mfa-confirmation">Six-digit code</label>
                <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                  <input autoComplete="one-time-code" className="partner-input w-full font-mono sm:min-w-0 sm:flex-1" id="mfa-confirmation" onChange={event => setConfirmationCode(event.target.value)} value={confirmationCode} />
                  <button className="partner-button-primary" disabled={!confirmationCode.trim() || pendingAction !== null} type="submit">Enable MFA</button>
                </div>
              </form>
            )}

            {session.mfaEnabled && session.mfaVerified && (
              <form
                className="mt-5 flex flex-col gap-3 sm:flex-row"
                onSubmit={(event) => {
                  event.preventDefault()
                  void run('recovery-codes', async () => {
                    const codes = await regeneratePartnerRecoveryCodes(mfaCurrentPassword)
                    setMfaCurrentPassword('')
                    setRevealed({ description: 'These replace every previous recovery code. Each can be used once.', label: 'New MFA recovery codes', value: codes.join('\n') })
                  })
                }}
              >
                <input autoComplete="current-password" className="partner-input w-full sm:min-w-0 sm:flex-1" onChange={event => setMfaCurrentPassword(event.target.value)} placeholder="Current password" type="password" value={mfaCurrentPassword} />
                <button className="partner-button-secondary" disabled={!mfaCurrentPassword || pendingAction !== null} type="submit">Replace recovery codes</button>
              </form>
            )}
          </div>

          <form
            className="mt-6 border-t border-partner-border pt-6"
            onSubmit={(event) => {
              event.preventDefault()
              if (newPassword !== passwordConfirmation) return
              void run('change-password', async () => {
                await changePartnerPortalPassword(passwordCurrentPassword, newPassword)
                clearPartnerPortalSession()
              })
            }}
          >
            <div className="flex items-center gap-3">
              <LockKeyhole aria-hidden className="h-4 w-4 text-partner-forest" />
              <h3 className="font-semibold text-partner-ink">Change password</h3>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <input autoComplete="current-password" className="partner-input" onChange={event => setPasswordCurrentPassword(event.target.value)} placeholder="Current password" type="password" value={passwordCurrentPassword} />
              <input autoComplete="new-password" className="partner-input" onChange={event => setNewPassword(event.target.value)} placeholder="New password" type="password" value={newPassword} />
              <input autoComplete="new-password" className="partner-input" onChange={event => setPasswordConfirmation(event.target.value)} placeholder="Confirm password" type="password" value={passwordConfirmation} />
            </div>
            {passwordConfirmation && newPassword !== passwordConfirmation && <p className="mt-2 text-xs font-medium text-rose-700">Passwords do not match.</p>}
            <button className="partner-button-secondary mt-4" disabled={!passwordCurrentPassword || !newPassword || newPassword !== passwordConfirmation || pendingAction !== null} type="submit">Change password and sign out</button>
          </form>
        </section>

        {canManageTeam
          ? (
              <section aria-labelledby="team-title" className="partner-section">
                <div className="flex items-start gap-3">
                  <div className="rounded-xl bg-partner-mint/60 p-2.5 text-partner-forest"><UsersRound aria-hidden className="h-5 w-5" /></div>
                  <div>
                    <h2 className="text-xl font-semibold text-partner-ink" id="team-title">Workspace team</h2>
                    <p className="mt-1 text-sm text-partner-muted">Individual accounts keep access attributable and revocable.</p>
                  </div>
                </div>

                <form className="mt-6 grid gap-3 border-t border-partner-border pt-6 sm:grid-cols-[1fr_9rem_auto]" onSubmit={event => void submitInvite(event)}>
                  <input className="partner-input" onChange={event => setEmail(event.target.value)} placeholder="teammate@company.com" type="email" value={email} />
                  <select className="partner-select" onChange={event => setRole(event.target.value as PartnerPortalRole)} value={role}>
                    <option value="MEMBER">Member</option>
                    <option value="ADMIN">Administrator</option>
                  </select>
                  <button className="partner-button-primary" disabled={!email.trim() || pendingAction !== null} type="submit">
                    <Plus aria-hidden className="h-4 w-4" />
                    Invite
                  </button>
                </form>

                <div className="mt-6 space-y-3">
                  {pendingAction === 'load-team' && users.length === 0 && (
                    <div className="partner-empty-state">
                      <LoaderCircle aria-hidden className="h-4 w-4 animate-spin" />
                      Loading team…
                    </div>
                  )}
                  {users.map(user => (
                    <article className="rounded-2xl border border-partner-border p-4" key={user.id}>
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate font-semibold text-partner-ink">{user.email}</p>
                          <p className="mt-1 text-xs text-partner-muted">{`${user.role === 'ADMIN' ? 'Administrator' : 'Member'} · MFA ${user.mfaEnabled ? 'enabled' : 'not enabled'} · Last sign-in ${user.lastLoginAt ? formatPartnerDateTime(user.lastLoginAt) : 'never'}`}</p>
                        </div>
                        <span className={`rounded-full px-2 py-0.5 text-[0.6875rem] font-semibold ${user.disabledAt ? 'bg-partner-ledger text-partner-muted' : 'bg-emerald-50 text-emerald-700'}`}>{user.disabledAt ? 'DISABLED' : 'ACTIVE'}</span>
                      </div>
                      <div className="mt-4 flex flex-wrap gap-2">
                        <select
                          aria-label={`Role for ${user.email}`}
                          className="partner-select h-9 py-1 text-xs"
                          disabled={user.id === session.userId || pendingAction !== null}
                          onChange={event => void run(`role-${user.id}`, async () => {
                            await updatePartnerPortalUser(user.id, { role: event.target.value as PartnerPortalRole })
                            await loadTeam()
                          })}
                          value={user.role}
                        >
                          <option value="MEMBER">Member</option>
                          <option value="ADMIN">Administrator</option>
                        </select>
                        <button
                          className="partner-button-secondary min-h-9 px-3 py-1.5 text-xs"
                          disabled={pendingAction !== null}
                          onClick={() => void run(`reset-password-${user.id}`, async () => {
                            const result = await issuePartnerPasswordReset(user.id)
                            setRevealed({ description: `Share this one-time link with ${user.email}. It expires ${formatPartnerDateTime(result.expiresAt)}.`, label: 'Password reset link', value: resetLink(result.token) })
                          })}
                          type="button"
                        >
                          <KeyRound aria-hidden className="h-3.5 w-3.5" />
                          Password reset
                        </button>
                        {user.mfaEnabled && user.id !== session.userId && (
                          <button
                            className="partner-button-secondary min-h-9 px-3 py-1.5 text-xs"
                            disabled={pendingAction !== null}
                            onClick={() => void run(`mfa-reset-${user.id}`, async () => {
                              await resetPartnerMfa(user.id)
                              await loadTeam()
                              setSuccess(`MFA reset for ${user.email}.`)
                            })}
                            type="button"
                          >
                            Reset MFA
                          </button>
                        )}
                        {user.id !== session.userId && (
                          <button
                            className="partner-button-secondary min-h-9 px-3 py-1.5 text-xs"
                            disabled={pendingAction !== null}
                            onClick={() => void run(`toggle-${user.id}`, async () => {
                              await updatePartnerPortalUser(user.id, { disabled: !user.disabledAt })
                              await loadTeam()
                            })}
                            type="button"
                          >
                            {user.disabledAt ? 'Enable' : 'Disable'}
                          </button>
                        )}
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            )
          : (
              <section aria-labelledby="administrator-access-title" className="partner-section">
                <UserRound aria-hidden className="h-6 w-6 text-partner-forest" />
                <h2 className="mt-4 text-xl font-semibold text-partner-ink" id="administrator-access-title">Individual account</h2>
                <p className="mt-2 text-sm leading-6 text-partner-muted">Team and integration management appear only for an administrator with MFA verified. Your transaction access is unchanged.</p>
              </section>
            )}
      </div>

      {canManageTeam && auditEvents.length > 0 && (
        <section aria-labelledby="audit-title" className="partner-section mt-8">
          <div className="flex items-center gap-3">
            <Activity aria-hidden className="h-5 w-5 text-partner-forest" />
            <div>
              <h2 className="text-xl font-semibold text-partner-ink" id="audit-title">Security activity</h2>
              <p className="mt-1 text-sm text-partner-muted">The 50 most recent partner-administration actions.</p>
            </div>
          </div>
          <div className="partner-table-shell mt-5 overflow-x-auto shadow-none">
            <table className="w-full min-w-[42rem]">
              <thead>
                <tr>
                  <th className="text-left">Action</th>
                  <th className="text-left">Actor</th>
                  <th className="text-left">Resource</th>
                  <th className="text-right">Time</th>
                </tr>
              </thead>
              <tbody>
                {auditEvents.map(event => (
                  <tr key={event.id}>
                    <td className="text-sm font-semibold text-partner-ink">{actionLabel(event.action)}</td>
                    <td className="text-sm text-partner-muted">{event.actorEmail ?? 'System'}</td>
                    <td className="font-mono text-xs text-partner-muted">{event.resourceType}</td>
                    <td className="whitespace-nowrap text-right text-xs text-partner-muted">{formatPartnerDateTime(event.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {revealed && (
        <OneTimeSecretDialog
          description={revealed.description}
          label={revealed.label}
          onClose={() => {
            setRevealed(null)
            if (returnAfterMfaSecret && aiAuthorizationReturnPath) {
              setReturnAfterMfaSecret(false)
              navigate(aiAuthorizationReturnPath, { replace: true })
            }
          }}
          secret={revealed.value}
        />
      )}
    </>
  )
}

export default PartnerPortalTeamSecurity

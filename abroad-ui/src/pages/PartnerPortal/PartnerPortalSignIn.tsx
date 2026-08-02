import type { FormEvent } from 'react'

import {
  ArrowLeft, ArrowRight, Eye, EyeOff, KeyRound, LoaderCircle, LockKeyhole, Mail, ShieldCheck,
} from 'lucide-react'
import { useState } from 'react'

import AbroadLogo from '../../assets/Logos/AbroadLogoColored.svg'
import {
  completePartnerMfaChallenge,
  createPartnerPortalSession,
  resetPartnerPasswordWithRecoveryCode,
  resetPartnerPasswordWithToken,
} from '../../services/partnerPortal/partnerPortalApi'
import { setPartnerPortalSession } from '../../services/partnerPortal/partnerPortalSessionStore'

type SignInMode = 'login' | 'mfa' | 'recovery' | 'token-reset'

const initialResetToken = (): null | string => {
  if (typeof window === 'undefined') return null
  const token = new URLSearchParams(window.location.search).get('token')?.trim()
  return token || null
}

const PartnerPortalSignIn = () => {
  const [challengeToken, setChallengeToken] = useState<null | string>(null)
  const [code, setCode] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [email, setEmail] = useState('')
  const [error, setError] = useState<null | string>(null)
  const [loading, setLoading] = useState(false)
  const [mode, setMode] = useState<SignInMode>(() => initialResetToken() ? 'token-reset' : 'login')
  const [newPassword, setNewPassword] = useState('')
  const [password, setPassword] = useState('')
  const [recoveryCode, setRecoveryCode] = useState('')
  const [resetToken] = useState(initialResetToken)
  const [showPassword, setShowPassword] = useState(false)
  const [success, setSuccess] = useState<null | string>(null)

  const begin = (nextMode: SignInMode) => {
    setCode('')
    setConfirmation('')
    setError(null)
    setNewPassword('')
    setPassword('')
    setRecoveryCode('')
    setSuccess(null)
    setMode(nextMode)
  }

  const submitLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const normalizedEmail = email.trim().toLowerCase()
    if (!normalizedEmail || !password || loading) return

    setLoading(true)
    setError(null)
    try {
      const result = await createPartnerPortalSession(normalizedEmail, password)
      setPassword('')
      if (result.status === 'MFA_REQUIRED') {
        setChallengeToken(result.challenge.challengeToken)
        setMode('mfa')
      }
      else {
        setEmail('')
        setPartnerPortalSession(result.session)
      }
    }
    catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not start your session')
    }
    finally {
      setLoading(false)
    }
  }

  const submitMfa = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!challengeToken || !code.trim() || loading) return
    setLoading(true)
    setError(null)
    try {
      const session = await completePartnerMfaChallenge(challengeToken, code.trim())
      setCode('')
      setChallengeToken(null)
      setEmail('')
      setPartnerPortalSession(session)
    }
    catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Authentication could not be verified')
    }
    finally {
      setLoading(false)
    }
  }

  const submitRecovery = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!email.trim() || !recoveryCode.trim() || !newPassword || newPassword !== confirmation || loading) return
    setLoading(true)
    setError(null)
    try {
      await resetPartnerPasswordWithRecoveryCode({
        email: email.trim().toLowerCase(),
        newPassword,
        recoveryCode: recoveryCode.trim(),
      })
      begin('login')
      setSuccess('Password updated. Sign in with your new password.')
    }
    catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Recovery could not be completed')
    }
    finally {
      setLoading(false)
    }
  }

  const submitTokenReset = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!resetToken || !newPassword || newPassword !== confirmation || loading) return
    setLoading(true)
    setError(null)
    try {
      await resetPartnerPasswordWithToken(resetToken, newPassword)
      window.history.replaceState(null, '', '/partner')
      begin('login')
      setSuccess('Password set. You can now sign in.')
    }
    catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The reset link could not be used')
    }
    finally {
      setLoading(false)
    }
  }

  const passwordFields = (
    <>
      <label className="partner-label mt-5 block" htmlFor="partner-new-password">New password</label>
      <input
        autoComplete="new-password"
        className="partner-input mt-2 w-full"
        disabled={loading}
        id="partner-new-password"
        onChange={event => setNewPassword(event.target.value)}
        placeholder="At least 12 characters"
        type="password"
        value={newPassword}
      />
      <label className="partner-label mt-5 block" htmlFor="partner-confirm-password">Confirm password</label>
      <input
        autoComplete="new-password"
        className="partner-input mt-2 w-full"
        disabled={loading}
        id="partner-confirm-password"
        onChange={event => setConfirmation(event.target.value)}
        placeholder="Repeat your new password"
        type="password"
        value={confirmation}
      />
      {confirmation && newPassword !== confirmation && (
        <p className="mt-2 text-xs font-medium text-rose-700">Passwords do not match.</p>
      )}
    </>
  )

  return (
    <main className="partner-page flex min-h-screen items-center justify-center px-5 py-12">
      <div aria-hidden className="partner-login-orb partner-login-orb-left" />
      <div aria-hidden className="partner-login-orb partner-login-orb-right" />
      <section aria-labelledby="portal-sign-in-title" className="partner-login-panel relative w-full max-w-md">
        <img alt="Abroad" className="h-9 w-auto" src={AbroadLogo} />

        <div className="mt-10 inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-partner-mint text-partner-forest">
          {mode === 'login' ? <LockKeyhole aria-hidden className="h-5 w-5" /> : <KeyRound aria-hidden className="h-5 w-5" />}
        </div>
        <p className="mt-6 text-xs font-semibold uppercase tracking-[0.24em] text-partner-forest">
          Partner workspace
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-[-0.03em] text-partner-ink" id="portal-sign-in-title">
          {mode === 'login' && 'Your transaction ledger'}
          {mode === 'mfa' && 'Verify it’s you'}
          {mode === 'recovery' && 'Recover your account'}
          {mode === 'token-reset' && 'Set your password'}
        </h1>
        <p className="mt-3 text-sm leading-6 text-partner-muted">
          {mode === 'login' && 'Sign in with your individual partner account.'}
          {mode === 'mfa' && 'Enter your authenticator code or one unused recovery code.'}
          {mode === 'recovery' && 'Use one of the recovery codes saved when MFA was enabled.'}
          {mode === 'token-reset' && 'Choose a password to finish your invitation or password reset.'}
        </p>

        {mode === 'login' && (
          <form className="mt-8" onSubmit={event => void submitLogin(event)}>
            <label className="partner-label" htmlFor="partner-email">Email</label>
            <div className="relative mt-2">
              <Mail aria-hidden className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-partner-muted" />
              <input
                autoCapitalize="none"
                autoComplete="username"
                className="partner-input w-full pl-10"
                disabled={loading}
                id="partner-email"
                inputMode="email"
                onChange={event => setEmail(event.target.value)}
                placeholder="you@company.com"
                spellCheck={false}
                type="email"
                value={email}
              />
            </div>

            <label className="partner-label mt-5 block" htmlFor="partner-password">Password</label>
            <div className="relative mt-2">
              <input
                autoComplete="current-password"
                className="partner-input w-full pr-12"
                disabled={loading}
                id="partner-password"
                onChange={event => setPassword(event.target.value)}
                placeholder="Enter your password"
                type={showPassword ? 'text' : 'password'}
                value={password}
              />
              <button
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-partner-muted transition hover:text-partner-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-partner-forest"
                onClick={() => setShowPassword(current => !current)}
                type="button"
              >
                {showPassword ? <EyeOff aria-hidden className="h-4 w-4" /> : <Eye aria-hidden className="h-4 w-4" />}
              </button>
            </div>
            <button className="mt-3 text-xs font-semibold text-partner-forest hover:text-partner-ink" onClick={() => begin('recovery')} type="button">
              Use a recovery code
            </button>
            <button className="partner-button-primary mt-5 w-full" disabled={!email.trim() || !password || loading} type="submit">
              {loading ? <LoaderCircle aria-hidden className="h-4 w-4 animate-spin motion-reduce:animate-none" /> : <ArrowRight aria-hidden className="h-4 w-4" />}
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        )}

        {mode === 'mfa' && (
          <form className="mt-8" onSubmit={event => void submitMfa(event)}>
            <label className="partner-label" htmlFor="partner-mfa-code">Authentication or recovery code</label>
            <input
              autoComplete="one-time-code"
              autoFocus
              className="partner-input mt-2 w-full font-mono tracking-wider"
              disabled={loading}
              id="partner-mfa-code"
              onChange={event => setCode(event.target.value)}
              placeholder="000000"
              value={code}
            />
            <button className="partner-button-primary mt-5 w-full" disabled={!code.trim() || loading} type="submit">
              {loading && <LoaderCircle aria-hidden className="h-4 w-4 animate-spin motion-reduce:animate-none" />}
              Verify and continue
            </button>
            <button className="partner-button-secondary mt-3 w-full" onClick={() => begin('login')} type="button">
              <ArrowLeft aria-hidden className="h-4 w-4" />
              Back to sign in
            </button>
          </form>
        )}

        {mode === 'recovery' && (
          <form className="mt-8" onSubmit={event => void submitRecovery(event)}>
            <label className="partner-label" htmlFor="partner-recovery-email">Email</label>
            <input className="partner-input mt-2 w-full" id="partner-recovery-email" onChange={event => setEmail(event.target.value)} type="email" value={email} />
            <label className="partner-label mt-5 block" htmlFor="partner-recovery-code">Recovery code</label>
            <input className="partner-input mt-2 w-full font-mono" id="partner-recovery-code" onChange={event => setRecoveryCode(event.target.value)} value={recoveryCode} />
            {passwordFields}
            <button className="partner-button-primary mt-5 w-full" disabled={!email.trim() || !recoveryCode.trim() || !newPassword || newPassword !== confirmation || loading} type="submit">
              Reset password
            </button>
            <button className="partner-button-secondary mt-3 w-full" onClick={() => begin('login')} type="button">Back to sign in</button>
          </form>
        )}

        {mode === 'token-reset' && (
          <form className="mt-8" onSubmit={event => void submitTokenReset(event)}>
            {passwordFields}
            <button className="partner-button-primary mt-5 w-full" disabled={!resetToken || !newPassword || newPassword !== confirmation || loading} type="submit">
              Set password
            </button>
          </form>
        )}

        {error && <div aria-live="polite" className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800" role="alert">{error}</div>}
        {success && <div aria-live="polite" className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800" role="status">{success}</div>}

        {mode === 'login' && (
          <p className="mt-6 text-center text-sm text-partner-muted">
            New to Abroad?
            {' '}
            <a className="font-semibold text-partner-forest underline-offset-4 hover:underline" href="/partner/signup">
              Create a production workspace
            </a>
          </p>
        )}

        <div className="mt-7 flex gap-3 border-t border-partner-border pt-6 text-xs leading-5 text-partner-muted">
          <ShieldCheck aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-partner-forest" />
          <p>Passwords and one-time codes are never saved in this browser. Sessions expire after 30 minutes.</p>
        </div>
      </section>
    </main>
  )
}

export default PartnerPortalSignIn

import {
  ArrowRight, Eye, EyeOff, LoaderCircle, LockKeyhole, Mail, ShieldCheck,
} from 'lucide-react'
import { FormEvent, useState } from 'react'

import AbroadLogo from '../../assets/Logos/AbroadLogoColored.svg'
import { createPartnerPortalSession } from '../../services/partnerPortal/partnerPortalApi'
import { setPartnerPortalSession } from '../../services/partnerPortal/partnerPortalSessionStore'

const PartnerPortalSignIn = () => {
  const [email, setEmail] = useState('')
  const [error, setError] = useState<null | string>(null)
  const [loading, setLoading] = useState(false)
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const normalizedEmail = email.trim().toLowerCase()
    if (!normalizedEmail || !password || loading) return

    setLoading(true)
    setError(null)
    try {
      const session = await createPartnerPortalSession(normalizedEmail, password)
      setEmail('')
      setPassword('')
      setPartnerPortalSession(session)
    }
    catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not start your session')
    }
    finally {
      setLoading(false)
    }
  }

  return (
    <main className="partner-page flex min-h-screen items-center justify-center px-5 py-12">
      <div aria-hidden className="partner-login-orb partner-login-orb-left" />
      <div aria-hidden className="partner-login-orb partner-login-orb-right" />
      <section aria-labelledby="portal-sign-in-title" className="partner-login-panel relative w-full max-w-md">
        <img alt="Abroad" className="h-9 w-auto" src={AbroadLogo} />

        <div className="mt-10 inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-partner-mint text-partner-forest">
          <LockKeyhole aria-hidden className="h-5 w-5" />
        </div>
        <p className="mt-6 text-xs font-semibold uppercase tracking-[0.24em] text-partner-forest">
          Partner workspace
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-[-0.03em] text-partner-ink" id="portal-sign-in-title">
          Your transaction ledger
        </h1>
        <p className="mt-3 text-sm leading-6 text-partner-muted">
          Sign in with the credentials provided by Abroad to open your read-only workspace.
        </p>

        <form className="mt-8" onSubmit={event => void submit(event)}>
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

          {error && (
            <div aria-live="polite" className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800" role="alert">
              {error}
            </div>
          )}

          <button
            className="partner-button-primary mt-5 w-full"
            disabled={!email.trim() || !password || loading}
            type="submit"
          >
            {loading
              ? <LoaderCircle aria-hidden className="h-4 w-4 animate-spin motion-reduce:animate-none" />
              : <ArrowRight aria-hidden className="h-4 w-4" />}
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <div className="mt-7 flex gap-3 border-t border-partner-border pt-6 text-xs leading-5 text-partner-muted">
          <ShieldCheck aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-partner-forest" />
          <p>
            Your password is never saved in this browser. Sessions are read-only and expire after 30 minutes.
          </p>
        </div>
      </section>
    </main>
  )
}

export default PartnerPortalSignIn

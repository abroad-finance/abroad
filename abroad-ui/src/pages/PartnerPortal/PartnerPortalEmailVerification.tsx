import {
  AlertCircle, CheckCircle2, LoaderCircle, MailCheck,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import AbroadLogo from '../../assets/Logos/AbroadLogoColored.svg'
import { verifyPartnerPortalSignupEmail } from '../../services/partnerPortal/partnerPortalApi'
import { setPartnerPortalSession } from '../../services/partnerPortal/partnerPortalSessionStore'

type VerificationState = 'invalid' | 'verifying'

const initialVerificationToken = (): null | string => {
  if (typeof window === 'undefined') return null
  const token = new URLSearchParams(window.location.hash.slice(1)).get('token')?.trim()
  return token || null
}

const PartnerPortalEmailVerification = () => {
  const attemptedToken = useRef<null | string>(null)
  const navigate = useNavigate()
  const [error, setError] = useState<null | string>(null)
  const [state, setState] = useState<VerificationState>(() => (
    initialVerificationToken() ? 'verifying' : 'invalid'
  ))
  const [token] = useState(initialVerificationToken)

  useEffect(() => {
    if (!token || attemptedToken.current === token) return
    attemptedToken.current = token
    window.history.replaceState(null, '', '/partner/verify-email')
    void verifyPartnerPortalSignupEmail(token)
      .then((session) => {
        setPartnerPortalSession(session)
        navigate('/partner/transactions', { replace: true })
      })
      .catch((caught: unknown) => {
        setError(caught instanceof Error ? caught.message : 'Verification link is invalid or expired')
        setState('invalid')
      })
  }, [navigate, token])

  return (
    <main className="partner-page flex min-h-screen items-center justify-center px-5 py-12">
      <div aria-hidden className="partner-login-orb partner-login-orb-left" />
      <div aria-hidden className="partner-login-orb partner-login-orb-right" />
      <section aria-labelledby="verification-title" className="partner-login-panel relative w-full max-w-lg">
        <img alt="Abroad" className="h-9 w-auto" src={AbroadLogo} />
        <div className={`mt-10 inline-flex h-12 w-12 items-center justify-center rounded-2xl ${state === 'verifying' ? 'bg-partner-mint text-partner-forest' : 'bg-rose-50 text-rose-700'}`}>
          {state === 'verifying' ? <MailCheck aria-hidden className="h-6 w-6" /> : <AlertCircle aria-hidden className="h-6 w-6" />}
        </div>
        <p className="partner-eyebrow mt-7">Email verification</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-[-0.03em] text-partner-ink" id="verification-title">
          {state === 'verifying' ? 'Activating your workspace' : 'This link cannot be used'}
        </h1>
        {state === 'verifying'
          ? (
              <div aria-live="polite" className="mt-5 flex items-center gap-3 rounded-2xl border border-partner-border bg-partner-ledger px-4 py-4 text-sm text-partner-ink" role="status">
                <LoaderCircle aria-hidden className="h-5 w-5 shrink-0 animate-spin text-partner-forest motion-reduce:animate-none" />
                Verifying the administrator email and opening the partner workspace…
              </div>
            )
          : (
              <>
                <p className="mt-4 text-sm leading-6 text-partner-muted">
                  {error ?? 'The verification link is missing, expired, or has already been used.'}
                </p>
                <div className="mt-7 flex flex-col gap-3 sm:flex-row">
                  <a className="partner-button-primary" href="/partner/signup">Start signup again</a>
                  <a className="partner-button-secondary" href="/partner">Back to sign in</a>
                </div>
              </>
            )}
        <div className="mt-8 flex gap-3 border-t border-partner-border pt-6 text-xs leading-5 text-partner-muted">
          <CheckCircle2 aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-partner-forest" />
          <p>The link is single-use. Verification creates only the existing short-lived portal session.</p>
        </div>
      </section>
    </main>
  )
}

export default PartnerPortalEmailVerification

import type { FormEvent } from 'react'

import {
  ArrowRight,
  Building2,
  Check,
  Eye,
  EyeOff,
  KeyRound,
  LoaderCircle,
  MailCheck,
  ShieldCheck,
} from 'lucide-react'
import { useEffect, useState } from 'react'

import AbroadLogo from '../../assets/Logos/AbroadLogoColored.svg'
import {
  createPartnerPortalSignup,
  createPartnerPortalSignupChallenge,
  resendPartnerPortalSignupVerificationEmail,
} from '../../services/partnerPortal/partnerPortalApi'
import { partnerCountryOptions } from './partnerCountryOptions'

const RESEND_COOLDOWN_MS = 60_000

const signupSteps = [
  {
    description: 'Your organization and first administrator are created together.',
    icon: Building2,
    label: 'Create workspace',
  },
  {
    description: 'Use the single-use email link before sign-in is enabled.',
    icon: MailCheck,
    label: 'Verify email',
  },
  {
    description: 'Enable MFA before managing integration credentials.',
    icon: ShieldCheck,
    label: 'Secure administrator',
  },
  {
    description: 'Create your production API key in the existing Integration screen.',
    icon: KeyRound,
    label: 'Connect production',
  },
] as const

type SignupDraft = {
  company: string
  confirmation: string
  contactWebsite: string
  country: string
  email: string
  firstName: string
  lastName: string
  password: string
}

const initialDraft: SignupDraft = {
  company: '',
  confirmation: '',
  contactWebsite: '',
  country: '',
  email: '',
  firstName: '',
  lastName: '',
  password: '',
}

const createIdempotencyKey = (): string => {
  if (typeof globalThis.crypto.randomUUID === 'function') {
    return globalThis.crypto.randomUUID()
  }
  const randomValues = globalThis.crypto.getRandomValues(new Uint32Array(4))
  const randomPart = Array.from(randomValues, value => value.toString(36)).join('')
  return `signup-${Date.now().toString(36)}-${randomPart}`
}

const isValidEmail = (value: string): boolean => {
  if (/\s/u.test(value)) return false
  const separatorIndex = value.indexOf('@')
  if (separatorIndex <= 0 || separatorIndex !== value.lastIndexOf('@')) return false
  const domain = value.slice(separatorIndex + 1)
  const domainSeparatorIndex = domain.indexOf('.')
  return domainSeparatorIndex > 0 && domainSeparatorIndex < domain.length - 1
}

const waitForChallenge = async (readyAt: string, expiresAt: string): Promise<void> => {
  const readyAtMs = Date.parse(readyAt)
  const expiresAtMs = Date.parse(expiresAt)
  if (
    !Number.isFinite(readyAtMs)
    || !Number.isFinite(expiresAtMs)
    || readyAtMs >= expiresAtMs
  ) {
    throw new Error('Secure signup could not be prepared. Please try again.')
  }
  const remainingMs = Math.max(0, readyAtMs - Date.now())
  if (remainingMs > 0) {
    await new Promise(resolve => window.setTimeout(resolve, remainingMs))
  }
}

const validateDraft = (draft: SignupDraft): null | string => {
  if (!draft.firstName.trim() || !draft.lastName.trim()) return 'Enter the administrator’s name.'
  if (!draft.company.trim()) return 'Enter your organization name.'
  if (!draft.country) return 'Select your organization country.'
  if (!isValidEmail(draft.email.trim())) return 'Enter a valid administrator email.'
  if (draft.password.length < 12 || draft.password.length > 128) {
    return 'Password must be between 12 and 128 characters.'
  }
  if (draft.password !== draft.confirmation) return 'Passwords do not match.'
  return null
}

const PartnerPortalSignup = () => {
  const [canResend, setCanResend] = useState(false)
  const [draft, setDraft] = useState<SignupDraft>(initialDraft)
  const [error, setError] = useState<null | string>(null)
  const [idempotencyKey] = useState(createIdempotencyKey)
  const [loading, setLoading] = useState(false)
  const [resendNotice, setResendNotice] = useState<null | string>(null)
  const [showPassword, setShowPassword] = useState(false)
  const [submitted, setSubmitted] = useState(false)

  useEffect(() => {
    if (!submitted || canResend) return undefined
    const timer = window.setTimeout(() => setCanResend(true), RESEND_COOLDOWN_MS)
    return () => window.clearTimeout(timer)
  }, [canResend, submitted])

  const updateDraft = <TField extends keyof SignupDraft>(
    field: TField,
    value: SignupDraft[TField],
  ) => setDraft(current => ({ ...current, [field]: value }))

  const submit = async () => {
    if (loading) return
    const validationError = validateDraft(draft)
    if (validationError) {
      setError(validationError)
      return
    }

    setError(null)
    setResendNotice(null)
    setLoading(true)
    try {
      const challenge = await createPartnerPortalSignupChallenge()
      await waitForChallenge(challenge.readyAt, challenge.expiresAt)
      const result = await createPartnerPortalSignup({
        challengeToken: challenge.challengeToken,
        company: draft.company.trim().replace(/\s+/gu, ' '),
        contactWebsite: draft.contactWebsite,
        country: draft.country,
        email: draft.email.trim().toLowerCase(),
        firstName: draft.firstName.trim().replace(/\s+/gu, ' '),
        lastName: draft.lastName.trim().replace(/\s+/gu, ' '),
        password: draft.password,
      }, idempotencyKey)
      if (result.status !== 'VERIFICATION_REQUIRED') {
        throw new Error('Signup could not be completed. Please try again.')
      }
      setCanResend(false)
      setSubmitted(true)
    }
    catch (error_) {
      setError(error_ instanceof Error ? error_.message : 'Signup could not be completed')
    }
    finally {
      setLoading(false)
    }
  }

  const resend = async () => {
    if (loading) return
    if (!isValidEmail(draft.email.trim()) || draft.password.length < 12) {
      setError('Enter the administrator email and password again.')
      return
    }
    setError(null)
    setResendNotice(null)
    setLoading(true)
    try {
      const challenge = await createPartnerPortalSignupChallenge()
      await waitForChallenge(challenge.readyAt, challenge.expiresAt)
      const result = await resendPartnerPortalSignupVerificationEmail({
        challengeToken: challenge.challengeToken,
        contactWebsite: draft.contactWebsite,
        email: draft.email.trim().toLowerCase(),
        password: draft.password,
      })
      if (result.status !== 'VERIFICATION_REQUIRED') {
        throw new Error('Another link could not be requested. Please try again.')
      }
      setCanResend(false)
      setResendNotice('If this pending account is eligible, another verification link is now queued.')
    }
    catch (error_) {
      setError(error_ instanceof Error ? error_.message : 'Another link could not be requested')
    }
    finally {
      setLoading(false)
    }
  }

  const submitForm = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    void submit()
  }

  return (
    <main className="partner-page min-h-screen px-5 py-8 sm:px-8 sm:py-12">
      <div aria-hidden className="partner-login-orb partner-login-orb-left" />
      <div aria-hidden className="partner-login-orb partner-login-orb-right" />
      <div className="relative mx-auto w-full max-w-6xl">
        <a
          aria-label="Abroad partner sign in"
          className="inline-flex rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-partner-forest"
          href="/partner"
        >
          <img alt="Abroad" className="h-8 w-auto" src={AbroadLogo} />
        </a>

        <div className="mt-8 grid items-start gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(19rem,0.65fr)]">
          <section aria-labelledby="partner-signup-title" className="partner-login-panel relative">
            {submitted
              ? (
                  <div className="flex min-h-[32rem] flex-col justify-center">
                    <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-partner-mint text-partner-forest">
                      <MailCheck aria-hidden className="h-6 w-6" />
                    </div>
                    <p className="partner-eyebrow mt-7">Email verification</p>
                    <h1 className="mt-2 text-3xl font-semibold tracking-[-0.03em] text-partner-ink" id="partner-signup-title">
                      Verification link queued
                    </h1>
                    <p className="mt-4 max-w-lg text-sm leading-6 text-partner-muted">
                      If these details can be registered, a single-use verification link is being prepared for the administrator email. It expires in 24 hours.
                    </p>
                    <div aria-live="polite" className="mt-6 rounded-2xl border border-partner-border bg-partner-ledger px-4 py-4 text-sm leading-6 text-partner-ink" role="status">
                      Open the link on this device or another one. After verification, you will enter the existing partner workspace.
                    </div>
                    {error && <div aria-live="polite" className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800" role="alert">{error}</div>}
                    {resendNotice && <div aria-live="polite" className="mt-4 rounded-xl border border-partner-border bg-partner-mint px-4 py-3 text-sm text-partner-ink">{resendNotice}</div>}
                    <div className="mt-7 flex flex-col gap-3 sm:flex-row">
                      <button
                        className="partner-button-secondary"
                        disabled={!canResend || loading}
                        onClick={() => void resend()}
                        type="button"
                      >
                        {loading && <LoaderCircle aria-hidden className="h-4 w-4 animate-spin motion-reduce:animate-none" />}
                        {canResend ? 'Send another link' : 'Another link available in one minute'}
                      </button>
                      <a className="partner-button-primary" href="/partner">
                        Back to sign in
                        <ArrowRight aria-hidden className="h-4 w-4" />
                      </a>
                    </div>
                  </div>
                )
              : (
                  <>
                    <p className="partner-eyebrow">Production partner access</p>
                    <h1 className="mt-3 text-3xl font-semibold tracking-[-0.035em] text-partner-ink sm:text-4xl" id="partner-signup-title">
                      Create your Abroad workspace
                    </h1>
                    <p className="mt-4 max-w-2xl text-sm leading-6 text-partner-muted">
                      Register your organization and first administrator. Verify the email, then use the existing portal to secure the account and create production credentials.
                    </p>

                    <form className="mt-8" onSubmit={submitForm}>
                      <fieldset className="grid gap-x-4 gap-y-5 sm:grid-cols-2" disabled={loading}>
                        <legend className="sr-only">Organization and administrator details</legend>
                        <div>
                          <label className="partner-label" htmlFor="signup-first-name">First name</label>
                          <input
                            autoComplete="given-name"
                            className="partner-input mt-2 w-full"
                            id="signup-first-name"
                            maxLength={100}
                            onChange={event => updateDraft('firstName', event.target.value)}
                            required
                            value={draft.firstName}
                          />
                        </div>
                        <div>
                          <label className="partner-label" htmlFor="signup-last-name">Last name</label>
                          <input
                            autoComplete="family-name"
                            className="partner-input mt-2 w-full"
                            id="signup-last-name"
                            maxLength={100}
                            onChange={event => updateDraft('lastName', event.target.value)}
                            required
                            value={draft.lastName}
                          />
                        </div>
                        <div className="sm:col-span-2">
                          <label className="partner-label" htmlFor="signup-company">Organization</label>
                          <input
                            autoComplete="organization"
                            className="partner-input mt-2 w-full"
                            id="signup-company"
                            maxLength={160}
                            onChange={event => updateDraft('company', event.target.value)}
                            placeholder="Your company name"
                            required
                            value={draft.company}
                          />
                        </div>
                        <div>
                          <label className="partner-label" htmlFor="signup-country">Organization country</label>
                          <select
                            autoComplete="country"
                            className="partner-select mt-2 w-full"
                            id="signup-country"
                            onChange={event => updateDraft('country', event.target.value)}
                            required
                            value={draft.country}
                          >
                            <option value="">Select country</option>
                            {partnerCountryOptions.map(country => (
                              <option key={country.code} value={country.code}>{country.name}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="partner-label" htmlFor="signup-email">Administrator email</label>
                          <input
                            autoCapitalize="none"
                            autoComplete="email"
                            className="partner-input mt-2 w-full"
                            id="signup-email"
                            inputMode="email"
                            maxLength={254}
                            onChange={event => updateDraft('email', event.target.value)}
                            placeholder="you@company.com"
                            required
                            spellCheck={false}
                            type="email"
                            value={draft.email}
                          />
                        </div>
                        <div>
                          <label className="partner-label" htmlFor="signup-password">Password</label>
                          <div className="relative mt-2">
                            <input
                              aria-describedby="signup-password-help"
                              autoComplete="new-password"
                              className="partner-input w-full pr-12"
                              id="signup-password"
                              maxLength={128}
                              minLength={12}
                              onChange={event => updateDraft('password', event.target.value)}
                              required
                              type={showPassword ? 'text' : 'password'}
                              value={draft.password}
                            />
                            <button
                              aria-label={showPassword ? 'Hide password' : 'Show password'}
                              className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-xl text-partner-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-partner-forest"
                              onClick={() => setShowPassword(current => !current)}
                              type="button"
                            >
                              {showPassword ? <EyeOff aria-hidden className="h-4 w-4" /> : <Eye aria-hidden className="h-4 w-4" />}
                            </button>
                          </div>
                          <p className="mt-2 text-xs leading-5 text-partner-muted" id="signup-password-help">12–128 characters.</p>
                        </div>
                        <div>
                          <label className="partner-label" htmlFor="signup-confirmation">Confirm password</label>
                          <input
                            autoComplete="new-password"
                            className="partner-input mt-2 w-full"
                            id="signup-confirmation"
                            maxLength={128}
                            minLength={12}
                            onChange={event => updateDraft('confirmation', event.target.value)}
                            required
                            type={showPassword ? 'text' : 'password'}
                            value={draft.confirmation}
                          />
                          {draft.confirmation && draft.password !== draft.confirmation && (
                            <p className="mt-2 text-xs font-medium text-rose-700">Passwords do not match.</p>
                          )}
                        </div>
                        <div aria-hidden className="absolute -left-[10000px] h-px w-px overflow-hidden">
                          <label htmlFor="signup-contact-website">Website</label>
                          <input
                            autoComplete="off"
                            id="signup-contact-website"
                            onChange={event => updateDraft('contactWebsite', event.target.value)}
                            tabIndex={-1}
                            value={draft.contactWebsite}
                          />
                        </div>
                      </fieldset>

                      {error && <div aria-live="polite" className="mt-5 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800" role="alert">{error}</div>}
                      <button className="partner-button-primary mt-6 w-full sm:w-auto" disabled={loading} type="submit">
                        {loading ? <LoaderCircle aria-hidden className="h-4 w-4 animate-spin motion-reduce:animate-none" /> : <ArrowRight aria-hidden className="h-4 w-4" />}
                        {loading ? 'Preparing secure signup…' : 'Create workspace'}
                      </button>
                      <p className="mt-5 text-xs leading-5 text-partner-muted">
                        Already have an account?
                        {' '}
                        <a className="font-semibold text-partner-forest underline-offset-4 hover:underline" href="/partner">Sign in</a>
                      </p>
                    </form>
                  </>
                )}
          </section>

          <aside aria-label="Production connection steps" className="partner-signup-rail">
            <p className="partner-eyebrow">Your path to production</p>
            <h2 className="mt-3 text-2xl font-semibold tracking-[-0.03em] text-partner-ink">Four clear steps</h2>
            <ol className="mt-7 space-y-1">
              {signupSteps.map((step, index) => (
                <li className="relative grid grid-cols-[2.75rem_1fr] gap-3 pb-7 last:pb-0" key={step.label}>
                  {index < signupSteps.length - 1 && <span aria-hidden className="absolute left-[1.35rem] top-10 h-[calc(100%-1.5rem)] w-px bg-partner-border" />}
                  <span className={`relative z-10 inline-flex h-11 w-11 items-center justify-center rounded-2xl border ${index === 0 ? 'border-partner-forest bg-partner-forest text-white' : 'border-partner-border bg-white text-partner-forest'}`}>
                    {index === 0 ? <Check aria-hidden className="h-5 w-5" /> : <step.icon aria-hidden className="h-5 w-5" />}
                  </span>
                  <div className="pt-1">
                    <p className="text-sm font-semibold text-partner-ink">{step.label}</p>
                    <p className="mt-1 text-xs leading-5 text-partner-muted">{step.description}</p>
                  </div>
                </li>
              ))}
            </ol>
            <div className="mt-8 rounded-2xl border border-partner-border bg-white/75 p-4 text-xs leading-5 text-partner-muted">
              Signup creates no API key or webhook secret automatically. Those remain one-time-reveal actions protected by administrator MFA.
            </div>
          </aside>
        </div>
      </div>
    </main>
  )
}

export default PartnerPortalSignup

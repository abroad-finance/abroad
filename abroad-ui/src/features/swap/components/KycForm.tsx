import { useTranslate } from '@tolgee/react'
import {
  Check,
  FileText,
  HelpCircle,
  ShieldCheck,
  Upload,
  X,
} from 'lucide-react'
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

import {
  bucketElapsedMilliseconds,
  createTelemetrySessionKey,
  recordConsumerUxEvent,
} from '@/observability/consumerUxTelemetry'

import type {
  KycField,
  KycFieldErrorCode,
  KycFieldErrors,
  KycStep,
  KycTextValues,
} from '../shared/kycFormModel'
import type {
  KycDocumentType,
  KycFormValues,
  KycSubmissionStatus,
  KycSubmitOutcome,
} from '../types'

import { Button } from '../../../shared/components/Button'
import { ModalSurface } from '../../../shared/components/ModalSurface'
import { ABROAD_PRIVACY_URL, ABROAD_SUPPORT_URL } from '../../../shared/constants'
import {
  EMPTY_KYC_TEXT_VALUES,
  getKycStepFields,
  isKycDraftDirty,
  KYC_ACCEPTED_MIME_TYPES,
  KYC_DOCUMENT_TYPES,
  validateKycDocument,
  validateKycField,
  validateKycStep,
} from '../shared/kycFormModel'

interface KycFormProps {
  canResumePayment: boolean
  onClose: () => void
  onSubmit: (values: KycFormValues) => Promise<KycSubmitOutcome>
}

const STEPS: readonly KycStep[] = [
  'about',
  'contact',
  'document',
]

const inputClass = 'min-h-12 w-full rounded-xl border border-[var(--ab-border)] bg-[var(--ab-bg-subtle)] px-4 py-3 text-base text-ab-text placeholder:text-[var(--ab-text-secondary)] focus:border-[var(--ab-text)] focus:outline-none focus:ring-2 focus:ring-[var(--ab-border-strong)] disabled:cursor-not-allowed disabled:opacity-60'

const fieldErrorClass = 'border-red-500 focus:border-red-500 focus:ring-red-200'

const documentTypeFallbacks: Record<KycDocumentType, string> = {
  DRIVERS_LICENSE: 'Driver\'s license',
  FOREIGN_ID: 'Foreign ID',
  NATIONAL_ID: 'National ID',
  OTHER: 'Other',
  PASSPORT: 'Passport',
}

const documentTypeTranslationKeys: Record<KycDocumentType, string> = {
  DRIVERS_LICENSE: 'kyc_form.doc_type.drivers_license',
  FOREIGN_ID: 'kyc_form.doc_type.foreign_id',
  NATIONAL_ID: 'kyc_form.doc_type.national_id',
  OTHER: 'kyc_form.doc_type.other',
  PASSPORT: 'kyc_form.doc_type.passport',
}

const stepIndex = (step: KycStep): number => STEPS.indexOf(step)

const firstStepForErrors = (errors: KycFieldErrors): KycStep => (
  STEPS.find(step => getKycStepFields(step).some(field => errors[field])) ?? 'about'
)

const KycForm = ({ canResumePayment, onClose, onSubmit }: KycFormProps): React.JSX.Element => {
  const { t } = useTranslate()
  const [values, setValues] = useState<KycTextValues>(EMPTY_KYC_TEXT_VALUES)
  const [document, setDocument] = useState<File | null>(null)
  const [documentChecking, setDocumentChecking] = useState(false)
  const [errors, setErrors] = useState<KycFieldErrors>({})
  const [step, setStep] = useState<KycStep>('about')
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<null | string>(null)
  const [submissionStatus, setSubmissionStatus] = useState<KycSubmissionStatus | null>(null)
  const [showCancelConfirmation, setShowCancelConfirmation] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const submissionInFlightRef = useRef(false)
  const pendingFocusRef = useRef<KycField | null>(null)
  const openedAtRef = useRef(Date.now())
  const telemetrySessionKeyRef = useRef(createTelemetrySessionKey())
  const stepRef = useRef<KycStep>('about')
  const fullNameRef = useRef<HTMLInputElement>(null)
  const dateOfBirthRef = useRef<HTMLInputElement>(null)
  const nationalityRef = useRef<HTMLInputElement>(null)
  const emailRef = useRef<HTMLInputElement>(null)
  const phoneRef = useRef<HTMLInputElement>(null)
  const cityRef = useRef<HTMLInputElement>(null)
  const addressRef = useRef<HTMLInputElement>(null)
  const documentTypeRef = useRef<HTMLSelectElement>(null)
  const documentNumberRef = useRef<HTMLInputElement>(null)
  const documentUploadRef = useRef<HTMLButtonElement>(null)

  const todayIso = useMemo(() => new Date().toISOString().slice(0, 10), [])
  const currentStepIndex = stepIndex(step)
  stepRef.current = step

  const recordVerificationEvent = useCallback((
    name:
      | 'verification_cancelled'
      | 'verification_resumed'
      | 'verification_step_viewed'
      | 'verification_submit_outcome'
      | 'verification_validation_outcome'
      | 'verification_viewed',
    dimensions: {
      errorCategory?: 'invalid' | 'network' | 'required' | 'server' | 'too_large' | 'unknown' | 'unreadable' | 'unsupported'
      fieldCategory?: 'address' | 'contact' | 'date_of_birth' | 'document' | 'general' | 'identity' | 'name'
      outcome?: 'approved' | 'cancelled' | 'failed' | 'pending' | 'rejected' | 'requires_more_info' | 'success' | 'unavailable'
      targetStep?: KycStep
    } = {},
  ): void => {
    const sessionKey = telemetrySessionKeyRef.current
    if (!sessionKey) return
    const targetStep = dimensions.targetStep ?? stepRef.current
    recordConsumerUxEvent({
      dimensions: {
        elapsed_bucket: bucketElapsedMilliseconds(Date.now() - openedAtRef.current),
        error_category: dimensions.errorCategory,
        field_category: dimensions.fieldCategory,
        outcome: dimensions.outcome,
        step: targetStep === 'contact'
          ? 'contact_address'
          : targetStep === 'document'
            ? 'document_review'
            : 'about',
        trigger_category: 'compliance_required',
      },
      name,
      session: { key: sessionKey, kind: 'verification' },
    }, {
      onceKey: name === 'verification_viewed'
        ? `${sessionKey}:viewed`
        : name === 'verification_step_viewed'
          ? `${sessionKey}:step:${targetStep}`
          : undefined,
    })
  }, [])

  useEffect(() => {
    recordVerificationEvent('verification_viewed', { targetStep: 'about' })
  }, [recordVerificationEvent])

  useEffect(() => {
    recordVerificationEvent('verification_step_viewed', { targetStep: step })
  }, [recordVerificationEvent, step])

  const fieldLabel = useCallback((field: KycField): string => {
    const labels: Record<KycField, string> = {
      address: t('kyc_form.address', 'Address'),
      city: t('kyc_form.city', 'City of residence'),
      dateOfBirth: t('kyc_form.date_of_birth', 'Date of birth'),
      document: t('kyc_form.document_image', 'Document file'),
      documentNumber: t('kyc_form.document_number', 'Document number'),
      documentType: t('kyc_form.document_type', 'Document type'),
      email: t('kyc_form.email', 'Email'),
      fullName: t('kyc_form.full_name', 'Full name'),
      nationality: t('kyc_form.nationality', 'Country of nationality'),
      phone: t('kyc_form.phone', 'Phone'),
    }
    return labels[field]
  }, [t])

  const errorMessage = useCallback((code: KycFieldErrorCode): string => {
    const messages: Record<KycFieldErrorCode, string> = {
      'document-empty': t('kyc_form.error_document_empty', 'This file is empty. Choose another document.'),
      'document-quality': t('kyc_form.error_document_quality', 'The image is too small to review. Choose a clearer image.'),
      'document-required': t('kyc_form.error_document', 'Choose a document file before continuing.'),
      'document-size': t('kyc_form.error_document_size', 'The document must be smaller than 8 MB.'),
      'document-type': t('kyc_form.error_document_type', 'Choose a JPG, PNG, WEBP, HEIC, or PDF file.'),
      'document-unreadable': t('kyc_form.error_document_unreadable', 'We could not read this image. Choose another file.'),
      'future-date': t('kyc_form.error_date_future', 'Date of birth must be in the past.'),
      'invalid-date': t('kyc_form.error_date_invalid', 'Enter a valid date of birth.'),
      'invalid-email': t('kyc_form.error_email', 'Enter a valid email address.'),
      'invalid-phone': t('kyc_form.error_phone', 'Enter a phone number with 7 to 15 digits.'),
      'required': t('kyc_form.error_field_required', 'This field is required.'),
    }
    return messages[code]
  }, [t])

  const focusField = useCallback((field: KycField): void => {
    const refs: Record<KycField, React.RefObject<HTMLElement | null>> = {
      address: addressRef,
      city: cityRef,
      dateOfBirth: dateOfBirthRef,
      document: documentUploadRef,
      documentNumber: documentNumberRef,
      documentType: documentTypeRef,
      email: emailRef,
      fullName: fullNameRef,
      nationality: nationalityRef,
      phone: phoneRef,
    }
    refs[field].current?.focus()
  }, [])

  useEffect(() => {
    const field = pendingFocusRef.current
    if (!field) return
    pendingFocusRef.current = null
    focusField(field)
  }, [
    errors,
    focusField,
    step,
  ])

  const setField = useCallback((field: keyof KycTextValues, value: string): void => {
    setValues(current => ({ ...current, [field]: value }))
    setErrors(current => ({ ...current, [field]: undefined }))
    setSubmitError(null)
  }, [])

  const validateTextField = useCallback((field: Exclude<KycField, 'document'>): void => {
    const code = validateKycField(field, values[field], todayIso)
    setErrors(current => ({ ...current, [field]: code ?? undefined }))
  }, [todayIso, values])

  const revealErrors = useCallback((nextErrors: KycFieldErrors): boolean => {
    const fields = STEPS.flatMap(candidate => getKycStepFields(candidate))
    const firstInvalid = fields.find(field => nextErrors[field])
    setErrors(nextErrors)
    if (!firstInvalid) return false
    const errorStep = firstStepForErrors(nextErrors)
    pendingFocusRef.current = firstInvalid
    setStep(errorStep)
    return true
  }, [])

  const validateCurrentStep = useCallback((): boolean => {
    const nextErrors = validateKycStep(step, values, document, todayIso)
    return !revealErrors(nextErrors)
  }, [
    document,
    revealErrors,
    step,
    todayIso,
    values,
  ])

  const handleContinue = useCallback((): void => {
    setSubmitError(null)
    if (!validateCurrentStep()) {
      recordVerificationEvent('verification_validation_outcome', {
        errorCategory: 'invalid',
        fieldCategory: step === 'about' ? 'identity' : step === 'contact' ? 'contact' : 'document',
        outcome: 'failed',
      })
      return
    }
    recordVerificationEvent('verification_validation_outcome', { outcome: 'success' })
    const nextStep = STEPS[currentStepIndex + 1]
    if (nextStep) setStep(nextStep)
  }, [
    currentStepIndex,
    recordVerificationEvent,
    step,
    validateCurrentStep,
  ])

  const handleBack = useCallback((): void => {
    setSubmitError(null)
    const previousStep = STEPS[currentStepIndex - 1]
    if (previousStep) setStep(previousStep)
  }, [currentStepIndex])

  const checkImageQuality = useCallback(async (file: File): Promise<KycFieldErrorCode | null> => {
    if (!file.type.startsWith('image/') || file.type === 'image/heic') return null
    if (typeof createImageBitmap !== 'function') return null
    try {
      const bitmap = await createImageBitmap(file)
      const isTooSmall = bitmap.width < 640 || bitmap.height < 400
      bitmap.close()
      return isTooSmall ? 'document-quality' : null
    }
    catch {
      return 'document-unreadable'
    }
  }, [])

  const handleFileChange = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    setSubmitError(null)
    const fileError = validateKycDocument(file)
    if (fileError) {
      setErrors(current => ({ ...current, document: fileError }))
      recordVerificationEvent('verification_validation_outcome', {
        errorCategory: fileError === 'document-size'
          ? 'too_large'
          : fileError === 'document-type'
            ? 'unsupported'
            : 'invalid',
        fieldCategory: 'document',
        outcome: 'failed',
      })
      return
    }

    setDocumentChecking(true)
    const qualityError = await checkImageQuality(file)
    setDocumentChecking(false)
    if (qualityError) {
      setErrors(current => ({ ...current, document: qualityError }))
      recordVerificationEvent('verification_validation_outcome', {
        errorCategory: qualityError === 'document-unreadable' ? 'unreadable' : 'invalid',
        fieldCategory: 'document',
        outcome: 'failed',
      })
      return
    }

    setDocument(file)
    setErrors(current => ({ ...current, document: undefined }))
  }, [checkImageQuality, recordVerificationEvent])

  const removeDocument = useCallback((): void => {
    setDocument(null)
    setErrors(current => ({ ...current, document: 'document-required' }))
    if (fileInputRef.current) fileInputRef.current.value = ''
    documentUploadRef.current?.focus()
  }, [])

  const requestClose = useCallback((): void => {
    if (submitting) return
    if (isKycDraftDirty(values, document)) {
      setShowCancelConfirmation(true)
      return
    }
    recordVerificationEvent('verification_cancelled', { outcome: 'cancelled' })
    onClose()
  }, [
    document,
    onClose,
    recordVerificationEvent,
    submitting,
    values,
  ])

  const handleSubmit = useCallback(async (event: React.FormEvent) => {
    event.preventDefault()
    if (submissionInFlightRef.current || documentChecking) return

    const nextErrors: KycFieldErrors = {
      ...validateKycStep('about', values, document, todayIso),
      ...validateKycStep('contact', values, document, todayIso),
      ...validateKycStep('document', values, document, todayIso),
    }
    if (revealErrors(nextErrors) || !document || !values.documentType) {
      recordVerificationEvent('verification_validation_outcome', {
        errorCategory: 'invalid',
        fieldCategory: 'general',
        outcome: 'failed',
      })
      return
    }

    submissionInFlightRef.current = true
    setSubmitting(true)
    setSubmitError(null)
    try {
      const outcome = await onSubmit({
        ...values,
        address: values.address.trim(),
        city: values.city.trim(),
        document,
        documentNumber: values.documentNumber.trim(),
        documentType: values.documentType,
        email: values.email.trim(),
        fullName: values.fullName.trim(),
        nationality: values.nationality.trim(),
        phone: values.phone.trim(),
      })
      if (!outcome.ok) {
        setSubmitError(outcome.error ?? t('kyc_form.submit_error', 'We could not submit your verification. Your details are still here. Try again.'))
        recordVerificationEvent('verification_submit_outcome', {
          errorCategory: outcome.errorCode === 'service-unavailable' ? 'network' : 'invalid',
          outcome: outcome.errorCode === 'service-unavailable' ? 'unavailable' : 'failed',
        })
        return
      }
      const status = outcome.status ?? 'APPROVED'
      setSubmissionStatus(status)
      recordVerificationEvent('verification_submit_outcome', {
        outcome: status === 'APPROVED'
          ? 'approved'
          : status === 'REJECTED'
            ? 'rejected'
            : status === 'PENDING_APPROVAL'
              ? 'requires_more_info'
              : 'pending',
      })
      if (status === 'APPROVED' && canResumePayment) {
        recordVerificationEvent('verification_resumed', { outcome: 'success' })
      }
    }
    catch {
      setSubmitError(t('kyc_form.submit_error', 'We could not submit your verification. Your details are still here. Try again.'))
      recordVerificationEvent('verification_submit_outcome', {
        errorCategory: 'unknown',
        outcome: 'failed',
      })
    }
    finally {
      submissionInFlightRef.current = false
      setSubmitting(false)
    }
  }, [
    canResumePayment,
    document,
    documentChecking,
    onSubmit,
    recordVerificationEvent,
    revealErrors,
    t,
    todayIso,
    values,
  ])

  const stepTitle = step === 'about'
    ? t('kyc_form.step_about', 'About you')
    : step === 'contact'
      ? t('kyc_form.step_contact', 'Contact and address')
      : t('kyc_form.step_document', 'Document and review')

  const currentErrors = getKycStepFields(step).filter(field => errors[field])
  const describedBy = (field: KycField): string | undefined => (
    errors[field] ? `kyc-${field}-error` : undefined
  )
  const fieldClass = (field: KycField): string => (
    errors[field] ? `${inputClass} ${fieldErrorClass}` : inputClass
  )

  if (submissionStatus && submissionStatus !== 'APPROVED') {
    const rejected = submissionStatus === 'REJECTED'
    return (
      <section aria-labelledby="kyc-outcome-title" className="mx-auto my-4 w-full max-w-xl rounded-3xl border border-[var(--ab-border)] bg-[var(--ab-card)] p-5 text-ab-text shadow-xl md:p-7">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--ab-bg-subtle)]">
          {rejected ? <X aria-hidden className="h-6 w-6 text-red-500" /> : <ShieldCheck aria-hidden className="h-6 w-6 text-ab-text" />}
        </div>
        <h2 className="mt-5 text-2xl font-semibold" id="kyc-outcome-title">
          {rejected
            ? t('kyc_form.outcome_rejected_title', 'Verification needs attention')
            : t('kyc_form.outcome_review_title', 'Verification received')}
        </h2>
        <p className="mt-2 text-sm leading-6 text-[var(--ab-text-secondary)]">
          {rejected
            ? t('kyc_form.outcome_rejected_body', 'This verification was not approved. Contact support before trying another payment.')
            : t('kyc_form.outcome_review_body', 'Your verification is being reviewed. No payment has been created or charged.')}
        </p>
        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          <a className="inline-flex min-h-11 items-center justify-center rounded-xl border border-[var(--ab-border)] px-4 font-semibold" href={ABROAD_SUPPORT_URL} rel="noreferrer" target="_blank">
            {t('kyc_form.get_help', 'Get help')}
          </a>
          <Button className="min-h-11 flex-1" onClick={onClose} type="button">
            {t('kyc_form.return_home', 'Return home')}
          </Button>
        </div>
      </section>
    )
  }

  return (
    <div className="flex w-full flex-1 items-start justify-center">
      <form
        className="my-4 flex w-full max-w-xl flex-col gap-5 rounded-3xl border border-[var(--ab-border)] bg-[var(--ab-card)] p-4 text-ab-text shadow-xl md:p-7"
        noValidate
        onSubmit={handleSubmit}
      >
        <header className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--ab-text-secondary)]">
              {t('kyc_form.progress', 'Step {current} of {total}', {
                current: currentStepIndex + 1,
                total: STEPS.length,
              })}
            </p>
            <h2 className="mt-1 text-2xl font-semibold" id="kyc-title">{t('kyc_form.title', 'Identity verification')}</h2>
            <p className="mt-1 text-sm leading-6 text-[var(--ab-text-secondary)]">{stepTitle}</p>
          </div>
          <button
            aria-label={t('kyc_form.close', 'Close verification')}
            className="flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-full border border-[var(--ab-border)] bg-[var(--ab-bg-subtle)] disabled:cursor-not-allowed disabled:opacity-50"
            disabled={submitting}
            onClick={requestClose}
            type="button"
          >
            <X aria-hidden className="h-5 w-5" />
          </button>
        </header>

        <ol aria-label={t('kyc_form.steps_label', 'Verification progress')} className="grid grid-cols-3 gap-2">
          {STEPS.map((candidate, index) => {
            const isCurrent = candidate === step
            const isComplete = index < currentStepIndex
            return (
              <li className="min-w-0" key={candidate}>
                <div className={`h-1.5 rounded-full ${isCurrent || isComplete ? 'bg-ab-btn' : 'bg-ab-separator'}`} />
                <span className={`mt-2 block truncate text-xs ${isCurrent ? 'font-semibold text-ab-text' : 'text-[var(--ab-text-secondary)]'}`}>
                  {candidate === 'about'
                    ? t('kyc_form.step_about_short', 'About')
                    : candidate === 'contact'
                      ? t('kyc_form.step_contact_short', 'Contact')
                      : t('kyc_form.step_document_short', 'Document')}
                </span>
              </li>
            )
          })}
        </ol>

        {step === 'about' && (
          <>
            <section aria-labelledby="kyc-why-title" className="rounded-2xl border border-[var(--ab-border)] bg-[var(--ab-bg-subtle)] p-4">
              <div className="flex items-start gap-3">
                <ShieldCheck aria-hidden className="mt-0.5 h-5 w-5 shrink-0" />
                <div>
                  <h3 className="font-semibold" id="kyc-why-title">{t('kyc_form.why_title', 'Why this is needed')}</h3>
                  <p className="mt-1 text-sm leading-6 text-[var(--ab-text-secondary)]">
                    {t('kyc_form.why_body', 'We need to verify your identity before this payment can continue. No payment has been created or charged yet.')}
                  </p>
                  <p className="mt-2 text-sm leading-6 text-[var(--ab-text-secondary)]">
                    {canResumePayment
                      ? t('kyc_form.draft_ready', 'Your payment details remain in this tab. After approval, we will continue once if the quote is still valid.')
                      : t('kyc_form.draft_reentry', 'Sensitive recipient details are not stored. After verification, you will return to payment details to enter them again.')}
                  </p>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-sm font-semibold">
                <a className="underline underline-offset-4" href={ABROAD_PRIVACY_URL} rel="noreferrer" target="_blank">
                  {t('kyc_form.privacy', 'How we use and protect your data')}
                </a>
                <a className="inline-flex items-center gap-1 underline underline-offset-4" href={ABROAD_SUPPORT_URL} rel="noreferrer" target="_blank">
                  <HelpCircle aria-hidden className="h-4 w-4" />
                  {t('kyc_form.get_help', 'Get help')}
                </a>
              </div>
              <p className="mt-3 text-xs leading-5 text-[var(--ab-text-secondary)]">
                {t('kyc_form.privacy_summary', 'Abroad receives this information for identity verification. It is sent only when you submit and is not saved in this browser. See the Privacy Policy for processors, retention, and safeguards.')}
              </p>
            </section>

            <label className="flex flex-col gap-1.5" htmlFor="kyc-fullName">
              <span className="text-sm font-medium">{fieldLabel('fullName')}</span>
              <input
                aria-describedby={describedBy('fullName')}
                aria-invalid={Boolean(errors.fullName)}
                aria-label={fieldLabel('fullName')}
                autoComplete="name"
                className={fieldClass('fullName')}
                id="kyc-fullName"
                onBlur={() => validateTextField('fullName')}
                onChange={event => setField('fullName', event.target.value)}
                placeholder={t('kyc_form.full_name_placeholder', 'As shown on your document')}
                ref={fullNameRef}
                required
                type="text"
                value={values.fullName}
              />
              {errors.fullName && <p className="text-sm text-red-600" id="kyc-fullName-error">{errorMessage(errors.fullName)}</p>}
            </label>

            <label className="flex flex-col gap-1.5" htmlFor="kyc-dateOfBirth">
              <span className="text-sm font-medium">{fieldLabel('dateOfBirth')}</span>
              <input
                aria-describedby={describedBy('dateOfBirth')}
                aria-invalid={Boolean(errors.dateOfBirth)}
                aria-label={fieldLabel('dateOfBirth')}
                autoComplete="bday"
                className={fieldClass('dateOfBirth')}
                id="kyc-dateOfBirth"
                max={todayIso}
                onBlur={() => validateTextField('dateOfBirth')}
                onChange={event => setField('dateOfBirth', event.target.value)}
                ref={dateOfBirthRef}
                required
                type="date"
                value={values.dateOfBirth}
              />
              {errors.dateOfBirth && <p className="text-sm text-red-600" id="kyc-dateOfBirth-error">{errorMessage(errors.dateOfBirth)}</p>}
            </label>

            <label className="flex flex-col gap-1.5" htmlFor="kyc-nationality">
              <span className="text-sm font-medium">{fieldLabel('nationality')}</span>
              <input
                aria-describedby={describedBy('nationality')}
                aria-invalid={Boolean(errors.nationality)}
                aria-label={fieldLabel('nationality')}
                autoComplete="country-name"
                className={fieldClass('nationality')}
                id="kyc-nationality"
                onBlur={() => validateTextField('nationality')}
                onChange={event => setField('nationality', event.target.value)}
                placeholder={t('kyc_form.nationality_placeholder', 'Country of nationality')}
                ref={nationalityRef}
                required
                type="text"
                value={values.nationality}
              />
              {errors.nationality && <p className="text-sm text-red-600" id="kyc-nationality-error">{errorMessage(errors.nationality)}</p>}
            </label>
          </>
        )}

        {step === 'contact' && (
          <>
            <p className="text-sm leading-6 text-[var(--ab-text-secondary)]">
              {t('kyc_form.contact_help', 'Use contact and address details that match your current records. Include the country code in your phone number.')}
            </p>
            <label className="flex flex-col gap-1.5" htmlFor="kyc-email">
              <span className="text-sm font-medium">{fieldLabel('email')}</span>
              <input
                aria-describedby={describedBy('email')}
                aria-invalid={Boolean(errors.email)}
                aria-label={fieldLabel('email')}
                autoComplete="email"
                className={fieldClass('email')}
                id="kyc-email"
                onBlur={() => validateTextField('email')}
                onChange={event => setField('email', event.target.value)}
                placeholder={t('kyc_form.email_placeholder', 'you@example.com')}
                ref={emailRef}
                required
                type="email"
                value={values.email}
              />
              {errors.email && <p className="text-sm text-red-600" id="kyc-email-error">{errorMessage(errors.email)}</p>}
            </label>

            <label className="flex flex-col gap-1.5" htmlFor="kyc-phone">
              <span className="text-sm font-medium">{fieldLabel('phone')}</span>
              <input
                aria-describedby={describedBy('phone')}
                aria-invalid={Boolean(errors.phone)}
                aria-label={fieldLabel('phone')}
                autoComplete="tel"
                className={fieldClass('phone')}
                id="kyc-phone"
                inputMode="tel"
                onBlur={() => validateTextField('phone')}
                onChange={event => setField('phone', event.target.value)}
                placeholder={t('kyc_form.phone_placeholder', '+55 21 98765 4321')}
                ref={phoneRef}
                required
                type="tel"
                value={values.phone}
              />
              {errors.phone && <p className="text-sm text-red-600" id="kyc-phone-error">{errorMessage(errors.phone)}</p>}
            </label>

            <label className="flex flex-col gap-1.5" htmlFor="kyc-city">
              <span className="text-sm font-medium">{fieldLabel('city')}</span>
              <input
                aria-describedby={describedBy('city')}
                aria-invalid={Boolean(errors.city)}
                aria-label={fieldLabel('city')}
                autoComplete="address-level2"
                className={fieldClass('city')}
                id="kyc-city"
                onBlur={() => validateTextField('city')}
                onChange={event => setField('city', event.target.value)}
                placeholder={t('kyc_form.city_placeholder', 'City of residence')}
                ref={cityRef}
                required
                type="text"
                value={values.city}
              />
              {errors.city && <p className="text-sm text-red-600" id="kyc-city-error">{errorMessage(errors.city)}</p>}
            </label>

            <label className="flex flex-col gap-1.5" htmlFor="kyc-address">
              <span className="text-sm font-medium">{fieldLabel('address')}</span>
              <input
                aria-describedby={describedBy('address')}
                aria-invalid={Boolean(errors.address)}
                aria-label={fieldLabel('address')}
                autoComplete="street-address"
                className={fieldClass('address')}
                id="kyc-address"
                onBlur={() => validateTextField('address')}
                onChange={event => setField('address', event.target.value)}
                placeholder={t('kyc_form.address_placeholder', 'Home address')}
                ref={addressRef}
                required
                type="text"
                value={values.address}
              />
              {errors.address && <p className="text-sm text-red-600" id="kyc-address-error">{errorMessage(errors.address)}</p>}
            </label>
          </>
        )}

        {step === 'document' && (
          <>
            <p className="text-sm leading-6 text-[var(--ab-text-secondary)]">
              {t('kyc_form.document_help', 'Choose a clear, uncropped image or PDF. All text and the document edges must be readable. Your file is uploaded only when you submit.')}
            </p>
            <label className="flex flex-col gap-1.5" htmlFor="kyc-documentType">
              <span className="text-sm font-medium">{fieldLabel('documentType')}</span>
              <select
                aria-describedby={describedBy('documentType')}
                aria-invalid={Boolean(errors.documentType)}
                aria-label={fieldLabel('documentType')}
                className={fieldClass('documentType')}
                id="kyc-documentType"
                onBlur={() => validateTextField('documentType')}
                onChange={event => setField('documentType', event.target.value)}
                ref={documentTypeRef}
                required
                value={values.documentType}
              >
                <option value="">{t('kyc_form.document_type_placeholder', 'Select a document type')}</option>
                {KYC_DOCUMENT_TYPES.map(type => (
                  <option key={type} value={type}>{t(documentTypeTranslationKeys[type], documentTypeFallbacks[type])}</option>
                ))}
              </select>
              {errors.documentType && <p className="text-sm text-red-600" id="kyc-documentType-error">{errorMessage(errors.documentType)}</p>}
            </label>

            <label className="flex flex-col gap-1.5" htmlFor="kyc-documentNumber">
              <span className="text-sm font-medium">{fieldLabel('documentNumber')}</span>
              <input
                aria-describedby={describedBy('documentNumber')}
                aria-invalid={Boolean(errors.documentNumber)}
                aria-label={fieldLabel('documentNumber')}
                autoComplete="off"
                className={fieldClass('documentNumber')}
                id="kyc-documentNumber"
                onBlur={() => validateTextField('documentNumber')}
                onChange={event => setField('documentNumber', event.target.value)}
                placeholder={t('kyc_form.document_number_placeholder', 'Document number')}
                ref={documentNumberRef}
                required
                type="text"
                value={values.documentNumber}
              />
              {errors.documentNumber && <p className="text-sm text-red-600" id="kyc-documentNumber-error">{errorMessage(errors.documentNumber)}</p>}
            </label>

            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-medium" id="kyc-document-label">{fieldLabel('document')}</span>
              <input
                accept={KYC_ACCEPTED_MIME_TYPES.join(',')}
                className="sr-only"
                id="kyc-document"
                onChange={event => void handleFileChange(event)}
                ref={fileInputRef}
                type="file"
              />
              <button
                aria-describedby={describedBy('document')}
                aria-invalid={Boolean(errors.document)}
                aria-labelledby="kyc-document-label kyc-document-action"
                className={`flex min-h-20 w-full items-center gap-3 rounded-xl border border-dashed bg-[var(--ab-bg-subtle)] p-4 text-left focus:outline-none focus:ring-2 ${errors.document ? 'border-red-500 focus:ring-red-200' : 'border-[var(--ab-border)] focus:ring-[var(--ab-border-strong)]'}`}
                disabled={documentChecking || submitting}
                id="kyc-document-action"
                onClick={() => fileInputRef.current?.click()}
                ref={documentUploadRef}
                type="button"
              >
                {document ? <FileText aria-hidden className="h-6 w-6 shrink-0" /> : <Upload aria-hidden className="h-6 w-6 shrink-0" />}
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">
                    {documentChecking
                      ? t('kyc_form.document_checking', 'Checking image quality…')
                      : document
                        ? t('kyc_form.document_selected', 'Document selected')
                        : t('kyc_form.document_image_cta', 'Choose a document file')}
                  </span>
                  <span className="mt-1 block text-xs leading-5 text-[var(--ab-text-secondary)]">
                    {document
                      ? t('kyc_form.document_ready', 'Ready to upload when you submit. Replace or remove it before submission.')
                      : t('kyc_form.document_rules', 'JPG, PNG, WEBP, HEIC, or PDF · maximum 8 MB')}
                  </span>
                </span>
                {document && <Check aria-hidden className="h-5 w-5 shrink-0 text-emerald-600" />}
              </button>
              {errors.document && <p className="text-sm text-red-600" id="kyc-document-error">{errorMessage(errors.document)}</p>}
              {document && (
                <div className="flex flex-wrap gap-2">
                  <button className="min-h-11 rounded-xl border border-[var(--ab-border)] px-4 text-sm font-semibold" onClick={() => fileInputRef.current?.click()} type="button">
                    {t('kyc_form.document_replace', 'Replace file')}
                  </button>
                  <button className="min-h-11 rounded-xl px-4 text-sm font-semibold text-red-600" onClick={removeDocument} type="button">
                    {t('kyc_form.document_remove', 'Remove file')}
                  </button>
                </div>
              )}
            </div>

            <section aria-labelledby="kyc-review-title" className="rounded-2xl border border-[var(--ab-border)] p-4">
              <h3 className="font-semibold" id="kyc-review-title">{t('kyc_form.review_title', 'Before you submit')}</h3>
              <ul className="mt-2 space-y-2 text-sm leading-6 text-[var(--ab-text-secondary)]">
                <li>{t('kyc_form.review_accuracy', 'Confirm the details match your document.')}</li>
                <li>{t('kyc_form.review_browser', 'Your form and document are not saved in this browser after you leave.')}</li>
                <li>{t('kyc_form.review_payment', 'Submitting verification does not create or charge a payment.')}</li>
              </ul>
            </section>
          </>
        )}

        {currentErrors.length > 0 && (
          <section aria-labelledby="kyc-error-summary-title" className="rounded-2xl border border-red-300 bg-red-50 p-4 text-red-900" role="alert">
            <h3 className="font-semibold" id="kyc-error-summary-title">{t('kyc_form.error_summary', 'Check the highlighted fields')}</h3>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
              {currentErrors.map(field => (
                <li key={field}>
                  <button className="min-h-11 text-left font-semibold underline underline-offset-4" onClick={() => focusField(field)} type="button">
                    {fieldLabel(field)}
                    {': '}
                    {errorMessage(errors[field] ?? 'required')}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {submitError && (
          <div className="rounded-2xl border border-red-300 bg-red-50 p-4 text-sm text-red-900" role="alert">
            <h3 className="font-semibold">{t('kyc_form.submit_error_title', 'Verification was not submitted')}</h3>
            <p className="mt-1 leading-6">{submitError}</p>
          </div>
        )}

        {submitting && (
          <p aria-live="polite" className="text-sm leading-6 text-[var(--ab-text-secondary)]">
            {t('kyc_form.uploading', 'Uploading your document and checking your details. Keep this page open.')}
          </p>
        )}

        <footer className="flex flex-col-reverse gap-3 border-t border-[var(--ab-border)] pt-4 sm:flex-row sm:items-center sm:justify-between">
          <button
            className="min-h-11 rounded-xl px-4 text-sm font-semibold text-[var(--ab-text-secondary)] disabled:opacity-50"
            disabled={submitting}
            onClick={currentStepIndex === 0 ? requestClose : handleBack}
            type="button"
          >
            {currentStepIndex === 0
              ? t('kyc_form.cancel_safely', 'Cancel safely')
              : t('common.back', 'Back')}
          </button>
          {step === 'document'
            ? (
                <Button className="min-h-12 sm:min-w-52" loading={submitting} type="submit">
                  {submitError
                    ? t('kyc_form.retry_submit', 'Try submission again')
                    : t('kyc_form.submit', 'Submit verification')}
                </Button>
              )
            : (
                <Button className="min-h-12 sm:min-w-40" onClick={handleContinue} type="button">
                  {t('common.continue', 'Continue')}
                </Button>
              )}
        </footer>
      </form>

      <ModalSurface
        descriptionId="kyc-cancel-description"
        onClose={() => setShowCancelConfirmation(false)}
        open={showCancelConfirmation}
        titleId="kyc-cancel-title"
      >
        <section className="w-full max-w-md rounded-3xl border border-[var(--ab-border)] bg-[var(--ab-card)] p-5 shadow-2xl md:p-6">
          <h2 className="text-xl font-semibold" id="kyc-cancel-title">{t('kyc_form.cancel_title', 'Leave identity verification?')}</h2>
          <p className="mt-2 text-sm leading-6 text-[var(--ab-text-secondary)]" id="kyc-cancel-description">
            {t('kyc_form.cancel_body', 'For your privacy, the details and document on this form are not saved. Your payment has not been created or charged.')}
          </p>
          <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row">
            <button className="min-h-11 flex-1 rounded-xl border border-[var(--ab-border)] px-4 font-semibold" data-modal-initial-focus onClick={() => setShowCancelConfirmation(false)} type="button">
              {t('kyc_form.keep_editing', 'Keep editing')}
            </button>
            <Button
              className="min-h-11 flex-1"
              onClick={() => {
                recordVerificationEvent('verification_cancelled', { outcome: 'cancelled' })
                onClose()
              }}
              type="button"
            >
              {t('kyc_form.discard', 'Discard and return')}
            </Button>
          </div>
        </section>
      </ModalSurface>
    </div>
  )
}

export default KycForm

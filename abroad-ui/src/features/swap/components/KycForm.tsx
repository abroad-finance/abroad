import { useTranslate } from '@tolgee/react'
import { FileText, Upload, X } from 'lucide-react'
import React, { useCallback, useMemo, useState } from 'react'

import type { KycFormValues, KycSubmitOutcome } from '../types'

import { Button } from '../../../shared/components/Button'

interface KycFormProps {
  isDark?: boolean
  onClose: () => void
  onSubmit: (values: KycFormValues) => Promise<KycSubmitOutcome>
}

const DOCUMENT_TYPES = [
  'NATIONAL_ID',
  'PASSPORT',
  'DRIVERS_LICENSE',
  'FOREIGN_ID',
  'OTHER',
] as const

const ACCEPTED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'application/pdf',
]
const MAX_DOCUMENT_BYTES = 8 * 1024 * 1024

const inputClass
  = 'w-full bg-[var(--ab-bg-subtle)] border border-[var(--ab-border)] rounded-xl px-4 py-3 text-base text-ab-text placeholder:text-[var(--ab-text-secondary)] focus:outline-none focus:border-[var(--ab-text)] transition-colors'

const KycForm = ({ onClose, onSubmit }: KycFormProps): React.JSX.Element => {
  const { t } = useTranslate()

  const [fullName, setFullName] = useState('')
  const [documentType, setDocumentType] = useState<string>('')
  const [documentNumber, setDocumentNumber] = useState('')
  const [dateOfBirth, setDateOfBirth] = useState('')
  const [nationality, setNationality] = useState('')
  const [city, setCity] = useState('')
  const [address, setAddress] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [document, setDocument] = useState<File | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<null | string>(null)

  const documentPreviewUrl = useMemo(() => {
    if (document && document.type.startsWith('image/')) {
      return URL.createObjectURL(document)
    }
    return null
  }, [document])

  const documentTypeLabels: Record<string, string> = {
    DRIVERS_LICENSE: t('kyc_form.doc_type.drivers_license', 'Driver\'s license'),
    FOREIGN_ID: t('kyc_form.doc_type.foreign_id', 'Foreign ID'),
    NATIONAL_ID: t('kyc_form.doc_type.national_id', 'National ID'),
    OTHER: t('kyc_form.doc_type.other', 'Other'),
    PASSPORT: t('kyc_form.doc_type.passport', 'Passport'),
  }

  const handleFileChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    setError(null)
    const file = event.target.files?.[0]
    if (!file) return
    if (!ACCEPTED_MIME_TYPES.includes(file.type)) {
      setError(t('kyc_form.error_document_type', 'Please upload a JPG, PNG, WEBP, or PDF file.'))
      return
    }
    if (file.size > MAX_DOCUMENT_BYTES) {
      setError(t('kyc_form.error_document_size', 'The document must be smaller than 8 MB.'))
      return
    }
    setDocument(file)
  }, [t])

  const handleSubmit = useCallback(async (event: React.FormEvent) => {
    event.preventDefault()
    setError(null)

    const trimmed = {
      address: address.trim(),
      city: city.trim(),
      documentNumber: documentNumber.trim(),
      email: email.trim(),
      fullName: fullName.trim(),
      nationality: nationality.trim(),
      phone: phone.trim(),
    }
    if (
      !trimmed.fullName || !documentType || !trimmed.documentNumber || !dateOfBirth
      || !trimmed.nationality || !trimmed.city || !trimmed.address || !trimmed.email || !trimmed.phone
    ) {
      setError(t('kyc_form.error_required', 'Please complete every field.'))
      return
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed.email)) {
      setError(t('kyc_form.error_email', 'Please enter a valid email address.'))
      return
    }
    if (!document) {
      setError(t('kyc_form.error_document', 'Please upload an image of your document.'))
      return
    }

    setSubmitting(true)
    try {
      const outcome = await onSubmit({
        address: trimmed.address,
        city: trimmed.city,
        dateOfBirth,
        document,
        documentNumber: trimmed.documentNumber,
        documentType,
        email: trimmed.email,
        fullName: trimmed.fullName,
        nationality: trimmed.nationality,
        phone: trimmed.phone,
      })

      // The controller resumes the flow on success; only surface failures here.
      if (!outcome.ok) {
        setError(outcome.error ?? t('kyc_form.submit_error', 'We could not submit your verification. Please try again.'))
      }
    }
    catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : t('kyc_form.submit_error', 'We could not submit your verification. Please try again.'))
    }
    finally {
      setSubmitting(false)
    }
  }, [
    address,
    city,
    dateOfBirth,
    document,
    documentNumber,
    documentType,
    email,
    fullName,
    nationality,
    onSubmit,
    phone,
    t,
  ])

  return (
    <div className="flex-1 flex items-start justify-center w-full">
      <form
        className="w-full max-w-md bg-[var(--ab-card)] border border-[var(--ab-border)] backdrop-blur-xl rounded-2xl p-4 md:p-6 flex flex-col gap-4 text-[var(--ab-text)] my-4"
        onSubmit={handleSubmit}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold">{t('kyc_form.title', 'Identity verification')}</h2>
            <p className="text-sm text-[var(--ab-text-secondary)] mt-1">
              {t('kyc_form.subtitle', 'Complete your details to verify your account.')}
            </p>
          </div>
          <button
            aria-label={t('kyc_form.close', 'Close')}
            className="shrink-0 rounded-full bg-[var(--ab-bg-card)] border border-[var(--ab-border)] p-2"
            onClick={onClose}
            type="button"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-[var(--ab-text-secondary)]">{t('kyc_form.full_name', 'Full name')}</span>
          <input
            autoComplete="name"
            className={inputClass}
            onChange={e => setFullName(e.target.value)}
            placeholder={t('kyc_form.full_name_placeholder', 'As shown on your document')}
            type="text"
            value={fullName}
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-[var(--ab-text-secondary)]">{t('kyc_form.document_type', 'Document type')}</span>
          <select
            className={inputClass}
            onChange={e => setDocumentType(e.target.value)}
            value={documentType}
          >
            <option value="">{t('kyc_form.document_type_placeholder', 'Select a document type')}</option>
            {DOCUMENT_TYPES.map(type => (
              <option key={type} value={type}>{documentTypeLabels[type]}</option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-[var(--ab-text-secondary)]">{t('kyc_form.document_number', 'Document number')}</span>
          <input
            className={inputClass}
            onChange={e => setDocumentNumber(e.target.value)}
            placeholder={t('kyc_form.document_number_placeholder', 'Document number')}
            type="text"
            value={documentNumber}
          />
        </label>

        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-[var(--ab-text-secondary)]">{t('kyc_form.document_image', 'Document image')}</span>
          <label className="w-full cursor-pointer bg-[var(--ab-bg-subtle)] border border-dashed border-[var(--ab-border)] rounded-xl p-4 flex items-center gap-3 hover:border-[var(--ab-text)] transition-colors">
            {documentPreviewUrl
              ? <img alt="" className="w-12 h-12 rounded-lg object-cover" src={documentPreviewUrl} />
              : document
                ? <FileText className="w-6 h-6 text-ab-text shrink-0" />
                : <Upload className="w-6 h-6 text-[var(--ab-text-secondary)] shrink-0" />}
            <span className="text-sm text-[var(--ab-text-secondary)] truncate">
              {document ? document.name : t('kyc_form.document_image_cta', 'Tap to upload a photo of your document')}
            </span>
            <input
              accept={ACCEPTED_MIME_TYPES.join(',')}
              className="hidden"
              onChange={handleFileChange}
              type="file"
            />
          </label>
        </div>

        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-[var(--ab-text-secondary)]">{t('kyc_form.date_of_birth', 'Date of birth')}</span>
          <input
            className={inputClass}
            max={new Date().toISOString().slice(0, 10)}
            onChange={e => setDateOfBirth(e.target.value)}
            type="date"
            value={dateOfBirth}
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-[var(--ab-text-secondary)]">{t('kyc_form.nationality', 'Nationality')}</span>
          <input
            className={inputClass}
            onChange={e => setNationality(e.target.value)}
            placeholder={t('kyc_form.nationality_placeholder', 'Country of nationality')}
            type="text"
            value={nationality}
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-[var(--ab-text-secondary)]">{t('kyc_form.city', 'City of residence')}</span>
          <input
            autoComplete="address-level2"
            className={inputClass}
            onChange={e => setCity(e.target.value)}
            placeholder={t('kyc_form.city_placeholder', 'City of residence')}
            type="text"
            value={city}
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-[var(--ab-text-secondary)]">{t('kyc_form.address', 'Address')}</span>
          <input
            autoComplete="street-address"
            className={inputClass}
            onChange={e => setAddress(e.target.value)}
            placeholder={t('kyc_form.address_placeholder', 'Home address')}
            type="text"
            value={address}
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-[var(--ab-text-secondary)]">{t('kyc_form.email', 'Email')}</span>
          <input
            autoComplete="email"
            className={inputClass}
            onChange={e => setEmail(e.target.value)}
            placeholder={t('kyc_form.email_placeholder', 'you@example.com')}
            type="email"
            value={email}
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-[var(--ab-text-secondary)]">{t('kyc_form.phone', 'Phone')}</span>
          <input
            autoComplete="tel"
            className={inputClass}
            onChange={e => setPhone(e.target.value)}
            placeholder={t('kyc_form.phone_placeholder', 'Phone number')}
            type="tel"
            value={phone}
          />
        </label>

        {error && (
          <p className="text-sm text-red-500" role="alert">{error}</p>
        )}

        <Button
          className="w-full py-4 cursor-pointer"
          loading={submitting}
          type="submit"
        >
          {t('kyc_form.submit', 'Submit verification')}
        </Button>
      </form>
    </div>
  )
}

export default KycForm

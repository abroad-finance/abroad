import type { KycDocumentType, KycFormValues } from '../types'

export const KYC_DOCUMENT_TYPES = [
  'NATIONAL_ID',
  'PASSPORT',
  'DRIVERS_LICENSE',
  'FOREIGN_ID',
  'OTHER',
] as const satisfies readonly KycDocumentType[]

export const KYC_ACCEPTED_MIME_TYPES = [
  'application/pdf',
  'image/heic',
  'image/jpeg',
  'image/png',
  'image/webp',
] as const

export const KYC_MAX_DOCUMENT_BYTES = 8 * 1024 * 1024

export type KycField
  = | 'address'
    | 'city'
    | 'dateOfBirth'
    | 'document'
    | 'documentNumber'
    | 'documentType'
    | 'email'
    | 'fullName'
    | 'nationality'
    | 'phone'

export type KycFieldErrorCode
  = | 'document-empty'
    | 'document-quality'
    | 'document-required'
    | 'document-size'
    | 'document-type'
    | 'document-unreadable'
    | 'future-date'
    | 'invalid-date'
    | 'invalid-email'
    | 'invalid-phone'
    | 'required'

export type KycFieldErrors = Partial<Record<KycField, KycFieldErrorCode>>

export type KycStep = 'about' | 'contact' | 'document'

export type KycTextValues = Omit<KycFormValues, 'document' | 'documentType'> & {
  documentType: '' | KycDocumentType
}

export const EMPTY_KYC_TEXT_VALUES: KycTextValues = {
  address: '',
  city: '',
  dateOfBirth: '',
  documentNumber: '',
  documentType: '',
  email: '',
  fullName: '',
  nationality: '',
  phone: '',
}

const STEP_FIELDS: Record<KycStep, readonly KycField[]> = {
  about: [
    'fullName',
    'dateOfBirth',
    'nationality',
  ],
  contact: [
    'email',
    'phone',
    'city',
    'address',
  ],
  document: [
    'documentType',
    'documentNumber',
    'document',
  ],
}

const REQUIRED_TEXT_FIELDS = new Set<KycField>([
  'address',
  'city',
  'documentNumber',
  'documentType',
  'fullName',
  'nationality',
])

const isValidDateString = (value: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

export const getKycStepFields = (step: KycStep): readonly KycField[] => STEP_FIELDS[step]

export const isKycDraftDirty = (
  values: KycTextValues,
  document: File | null,
): boolean => document !== null || Object.values(values).some(value => value.trim().length > 0)

export const validateKycDocument = (document: File | null): KycFieldErrorCode | null => {
  if (!document) return 'document-required'
  if (document.size === 0) return 'document-empty'
  if (!KYC_ACCEPTED_MIME_TYPES.includes(document.type as typeof KYC_ACCEPTED_MIME_TYPES[number])) {
    return 'document-type'
  }
  if (document.size > KYC_MAX_DOCUMENT_BYTES) return 'document-size'
  return null
}

export const validateKycField = (
  field: Exclude<KycField, 'document'>,
  value: string,
  todayIso: string,
): KycFieldErrorCode | null => {
  const trimmed = value.trim()
  if (REQUIRED_TEXT_FIELDS.has(field) && trimmed.length === 0) return 'required'

  if (field === 'email') {
    if (trimmed.length === 0) return 'required'
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed) ? null : 'invalid-email'
  }

  if (field === 'phone') {
    if (trimmed.length === 0) return 'required'
    const digitCount = trimmed.replace(/\D/g, '').length
    return digitCount >= 7 && digitCount <= 15 ? null : 'invalid-phone'
  }

  if (field === 'dateOfBirth') {
    if (trimmed.length === 0) return 'required'
    if (!isValidDateString(trimmed)) return 'invalid-date'
    return trimmed < todayIso ? null : 'future-date'
  }

  return null
}

export const validateKycStep = (
  step: KycStep,
  values: KycTextValues,
  document: File | null,
  todayIso: string,
): KycFieldErrors => {
  const errors: KycFieldErrors = {}
  for (const field of STEP_FIELDS[step]) {
    const error = field === 'document'
      ? validateKycDocument(document)
      : validateKycField(field, values[field], todayIso)
    if (error) errors[field] = error
  }
  return errors
}

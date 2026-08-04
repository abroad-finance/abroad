import {
  EMPTY_KYC_TEXT_VALUES,
  isKycDraftDirty,
  KYC_MAX_DOCUMENT_BYTES,
  validateKycDocument,
  validateKycField,
  validateKycStep,
} from '../features/swap/shared/kycFormModel'

const today = '2026-08-03'

describe('KYC form model', () => {
  it('validates each progressive step instead of collapsing errors into one message', () => {
    expect(validateKycStep('about', EMPTY_KYC_TEXT_VALUES, null, today)).toEqual({
      dateOfBirth: 'required',
      fullName: 'required',
      nationality: 'required',
    })
    expect(validateKycStep('contact', EMPTY_KYC_TEXT_VALUES, null, today)).toEqual({
      address: 'required',
      city: 'required',
      email: 'required',
      phone: 'required',
    })
    expect(validateKycStep('document', EMPTY_KYC_TEXT_VALUES, null, today)).toEqual({
      document: 'document-required',
      documentNumber: 'required',
      documentType: 'required',
    })
  })

  it('rejects malformed or non-past birth dates', () => {
    expect(validateKycField('dateOfBirth', '2026-02-31', today)).toBe('invalid-date')
    expect(validateKycField('dateOfBirth', today, today)).toBe('future-date')
    expect(validateKycField('dateOfBirth', '1990-01-02', today)).toBeNull()
  })

  it('uses permissive locale-aware contact validation without accepting unusable values', () => {
    expect(validateKycField('email', 'not-an-email', today)).toBe('invalid-email')
    expect(validateKycField('email', 'ada@example.com', today)).toBeNull()
    expect(validateKycField('phone', '+55 (21) 99876-5432', today)).toBeNull()
    expect(validateKycField('phone', '123', today)).toBe('invalid-phone')
  })

  it('bounds document type and size and rejects empty files', () => {
    const empty = new File([], 'document.pdf', { type: 'application/pdf' })
    const unsupported = new File(['text'], 'document.txt', { type: 'text/plain' })
    const oversized = new File(
      [new Uint8Array(KYC_MAX_DOCUMENT_BYTES + 1)],
      'document.pdf',
      { type: 'application/pdf' },
    )
    const accepted = new File(['pdf'], 'document.pdf', { type: 'application/pdf' })

    expect(validateKycDocument(null)).toBe('document-required')
    expect(validateKycDocument(empty)).toBe('document-empty')
    expect(validateKycDocument(unsupported)).toBe('document-type')
    expect(validateKycDocument(oversized)).toBe('document-size')
    expect(validateKycDocument(accepted)).toBeNull()
  })

  it('does not classify an untouched form as a resumable sensitive draft', () => {
    expect(isKycDraftDirty(EMPTY_KYC_TEXT_VALUES, null)).toBe(false)
    expect(isKycDraftDirty({ ...EMPTY_KYC_TEXT_VALUES, fullName: 'Ada' }, null)).toBe(true)
  })
})

import { buildService, type HelperMethods, resetAxiosMocks } from './personaInquiryTestUtils'

describe('PersonaInquiryDetailsService helpers (payload parsing)', () => {
  beforeEach(() => {
    resetAxiosMocks()
    jest.clearAllMocks()
  })

  it('normalizes document labels and parses inquiry payloads', () => {
    const { service } = buildService({ debug: true })
    const helpers = service as unknown as HelperMethods

    expect(helpers.buildFullNameFromAttributes({})).toBeUndefined()
    expect(helpers.mapDocumentClassToLabel('driver_license', 'AR')).toBe('Licencia de conducción')

    const parsed = helpers.parseInquiryPayload({
      data: {
        data: {
          attributes: {
            'address-city': 'Bogota',
            'address-country-code': 'CO',
            'address-street-1': 'Line 1',
            'address-street-2': 'Line 2',
            'fields': {
              'email-address': { value: 'fields@example.com' },
              'identification-class': { value: 'id_card' },
              'identification-number': { value: 'FIELD-ID' },
              'phone-number': { value: '999' },
              'selected-country-code': { value: 'CO' },
            },
          },
          type: 'inquiry',
        },
        included: [
          { attributes: { 'document-number': 'DOC-FIELD' }, type: 'document/government-id' },
          'skip-me',
        ],
      },
    })

    expect(parsed).toEqual(expect.objectContaining({
      address: 'Line 1, Line 2',
      city: 'Bogota',
      country: 'CO',
      documentType: 'Cédula de ciudadanía',
      email: 'fields@example.com',
      fullName: undefined,
      idNumber: 'FIELD-ID',
      phone: '999',
    }))
  })
})

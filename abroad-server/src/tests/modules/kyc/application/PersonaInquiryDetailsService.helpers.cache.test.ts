import { buildPayload, buildService, type HelperMethods, resetAxiosMocks } from './personaInquiryTestUtils'

describe('PersonaInquiryDetailsService helpers (cache and parsing)', () => {
  beforeEach(() => {
    resetAxiosMocks()
    jest.clearAllMocks()
  })

  it('manages cache state and parses payload values', () => {
    const { service } = buildService()
    const helpers = service as unknown as HelperMethods
    const cacheRef = service as unknown as {
      cache: Map<string, import('../../../../modules/kyc/application/PersonaInquiryDetailsService').PersonaInquiryDetails | null>
    }

    cacheRef.cache.set('inq-a', null)
    cacheRef.cache.set('inq-b', { fullName: 'Bob' })
    service.clearCache('inq-a')
    expect(cacheRef.cache.has('inq-a')).toBe(false)
    service.clearCache()
    expect(cacheRef.cache.size).toBe(0)

    expect(helpers.asRecord({ foo: 'bar' })).toEqual({ foo: 'bar' })
    expect(helpers.asRecord(['x'])).toBeUndefined()

    const stringCases: Array<{ expected: string | undefined, input: unknown }> = [
      { expected: 'Hi', input: '  Hi  ' },
      { expected: undefined, input: '   ' },
      { expected: undefined, input: 123 },
    ]
    stringCases.forEach(({ expected, input }) => expect(helpers.asString(input)).toBe(expected))

    const nameCases: Array<{ attrs?: Record<string, unknown>, expected?: string }> = [
      { attrs: undefined, expected: undefined },
      { attrs: { 'name-first': 'Ana', 'name-last': 'Lopez', 'name-middle': 'Maria' }, expected: 'Ana Maria Lopez' },
      { attrs: { 'name-first': 'Solo' }, expected: 'Solo' },
    ]
    nameCases.forEach(({ attrs, expected }) => expect(helpers.buildFullNameFromAttributes(attrs)).toBe(expected))

    const docs = helpers.collectDocumentAttributes([
      { attributes: { 'id-class': 'id' }, type: 'document/id' },
      { attributes: { 'id-class': 'ignored' }, type: 'profile' },
    ])
    expect(docs).toEqual([{ 'id-class': 'id' }])

    expect(helpers.mapDocumentClassToLabel('id', 'CO')).toBe('Cédula de ciudadanía')
    expect(helpers.mapDocumentClassToLabel('pp', 'US')).toBe('Pasaporte')
    expect(helpers.mapDocumentClassToLabel('unknown', undefined)).toBe('unknown')
    expect(helpers.mapDocumentClassToLabel(undefined, undefined)).toBeUndefined()

    expect(helpers.parseInquiryPayload(42)).toBeNull()
    const parsed = helpers.parseInquiryPayload(buildPayload())
    expect(parsed).toEqual(expect.objectContaining({
      city: 'Bogota',
      country: 'CO',
      fullName: 'Lisa Simpson',
    }))
  })
})

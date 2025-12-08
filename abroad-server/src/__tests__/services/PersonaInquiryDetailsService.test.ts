import type { ISecretManager } from '../../interfaces/ISecretManager'

import { PersonaInquiryDetailsService } from '../../services/PersonaInquiryDetailsService'

const axiosGetMock = jest.fn()

jest.mock('axios', () => {
  const create = jest.fn()
  return {
    __esModule: true,
    default: { create },
  }
})

const axiosCreateMock = (jest.requireMock('axios') as { default: { create: jest.Mock } }).default.create

describe('PersonaInquiryDetailsService', () => {
  let secretManager: ISecretManager

  beforeEach(() => {
    axiosGetMock.mockReset()
    axiosCreateMock.mockReset()
    axiosCreateMock.mockReturnValue({ get: axiosGetMock })
    jest.clearAllMocks()
    const getSecretsMock: jest.MockedFunction<ISecretManager['getSecrets']> = jest.fn(
      async (secretNames) => {
        const values: Record<string, string> = { PERSONA_API_KEY: 'persona-key' }
        const result: Record<(typeof secretNames)[number], string> = {} as Record<(typeof secretNames)[number], string>
        secretNames.forEach((name) => {
          result[name] = values[name] ?? ''
        })
        return result
      },
    )

    secretManager = {
      getSecret: jest.fn(),
      getSecrets: getSecretsMock,
    }
  })

  const buildService = (debug = false) => new PersonaInquiryDetailsService(secretManager, { debug })

  const buildPayload = (overrides?: Record<string, unknown>) => ({
    data: {
      attributes: {
        'address-city': 'Bogota',
        'address-country-code': 'CO',
        'address-street-1': 'Street 1',
        'address-subdivision': 'Cundinamarca',
        'email-address': 'lisa@example.com',
        'fields': {
          'identification-class': { value: 'pp' },
          'selected-country-code': { value: 'CO' },
        },
        'identification-number': '987654',
        'name-first': 'Lisa',
        'name-last': 'Simpson',
        'phone-number': '+57-123',
      },
      type: 'inquiry',
    },
    included: [
      {
        attributes: {
          'document-number': 'PASS-123',
          'identification-number': 'DOC-ALT',
          'name-first': 'Lisa',
          'name-last': 'Simpson',
        },
        type: 'document/government-id',
      },
    ],
    ...(overrides ?? {}),
  })

  it('normalizes Persona inquiries and caches results', async () => {
    const payload = buildPayload()
    axiosGetMock.mockResolvedValueOnce({ data: payload })
    const service = buildService()

    const details = await service.getDetails('inq-1')

    expect(details).toEqual({
      address: 'Street 1',
      city: 'Bogota',
      country: 'CO',
      department: 'Cundinamarca',
      documentType: 'Pasaporte',
      email: 'lisa@example.com',
      fullName: 'Lisa Simpson',
      idNumber: 'PASS-123',
      phone: '+57-123',
    })
    expect(secretManager.getSecrets).toHaveBeenCalledTimes(1)
    expect(axiosCreateMock).toHaveBeenCalledTimes(1)
    expect(axiosGetMock).toHaveBeenCalledTimes(1)

    // Cached path should avoid a second axios call.
    const cached = await service.getDetails('inq-1')
    expect(cached).toEqual(details)
    expect(axiosGetMock).toHaveBeenCalledTimes(1)
  })

  it('returns null for missing or blank inquiry ids', async () => {
    const service = buildService()

    expect(await service.getDetails('')).toBeNull()
    expect(await service.getDetails('   ')).toBeNull()
    expect(secretManager.getSecrets).not.toHaveBeenCalled()
    expect(axiosGetMock).not.toHaveBeenCalled()
  })

  it('maps non-passport documents and falls back to attribute id numbers', async () => {
    const payload = buildPayload({
      data: {
        attributes: {
          'address-city': 'Medellin',
          'address-country-code': 'CO',
          'address-street-1': 'Calle 10',
          'address-street-2': 'Apt 5',
          'address-subdivision': 'Antioquia',
          'email-address': 'homer@example.com',
          'fields': {
            'identification-class': { value: 'id' },
            'identification-number': { value: 'FIELD-999' },
          },
          'identification-number': undefined,
          'name-first': 'Homer',
          'name-last': 'Simpson',
          'phone-number': '+57-555',
        },
        type: 'inquiry',
      },
      included: [],
    })

    axiosGetMock.mockResolvedValueOnce({ data: payload })
    const service = buildService()

    const details = await service.getDetails('inq-2')

    expect(details).toEqual({
      address: 'Calle 10, Apt 5',
      city: 'Medellin',
      country: 'CO',
      department: 'Antioquia',
      documentType: 'Cédula de ciudadanía',
      email: 'homer@example.com',
      fullName: 'Homer Simpson',
      idNumber: 'FIELD-999',
      phone: '+57-555',
    })
  })

  it('caches failures and returns null when the client cannot be created or request fails', async () => {
    const failingSecrets: jest.MockedFunction<ISecretManager['getSecrets']> = jest.fn(
      async (secretNames) => {
        const result: Record<(typeof secretNames)[number], string> = {} as Record<(typeof secretNames)[number], string>
        secretNames.forEach((name) => {
          result[name] = ''
        })
        return result
      },
    )
    secretManager.getSecrets = failingSecrets
    axiosGetMock.mockRejectedValueOnce(new Error('network fail'))
    const service = buildService()
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})

    const first = await service.getDetails('inq-3')
    const second = await service.getDetails('inq-3')

    expect(first).toBeNull()
    expect(second).toBeNull()
    expect(secretManager.getSecrets).toHaveBeenCalledTimes(1)
    expect(axiosGetMock).not.toHaveBeenCalled()
    expect(consoleErrorSpy).toHaveBeenCalled()
    consoleErrorSpy.mockRestore()
  })

  it('exercises helper branches for cache management and value coercion', () => {
    const service = new PersonaInquiryDetailsService(secretManager)
    const helpers = service as unknown as {
      asRecord: (value: unknown) => Record<string, unknown> | undefined
      asString: (value: unknown) => string | undefined
      buildFullNameFromAttributes: (attrs?: Record<string, unknown>) => string | undefined
      collectDocumentAttributes: (input: Array<Record<string, unknown>>) => Array<Record<string, unknown>>
      mapDocumentClassToLabel: (code: string | undefined, country?: string) => string | undefined
      parseInquiryPayload: (payload: unknown) => import('../../services/PersonaInquiryDetailsService').PersonaInquiryDetails | null
    }
    const cacheRef = service as unknown as { cache: Map<string, import('../../services/PersonaInquiryDetailsService').PersonaInquiryDetails | null> }

    cacheRef.cache.set('inq-a', null)
    cacheRef.cache.set('inq-b', { fullName: 'Bob' })
    service.clearCache('inq-a')
    expect(cacheRef.cache.has('inq-a')).toBe(false)
    service.clearCache()
    expect(cacheRef.cache.size).toBe(0)

    expect(helpers.asRecord({ foo: 'bar' })).toEqual({ foo: 'bar' })
    expect(helpers.asRecord(['x'])).toBeUndefined()
    expect(helpers.asString('  Hi  ')).toBe('Hi')
    expect(helpers.asString('   ')).toBeUndefined()
    expect(helpers.asString(123)).toBeUndefined()

    expect(helpers.buildFullNameFromAttributes(undefined)).toBeUndefined()
    expect(helpers.buildFullNameFromAttributes({ 'name-first': 'Ana', 'name-last': 'Lopez', 'name-middle': 'Maria' }))
      .toBe('Ana Maria Lopez')
    expect(helpers.buildFullNameFromAttributes({ 'name-first': 'Solo' })).toBe('Solo')

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
    const parsed = helpers.parseInquiryPayload({
      data: {
        data: {
          attributes: {
            'address-city': 'Quito',
            'address-country-code': 'EC',
            'email-address': 'jim@example.com',
            'name-first': 'Jim',
            'name-last': 'Halpert',
          },
        },
        included: [
          {
            attributes: { 'document-number': 'DOC-77', 'name-first': 'Jim', 'name-last': 'Halpert' },
            type: 'document/government-id',
          },
        ],
      },
    })
    expect(parsed).toEqual(expect.objectContaining({
      city: 'Quito',
      country: 'EC',
      fullName: 'Jim Halpert',
    }))
  })

  it('covers debug, cached client, and fallback field/value parsing branches', async () => {
    const debugService = new PersonaInquiryDetailsService(secretManager, { debug: true })
    const helpers = debugService as unknown as {
      buildFullNameFromAttributes: (attrs?: Record<string, unknown>) => string | undefined
      collectDocumentAttributes: (input: Array<Record<string, unknown>>) => Array<Record<string, unknown>>
      debug: (...args: unknown[]) => void
      ensureClient: () => Promise<unknown>
      extractPrimaryResource: (payload: Record<string, unknown>) => unknown
      getFieldValue: <T>(fields: Record<string, unknown> | undefined, key: string) => T | undefined
      mapDocumentClassToLabel: (code: string | undefined, country?: string) => string | undefined
      parseInquiryPayload: (payload: unknown) => import('../../services/PersonaInquiryDetailsService').PersonaInquiryDetails | null
    }

    // buildFullNameFromAttributes: empty attrs path
    expect(helpers.buildFullNameFromAttributes({})).toBeUndefined()

    // collectDocumentAttributes: false branch (non-string type)
    const collected = helpers.collectDocumentAttributes([
      { attributes: { foo: 'bar' }, type: 123 as unknown as string },
    ])
    expect(collected).toEqual([])

    // debug flag branch
    const debugSpy = jest.spyOn(console, 'debug').mockImplementation(() => {})
    helpers.debug('message', 1)
    expect(debugSpy).toHaveBeenCalled()
    debugSpy.mockRestore()

    // ensureClient caches instances
    const client = await helpers.ensureClient()
    const cached = await helpers.ensureClient()
    expect(cached).toBe(client)
    expect(axiosCreateMock).toHaveBeenCalledTimes(1)

    // extractPrimaryResource guards non-record payloads
    expect(helpers.extractPrimaryResource({ data: 5 })).toEqual({
      included: [],
      resource: { data: 5 },
    })

    // getFieldValue handles null values
    expect(helpers.getFieldValue<{ value: null }>({ nullable: { value: null } }, 'nullable')).toBeUndefined()

    expect(helpers.mapDocumentClassToLabel('driver_license', 'AR')).toBe('Licencia de conducción')

    // parseInquiryPayload covering field fallbacks and nested includes
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

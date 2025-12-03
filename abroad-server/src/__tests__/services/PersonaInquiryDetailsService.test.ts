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
})

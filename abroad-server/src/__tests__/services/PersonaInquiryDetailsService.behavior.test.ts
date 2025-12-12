import {
  axiosCreateMock,
  axiosGetMock,
  buildPayload,
  buildService,
  resetAxiosMocks,
} from './personaInquiryTestUtils'

describe('PersonaInquiryDetailsService behavior', () => {
  beforeEach(() => {
    resetAxiosMocks()
    jest.clearAllMocks()
  })

  it('normalizes Persona inquiries and caches results', async () => {
    const payload = buildPayload()
    axiosGetMock.mockResolvedValueOnce({ data: payload })
    const { secretManager, service } = buildService()

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

    const cached = await service.getDetails('inq-1')
    expect(cached).toEqual(details)
    expect(axiosGetMock).toHaveBeenCalledTimes(1)
  })

  it('returns null for missing or blank inquiry ids', async () => {
    const { secretManager, service } = buildService()

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
    const { service } = buildService()

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

  it('caches failures when the client cannot be created or request fails', async () => {
    const { logger, secretManager, service } = buildService({ apiKey: '', logger: undefined })
    axiosGetMock.mockRejectedValueOnce(new Error('network fail'))

    const first = await service.getDetails('inq-3')
    const second = await service.getDetails('inq-3')

    expect(first).toBeNull()
    expect(second).toBeNull()
    expect(secretManager.getSecrets).toHaveBeenCalledTimes(1)
    expect(axiosGetMock).not.toHaveBeenCalled()
    expect(logger.error).toHaveBeenCalled()
  })
})

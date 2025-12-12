import { axiosCreateMock, buildService, type HelperMethods, resetAxiosMocks } from './personaInquiryTestUtils'

describe('PersonaInquiryDetailsService helpers (debug + client caching)', () => {
  beforeEach(() => {
    resetAxiosMocks()
    jest.clearAllMocks()
  })

  it('emits debug logs and caches the Persona client', async () => {
    const { logger, service } = buildService({ debug: true })
    const helpers = service as unknown as HelperMethods

    helpers.debug('message', 1)
    expect(logger.info).toHaveBeenCalled()

    const client = await helpers.ensureClient()
    const cached = await helpers.ensureClient()
    expect(cached).toBe(client)
    expect(axiosCreateMock).toHaveBeenCalledTimes(1)
  })

  it('handles basic field extraction and document collection', () => {
    const { service } = buildService()
    const helpers = service as unknown as HelperMethods

    const collected = helpers.collectDocumentAttributes([
      { attributes: { foo: 'bar' }, type: 123 as unknown as string },
    ])
    expect(collected).toEqual([])

    expect(helpers.extractPrimaryResource({ data: 5 })).toEqual({
      included: [],
      resource: { data: 5 },
    })

    expect(helpers.getFieldValue<{ value: null }>({ nullable: { value: null } }, 'nullable')).toBeUndefined()
  })
})

import type { ISecretManager } from '../../interfaces/ISecretManager'
import type { PersonaInquiryDetails } from '../../services/PersonaInquiryDetailsService'

import { PersonaInquiryDetailsService } from '../../services/PersonaInquiryDetailsService'
import { createMockLogger, type MockLogger } from '../setup/mockFactories'

export type HelperMethods = {
  asRecord: (value: unknown) => Record<string, unknown> | undefined
  asString: (value: unknown) => string | undefined
  buildFullNameFromAttributes: (attrs?: Record<string, unknown>) => string | undefined
  collectDocumentAttributes: (input: Array<Record<string, unknown>>) => Array<Record<string, unknown>>
  debug: (...args: unknown[]) => void
  ensureClient: () => Promise<unknown>
  extractPrimaryResource: (payload: Record<string, unknown>) => unknown
  getFieldValue: <T>(fields: Record<string, unknown> | undefined, key: string) => T | undefined
  mapDocumentClassToLabel: (code: string | undefined, country?: string) => string | undefined
  parseInquiryPayload: (payload: unknown) => null | PersonaInquiryDetails
}

export type PersonaTestHarness = {
  logger: MockLogger
  secretManager: ISecretManager
  service: PersonaInquiryDetailsService
}

export const axiosGetMock = jest.fn()

jest.mock('axios', () => {
  const create = jest.fn()
  return {
    __esModule: true,
    default: { create },
  }
})

export const axiosCreateMock = (jest.requireMock('axios') as { default: { create: jest.Mock } }).default.create

export const resetAxiosMocks = (): void => {
  axiosGetMock.mockReset()
  axiosCreateMock.mockReset()
  axiosCreateMock.mockReturnValue({ get: axiosGetMock })
}

export const createSecretManager = (apiKey: string = 'persona-key'): ISecretManager => {
  const getSecretsMock: jest.MockedFunction<ISecretManager['getSecrets']> = jest.fn(async (secretNames) => {
    const values: Record<string, string> = { PERSONA_API_KEY: apiKey }
    return secretNames.reduce<Record<(typeof secretNames)[number], string>>((acc, name) => {
      acc[name] = values[name] ?? ''
      return acc
    }, {} as Record<(typeof secretNames)[number], string>)
  })

  return {
    getSecret: jest.fn(),
    getSecrets: getSecretsMock,
  }
}

export const buildPayload = (overrides?: Record<string, unknown>) => ({
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

export const buildService = (
  options: { apiKey?: string, debug?: boolean, logger?: MockLogger } = {},
): PersonaTestHarness => {
  const secretManager = createSecretManager(options.apiKey)
  const logger = options.logger ?? createMockLogger()
  const service = new PersonaInquiryDetailsService(secretManager, { debug: options.debug }, logger)
  return { logger, secretManager, service }
}

import axios from 'axios'

import type { ISecretManager } from '../../interfaces/ISecretManager'

import { MoviiPaymentService } from '../../services/paymentServices/movii'
import { createMockLogger, type MockLogger } from '../setup/mockFactories'

jest.mock('axios')

export const mockedAxios = axios as jest.Mocked<typeof axios> & { isAxiosError?: jest.Mock }

const DEFAULT_SECRETS: Record<string, string> = {
  MOVII_API_KEY: 'api-key',
  MOVII_BALANCE_ACCOUNT_ID: 'account-1',
  MOVII_BALANCE_API_KEY: 'balance-key',
  MOVII_BASE_URL: 'https://movii.example.com',
  MOVII_CLIENT_ID: 'client-id',
  MOVII_CLIENT_SECRET: 'client-secret',
  MOVII_SIGNER_HANDLER: '$handler',
}

export const buildSecretManager = (overrides: Partial<Record<keyof typeof DEFAULT_SECRETS, string>> = {}): ISecretManager => {
  const secrets = { ...DEFAULT_SECRETS, ...overrides }

  return {
    getSecret: jest.fn(async (name: string) => secrets[name as keyof typeof secrets] ?? ''),
    getSecrets: jest.fn(async (names: readonly string[]) => {
      const result: Record<string, string> = {}
      names.forEach((name) => {
        result[name] = secrets[name as keyof typeof secrets] ?? ''
      })
      return result as Record<typeof names[number], string>
    }),
  }
}

export const resetAxiosMocks = (): void => {
  mockedAxios.get.mockReset()
  mockedAxios.post.mockReset()
  if (mockedAxios.isAxiosError) {
    mockedAxios.isAxiosError.mockReset()
  }
  mockedAxios.isAxiosError = mockedAxios.isAxiosError ?? jest.fn(() => false)
}

export const createMoviiService = (logger?: MockLogger): MoviiPaymentService => {
  return new MoviiPaymentService(buildSecretManager(), logger ?? createMockLogger())
}

import 'reflect-metadata'
import axios from 'axios'

import type { ILogger } from '../../interfaces'
import type { ISecretManager, Secret } from '../../interfaces/ISecretManager'

import { BrebPaymentService } from '../../services/paymentServices/brebPaymentService'

jest.mock('axios')

const mockedAxios = axios as unknown as {
  get: jest.Mock
  isAxiosError: jest.Mock
  post: jest.Mock
}

type BrebConfig = {
  apiBaseUrl: string
  authUrl: string
  clientId: string
  clientSecret: string
  dadAccount: string
  productCode: string
}

type BrebInternals = {
  buildSendPayload(keyDetails: Record<string, unknown>, value: number): Record<string, number | string>
  dispatchPayment(
    payload: Record<string, number | string>,
    config: BrebConfig,
    token: string,
  ): Promise<unknown>
  fetchTransactionReport(
    transactionId: string,
    rail: 'ENT' | 'TFY',
    config: BrebConfig,
    token: string,
  ): Promise<unknown>
  getAccessToken(config: BrebConfig): Promise<string>
  getConfig(): Promise<BrebConfig>
  interpretReport(report: Record<string, unknown>): 'failure' | 'pending' | 'success'
  isKeyUsable(keyDetails: null | Record<string, unknown>, rail: 'ENT' | 'TFY'): boolean
  pollConfig: { delayMs: number, timeoutMs: number }
  pollTransactionReport(
    transactionId: string,
    rail: 'ENT' | 'TFY',
    config: BrebConfig,
    token: string,
  ): Promise<null | { report: null | Record<string, unknown>, result: 'failure' | 'pending' | 'success' }>
}

type BrebKeyFixture = {
  accountNumber: string
  documentNumber: string
  documentType: string
  entityId?: string
  instructedAgent: 'ENT' | 'TFY'
  keyId: string
  keyState: string
  merchantId?: null | string
  name: string
  partyIdentifier: string
  partySystemIdentifier: string
  partyType: string
  subType: string
  typeAccount: string
}

const defaultKeyDetails: BrebKeyFixture = {
  accountNumber: '3112268870',
  documentNumber: '123456',
  documentType: 'CC',
  entityId: '0930',
  instructedAgent: 'ENT',
  keyId: 'key-123',
  keyState: 'ACTIVA',
  merchantId: 'm-001',
  name: 'Test User',
  partyIdentifier: '3112268870',
  partySystemIdentifier: 'MSISDN',
  partyType: 'PERSON',
  subType: 'PN',
  typeAccount: 'DBMO',
}

const tokenResponse = (token: string = 'token-1', expiresIn: number = 3600) => ({
  data: { access_token: token, expires_in: expiresIn },
})

const keyLookupResponse = (overrides: Partial<BrebKeyFixture> = {}) => ({
  data: { data: { ...defaultKeyDetails, ...overrides } },
})

const sendResponse = (moviiTxId: string | undefined = 'tx-001', rail: 'ENT' | 'TFY' = 'ENT') => ({
  data: { data: { moviiTxId, rail } },
})

const reportEnvelope = (status: string) => ({
  data: { data: { GlobalTransactionInfAndSts: { GlobalTxStatus: status } } },
})

const axiosFailure = (payload: unknown) => ({ isAxiosError: true, response: { data: payload } })

const getInternals = (service: BrebPaymentService): BrebInternals => service as unknown as BrebInternals

const buildSecretManager = (): ISecretManager => {
  const secrets: Partial<Record<Secret, string>> = {
    BREB_API_BASE_URL: 'https://breb.example.com/api',
    BREB_AUTH_URL: 'https://breb-auth.example.com/token',
    BREB_CLIENT_ID: 'client-id',
    BREB_CLIENT_SECRET: 'client-secret',
    BREB_DAD_ACCOUNT: '1234567890',
    BREB_PRODUCT_CODE: 'SR11231',
  }

  return {
    getSecret: jest.fn(async (name: Secret) => secrets[name] ?? ''),
    getSecrets: jest.fn(async <T extends readonly Secret[]>(names: T) => {
      const resolved = {} as Record<T[number], string>
      names.forEach((name) => {
        const key = name as T[number]
        resolved[key] = secrets[key] ?? ''
      })
      return resolved
    }),
  }
}

const buildLogger = (): ILogger => ({
  error: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
})

const setupService = () => {
  const logger = buildLogger()
  const service = new BrebPaymentService(buildSecretManager(), logger)
  return { internals: getInternals(service), logger, service }
}

const primeAccessToken = (token: string = 'token-1', expiresIn: number = 3600) =>
  mockedAxios.post.mockResolvedValueOnce(tokenResponse(token, expiresIn))

const primeKeyLookup = (overrides: Partial<BrebKeyFixture> = {}) =>
  mockedAxios.get.mockResolvedValueOnce(keyLookupResponse(overrides))

const primeSend = (moviiTxId?: string, rail: 'ENT' | 'TFY' = 'ENT') =>
  mockedAxios.post.mockResolvedValueOnce(sendResponse(moviiTxId, rail))

const primeReport = (status: string) => mockedAxios.get.mockResolvedValueOnce(reportEnvelope(status))

const expectSendPayload = (expectations: Record<string, number | string>) => {
  const sendCall = mockedAxios.post.mock.calls.find(call => String(call[0]).includes('/send'))
  expect(sendCall?.[1]).toMatchObject(expectations)
}

describe('BrebPaymentService', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockedAxios.get = jest.fn()
    mockedAxios.post = jest.fn()
    mockedAxios.isAxiosError = jest.fn(() => false)
  })

  describe('sendPayment', () => {
    it('sends payments and reports success when the transaction is accepted', async () => {
      const { service } = setupService()
      primeAccessToken()
      primeKeyLookup()
      primeSend('tx-001')
      primeReport('ACCP')

      const response = await service.sendPayment({
        account: defaultKeyDetails.accountNumber,
        bankCode: '9101',
        id: 'txn-1',
        value: 125_000,
      })

      expect(response).toEqual({ success: true, transactionId: 'tx-001' })
      expectSendPayload({
        creditor_account_number: defaultKeyDetails.accountNumber,
        creditor_document_number: defaultKeyDetails.documentNumber,
        creditor_document_type: defaultKeyDetails.documentType,
        creditor_entity_id: defaultKeyDetails.entityId ?? '',
        creditor_instructed_agent: defaultKeyDetails.instructedAgent,
        creditor_key_id: defaultKeyDetails.keyId,
        creditor_party_identifier: defaultKeyDetails.partyIdentifier,
        creditor_party_system_identifier: defaultKeyDetails.partySystemIdentifier,
        creditor_party_type: defaultKeyDetails.partyType,
        creditor_sub_type: defaultKeyDetails.subType,
        creditor_type_account: defaultKeyDetails.typeAccount,
        transaction_total_amount: 125_000,
      })
    })

    it('returns failure when the provider omits a transaction id', async () => {
      const { logger, service } = setupService()
      primeAccessToken()
      primeKeyLookup()
      mockedAxios.post.mockResolvedValueOnce({ data: { data: { rail: 'ENT' } } })
      mockedAxios.get.mockResolvedValue(reportEnvelope('FAILED'))

      const outcome = await service.sendPayment({
        account: defaultKeyDetails.accountNumber,
        bankCode: 'ENT',
        id: 'txn-4',
        value: 10_000,
      })

      expect(outcome).toEqual({ success: false })
      expect(logger.error).toHaveBeenCalledWith('[BreB] Send response missing transaction id', { rail: 'ENT' })
    })

    it('handles dispatch failures gracefully', async () => {
      const { logger, service } = setupService()
      mockedAxios.isAxiosError.mockReturnValue(true)
      primeAccessToken()
      primeKeyLookup()
      mockedAxios.post.mockRejectedValueOnce(axiosFailure('network down'))

      const result = await service.sendPayment({
        account: defaultKeyDetails.accountNumber,
        bankCode: 'ENT',
        id: 'txn-5',
        value: 15_000,
      })

      expect(result).toEqual({ success: false })
      expect(logger.error).toHaveBeenCalledWith('[BreB] Failed to dispatch payment', 'network down')
    })

    it('logs pending outcomes when polling does not conclude', async () => {
      const { internals, logger, service } = setupService()
      jest.spyOn(internals, 'pollTransactionReport').mockResolvedValueOnce({ report: null, result: 'pending' })
      primeAccessToken()
      primeKeyLookup()
      primeSend('tx-005')

      const result = await service.sendPayment({
        account: defaultKeyDetails.accountNumber,
        bankCode: 'ENT',
        id: 'txn-5',
        value: 15_000,
      })

      expect(result).toEqual({ success: false })
      expect(logger.warn).toHaveBeenCalledWith('[BreB] Payment pending after timeout', { transactionId: 'tx-005' })
    })

    it('fails fast when the bank code is unsupported', async () => {
      const { logger, service } = setupService()
      const result = await service.sendPayment({
        account: '123',
        bankCode: 'INVALID',
        id: 'txn-invalid',
        value: 1_000,
      })

      expect(result).toEqual({ success: false })
      expect(logger.error).toHaveBeenCalledWith(
        '[BreB] Payment submission failed',
        expect.objectContaining({ bankCode: 'INVALID', reason: expect.stringContaining('Unsupported BreB rail') }),
      )
    })
  })

  describe('verifyAccount', () => {
    it('rejects verification when the rail or key data is invalid', async () => {
      const { logger, service } = setupService()

      const invalidRail = await service.verifyAccount({ account: '123', bankCode: '???' })
      expect(invalidRail).toBe(false)

      primeAccessToken()
      mockedAxios.get.mockResolvedValueOnce({ data: {} })

      const missingKey = await service.verifyAccount({ account: '123', bankCode: 'ENT' })
      expect(missingKey).toBe(false)
      expect(logger.warn).toHaveBeenCalledWith(
        '[BreB] Failed to verify account',
        expect.objectContaining({ bankCode: '???', reason: expect.stringContaining('Unsupported BreB rail') }),
      )
    })

    it('handles key lookup failures from the provider', async () => {
      const { logger, service } = setupService()
      mockedAxios.isAxiosError.mockReturnValue(true)

      primeAccessToken()
      mockedAxios.get.mockRejectedValueOnce(axiosFailure('lookup failed'))

      const verified = await service.verifyAccount({ account: defaultKeyDetails.accountNumber, bankCode: 'ENT' })
      expect(verified).toBe(false)
      expect(logger.error).toHaveBeenCalledWith('[BreB] Failed to fetch key', 'lookup failed')
    })

    it('captures non-axios key lookup errors', async () => {
      const { logger, service } = setupService()

      primeAccessToken()
      mockedAxios.get.mockRejectedValueOnce(new Error('plain failure'))

      const verified = await service.verifyAccount({ account: defaultKeyDetails.accountNumber, bankCode: 'ENT' })
      expect(verified).toBe(false)
      expect(logger.error).toHaveBeenCalledWith('[BreB] Failed to fetch key', expect.any(Error))
    })

    it('recognises incomplete keys as unusable', async () => {
      const { logger, service } = setupService()
      primeAccessToken()
      primeKeyLookup({ accountNumber: '', keyState: 'ACTIVA' })

      const result = await service.verifyAccount({ account: '321', bankCode: 'ENT' })
      expect(result).toBe(false)
      expect(logger.warn).toHaveBeenCalledWith('[BreB] Key missing required attributes', expect.any(Object))
    })
  })

  describe('configuration and authentication', () => {
    it('caches access tokens and propagates authentication failures', async () => {
      mockedAxios.isAxiosError.mockReturnValue(true)
      const { internals } = setupService()
      const config = await internals.getConfig()
      primeAccessToken('token-1', 40)

      const first = await internals.getAccessToken(config)
      const second = await internals.getAccessToken(config)

      expect(first).toBe('token-1')
      expect(second).toBe('token-1')
      expect(mockedAxios.post).toHaveBeenCalledTimes(1)

      const failingInternals = getInternals(new BrebPaymentService(buildSecretManager(), buildLogger()))
      mockedAxios.post.mockRejectedValueOnce(axiosFailure('auth down'))

      await expect(failingInternals.getAccessToken(await failingInternals.getConfig())).rejects.toThrow(
        'BreB authentication failed',
      )
    })

    it('reuses cached configuration', async () => {
      const secretManager = buildSecretManager()
      const service = new BrebPaymentService(secretManager, buildLogger())
      const internals = getInternals(service)

      const firstConfig = await internals.getConfig()
      const secondConfig = await internals.getConfig()

      expect(secondConfig).toBe(firstConfig)
      expect(secretManager.getSecrets).toHaveBeenCalledTimes(1)
    })
  })

  describe('dispatch and report handling', () => {
    it('builds payload defaults and rejects incomplete keys', () => {
      const { internals } = setupService()
      const payload = internals.buildSendPayload({}, 50)

      expect(payload).toMatchObject({
        creditor_account_number: '',
        creditor_document_number: '',
        creditor_document_type: '',
        creditor_entity_id: '',
        creditor_instructed_agent: '',
        creditor_key_id: '',
        creditor_name: '',
        creditor_party_identifier: '',
        creditor_party_system_identifier: '',
        creditor_party_type: '',
        creditor_sub_type: '',
        creditor_type_account: '',
        transaction_total_amount: 50,
      })
      expect(internals.isKeyUsable({ instructedAgent: 'ENT', keyState: 'ACTIVA' }, 'ENT')).toBe(false)
    })

    it('returns null when dispatch responses lack data envelopes', async () => {
      const { internals } = setupService()
      const config = await internals.getConfig()

      mockedAxios.post.mockResolvedValueOnce({ data: null })

      const result = await internals.dispatchPayment({ amount: 1 }, config, 'token')
      expect(result).toBeNull()
    })

    it('handles dispatch failures without axios metadata', async () => {
      const { internals, logger } = setupService()
      const config = await internals.getConfig()

      mockedAxios.post.mockRejectedValueOnce(new Error('plain dispatch error'))

      const result = await internals.dispatchPayment({ amount: 1 }, config, 'token')
      expect(result).toBeNull()
      expect(logger.error).toHaveBeenCalledWith('[BreB] Failed to dispatch payment', expect.any(Error))
    })

    it('handles transaction report errors and pending interpretations', async () => {
      const { internals } = setupService()
      const config = await internals.getConfig()
      mockedAxios.isAxiosError.mockReturnValue(true)

      mockedAxios.get.mockRejectedValueOnce(axiosFailure('reporting down'))
      const report = await internals.fetchTransactionReport('tx-err', 'ENT', config, 'token')
      expect(report).toBeNull()
      expect(internals.interpretReport({})).toBe('pending')
      expect(
        internals.interpretReport({
          Debtor: { TransactionInfAndSts: { TransactionStatus: 'RJCT' } },
        }),
      ).toBe('failure')
    })

    it('handles transaction report errors without axios context', async () => {
      const { internals } = setupService()
      const config = await internals.getConfig()

      mockedAxios.get.mockRejectedValueOnce(new Error('plain report error'))

      const report = await internals.fetchTransactionReport('tx-plain', 'ENT', config, 'token')
      expect(report).toBeNull()
    })

    it('times out polling when no transaction report is available', async () => {
      const { internals } = setupService()
      internals.pollConfig.delayMs = 0
      internals.pollConfig.timeoutMs = 1

      jest.spyOn(internals, 'fetchTransactionReport').mockResolvedValue(null)

      const result = await internals.pollTransactionReport('tx-timeout', 'ENT', await internals.getConfig(), 'token')
      expect(result).toBeNull()
    })
  })
})

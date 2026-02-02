import 'reflect-metadata'
import axios from 'axios'

import type { ILogger } from '../../../../../core/logging/types'
import type { ISecretManager, Secret } from '../../../../../platform/secrets/ISecretManager'

import { BrebPaymentService } from '../../../../../modules/payments/infrastructure/paymentProviders/brebPaymentService'

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
    rail: string,
    config: BrebConfig,
    token: string,
  ): Promise<unknown>
  getAccessToken(config: BrebConfig): Promise<string>
  getConfig(): Promise<BrebConfig>
  interpretReport(report: Record<string, unknown>): 'failure' | 'pending' | 'success'
  isKeyUsable(keyDetails: null | Record<string, unknown>): boolean
  maskIdentifier(value: null | string | undefined): string
  pollConfig: { delayMs: number, timeoutMs: number }
  pollTransactionReport(
    transactionId: string,
    rail: string,
    config: BrebConfig,
    token: string,
  ): Promise<null | { report: null | Record<string, unknown>, result: 'failure' | 'pending' | 'success' }>
  sanitizeUrlForLogs(url: string): string
}

type BrebKeyFixture = {
  accountNumber: string
  documentNumber: string
  documentType: string
  entityId?: string
  instructedAgent: string
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

const sendResponse = (moviiTxId: string | undefined = 'tx-001', rail: string = 'ENT') => ({
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

const primeSend = (moviiTxId?: string, rail: string = 'ENT') =>
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

  describe('service basics', () => {
    it('exposes static liquidity and onboarding responses', async () => {
      const { service } = setupService()

      await expect(service.getLiquidity()).resolves.toBe(service.MAX_TOTAL_AMOUNT_PER_DAY)
      await expect(service.onboardUser()).resolves.toEqual({
        message: 'BreB does not require explicit onboarding',
        success: true,
      })
    })

    it('masks identifiers and tolerates malformed URLs in logs', () => {
      const { internals } = setupService()

      expect(internals.maskIdentifier(undefined)).toBe('<empty>')
      expect(internals.sanitizeUrlForLogs('://invalid url')).toBe('://invalid url')
    })
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
        id: 'txn-4',
        value: 10_000,
      })

      expect(outcome).toEqual({ code: 'permanent', reason: 'missing_transaction_id', success: false })
      expect(logger.error).toHaveBeenCalledWith('[BreB] Send response missing transaction id', { responseRail: 'ENT' })
    })

    it('handles dispatch failures gracefully', async () => {
      const { logger, service } = setupService()
      mockedAxios.isAxiosError.mockReturnValue(true)
      primeAccessToken()
      primeKeyLookup()
      mockedAxios.post.mockRejectedValueOnce(axiosFailure('network down'))

      const result = await service.sendPayment({
        account: defaultKeyDetails.accountNumber,
        id: 'txn-5',
        value: 15_000,
      })

      expect(result).toEqual({ code: 'permanent', reason: 'network down', success: false })
      expect(logger.error).toHaveBeenCalledWith(
        '[BreB] Failed to dispatch payment',
        expect.objectContaining({ responseData: 'network down' }),
      )
    })

    it('logs pending outcomes when polling does not conclude', async () => {
      const { internals, logger, service } = setupService()
      jest.spyOn(internals, 'pollTransactionReport').mockResolvedValueOnce({ report: null, result: 'pending' })
      primeAccessToken()
      primeKeyLookup()
      primeSend('tx-005')

      const result = await service.sendPayment({
        account: defaultKeyDetails.accountNumber,
        id: 'txn-5',
        value: 15_000,
      })

      expect(result).toEqual({ code: 'retriable', reason: 'pending', success: false, transactionId: 'tx-005' })
      expect(logger.warn).toHaveBeenCalledWith('[BreB] Payment pending after timeout', { transactionId: 'tx-005' })
    })

    it('includes transaction ids when the provider reports failure', async () => {
      const { service } = setupService()
      primeAccessToken()
      primeKeyLookup()
      primeSend('tx-006')
      primeReport('RJCT')

      const result = await service.sendPayment({
        account: defaultKeyDetails.accountNumber,
        id: 'txn-6',
        value: 15_000,
      })

      expect(result).toEqual({ code: 'permanent', reason: 'failure', success: false, transactionId: 'tx-006' })
    })

    it('uses the rail provided by the send response when polling transaction status', async () => {
      const { service } = setupService()
      primeAccessToken()
      primeKeyLookup({ instructedAgent: 'ENT' })
      primeSend('tx-009', 'custom-rail-01')
      primeReport('ACCP')

      await service.sendPayment({
        account: defaultKeyDetails.accountNumber,
        id: 'txn-9',
        value: 75_000,
      })

      const reportCall = mockedAxios.get.mock.calls.find(call => String(call[0]).includes('transaction-report'))
      expect(reportCall?.[1]?.headers?.['x-rail']).toBe('custom-rail-01')
    })

    it('falls back to the key rail when the response rail is unusable', async () => {
      const { logger, service } = setupService()
      primeAccessToken()
      primeKeyLookup({ instructedAgent: 'TFY' })
      primeSend('tx-010', '   ')
      primeReport('ACSC')

      await service.sendPayment({
        account: defaultKeyDetails.accountNumber,
        id: 'txn-10',
        value: 80_000,
      })

      const reportCall = mockedAxios.get.mock.calls.find(call => String(call[0]).includes('transaction-report'))
      expect(reportCall?.[1]?.headers?.['x-rail']).toBe('TFY')
      expect(logger.warn).toHaveBeenCalledWith(
        '[BreB] Send response rail unusable, defaulting to instructed agent',
        {
          instructedAgent: 'TFY',
          responseRail: '   ',
        },
      )
    })

    it('logs unexpected failures during submission', async () => {
      const { logger, service } = setupService()
      const internals = getInternals(service)
      jest.spyOn(internals, 'getAccessToken').mockRejectedValueOnce(new Error('boom'))

      const result = await service.sendPayment({
        account: '123',
        id: 'txn-broken',
        value: 500,
      })

      expect(result).toEqual({ code: 'retriable', reason: 'boom', success: false })
      expect(logger.error).toHaveBeenCalledWith('[BreB] Payment submission failed', { account: '123', reason: 'boom' })
    })
  })

  describe('verifyAccount', () => {
    it('handles key lookup failures from the provider', async () => {
      const { logger, service } = setupService()
      mockedAxios.isAxiosError.mockReturnValue(true)

      primeAccessToken()
      mockedAxios.get.mockRejectedValueOnce(axiosFailure('lookup failed'))

      const verified = await service.verifyAccount({ account: defaultKeyDetails.accountNumber })
      expect(verified).toBe(false)
      expect(logger.error).toHaveBeenCalledWith(
        '[BreB] Failed to fetch key',
        expect.objectContaining({ responseData: 'lookup failed' }),
      )
    })

    it('captures non-axios key lookup errors', async () => {
      const { logger, service } = setupService()

      primeAccessToken()
      mockedAxios.get.mockRejectedValueOnce(new Error('plain failure'))

      const verified = await service.verifyAccount({ account: defaultKeyDetails.accountNumber })
      expect(verified).toBe(false)
      expect(logger.error).toHaveBeenCalledWith(
        '[BreB] Failed to fetch key',
        expect.objectContaining({ message: 'plain failure' }),
      )
    })

    it('recognises incomplete keys as unusable', async () => {
      const { logger, service } = setupService()
      primeAccessToken()
      primeKeyLookup({ accountNumber: '', keyState: 'ACTIVA' })

      const result = await service.verifyAccount({ account: '321' })
      expect(result).toBe(false)
      expect(logger.warn).toHaveBeenCalledWith('[BreB] Key missing required attributes', expect.any(Object))
    })

    it('logs verification failures when authentication cannot be performed', async () => {
      const { logger, service } = setupService()
      const internals = getInternals(service)
      jest.spyOn(internals, 'getAccessToken').mockRejectedValueOnce(new Error('auth fail'))

      const verified = await service.verifyAccount({ account: defaultKeyDetails.accountNumber })
      expect(verified).toBe(false)
      expect(logger.warn).toHaveBeenCalledWith('[BreB] Failed to verify account', {
        account: defaultKeyDetails.accountNumber,
        reason: 'auth fail',
      })
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
      expect(internals.isKeyUsable({ instructedAgent: 'ENT', keyState: 'ACTIVA' })).toBe(false)
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

      await expect(internals.dispatchPayment({ amount: 1 }, config, 'token')).rejects.toThrow('plain dispatch error')
      expect(logger.error).toHaveBeenCalledWith(
        '[BreB] Failed to dispatch payment',
        expect.objectContaining({ message: 'plain dispatch error' }),
      )
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

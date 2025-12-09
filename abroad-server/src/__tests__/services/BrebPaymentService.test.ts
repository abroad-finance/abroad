import 'reflect-metadata'
import axios from 'axios'

import type { ILogger } from '../../interfaces'
import type { ISecretManager, Secret } from '../../interfaces/ISecretManager'

import { BrebPaymentService } from '../../services/paymentServices/brebPaymentService'

jest.mock('axios')

const mockedAxios = axios as unknown as { get: jest.Mock, isAxiosError: jest.Mock, post: jest.Mock }

type BrebConfig = {
  apiBaseUrl: string
  authUrl: string
  clientId: string
  clientSecret: string
  dadAccount: string
  forwardedFor: string
  origin: string
  productCode: string
}

type BrebInternals = {
  buildSendPayload(keyDetails: Record<string, unknown>, value: number): Record<string, unknown>
  dispatchPayment(
    payload: Record<string, number | string>,
    config: BrebConfig,
    token: string,
  ): Promise<unknown>
  fetchTransactionReport(transactionId: string, rail: 'ENT' | 'TFY', config: BrebConfig, token: string): Promise<unknown>
  getAccessToken(config: BrebConfig): Promise<string>
  getConfig(): Promise<BrebConfig>
  interpretReport(report: {
    Creditor?: { TransactionInfAndSts?: { TransactionStatus?: string } }
    Debtor?: { TransactionInfAndSts?: { TransactionStatus?: string } }
    GlobalTransactionInfAndSts?: { GlobalTxStatus?: string }
  }): 'failure' | 'pending' | 'success'
  isKeyUsable(keyDetails: Record<string, unknown>, rail: 'ENT' | 'TFY'): boolean
  pollConfig: { delayMs: number, timeoutMs: number }
  pollTransactionReport(
    transactionId: string,
    rail: 'ENT' | 'TFY',
    config: BrebConfig,
    token: string,
  ): Promise<null | { report: unknown, result: 'failure' | 'pending' | 'success' }>
}

const getInternals = (service: BrebPaymentService): BrebInternals => service as unknown as BrebInternals

const buildSecretManager = (): ISecretManager => {
  const secrets = {
    BREB_API_BASE_URL: 'https://breb.example.com/api',
    BREB_AUTH_URL: 'https://breb-auth.example.com/token',
    BREB_CLIENT_ID: 'client-id',
    BREB_CLIENT_SECRET: 'client-secret',
    BREB_DAD_ACCOUNT: '1234567890',
    BREB_PRODUCT_CODE: 'SR11231',
  }

  return {
    getSecret: jest.fn(async (name: Secret) => secrets[name as keyof typeof secrets] ?? ''),
    getSecrets: jest.fn(async <T extends readonly Secret[]>(names: T) => {
      const resolved = {} as Record<T[number], string>
      names.forEach((name) => {
        resolved[name as T[number]] = secrets[name as keyof typeof secrets] ?? ''
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

describe('BrebPaymentService', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockedAxios.get = jest.fn()
    mockedAxios.post = jest.fn()
    mockedAxios.isAxiosError = jest.fn(() => false)
  })

  it('verifies accounts by validating key state and rail', async () => {
    const service = new BrebPaymentService(buildSecretManager(), buildLogger())
    mockedAxios.post.mockResolvedValueOnce({ data: { access_token: 'token-1', expires_in: 3600 } })
    mockedAxios.get.mockResolvedValueOnce({
      data: {
        data: {
          accountNumber: '3112268870',
          documentNumber: '123456',
          documentType: 'CC',
          instructedAgent: 'ENT',
          keyId: 'key-123',
          keyState: 'ACTIVA',
          name: 'Test User',
          partyIdentifier: '3112268870',
          partySystemIdentifier: 'MSISDN',
          partyType: 'PERSON',
          subType: 'PN',
          typeAccount: 'DBMO',
        },
      },
    })

    const result = await service.verifyAccount({ account: '3112268870', bankCode: 'ENT' })
    expect(result).toBe(true)
    expect(mockedAxios.get).toHaveBeenCalledWith(
      expect.stringContaining('/key/3112268870'),
      expect.objectContaining({ headers: expect.any(Object) }),
    )
  })

  it('provides default liquidity and onboarding acknowledgement', async () => {
    const service = new BrebPaymentService(buildSecretManager(), buildLogger())
    await expect(service.getLiquidity()).resolves.toBe(service.MAX_TOTAL_AMOUNT_PER_DAY)
    await expect(service.onboardUser()).resolves.toEqual({
      message: 'BreB does not require explicit onboarding',
      success: true,
    })
  })

  it('sends payments and reports success when the transaction is accepted', async () => {
    const service = new BrebPaymentService(buildSecretManager(), buildLogger())

    mockedAxios.post
      .mockResolvedValueOnce({ data: { access_token: 'token-1', expires_in: 3600 } })
      .mockResolvedValueOnce({ data: { data: { moviiTxId: 'tx-001', rail: 'ENT' } } })

    mockedAxios.get
      .mockResolvedValueOnce({
        data: {
          data: {
            accountNumber: '3112268870',
            documentNumber: '1098765',
            documentType: 'CC',
            entityId: '0930',
            instructedAgent: 'ENT',
            keyId: 'key-123',
            keyState: 'ACTIVA',
            merchantId: 'm-001',
            name: 'Carlos Ruiz',
            partyIdentifier: '3112268870',
            partySystemIdentifier: 'MSISDN',
            partyType: 'PERSON',
            subType: 'PN',
            typeAccount: 'DBMO',
          },
        },
      })
      .mockResolvedValueOnce({
        data: {
          data: {
            GlobalTransactionInfAndSts: { GlobalTxStatus: 'ACCP' },
          },
        },
      })

    const response = await service.sendPayment({
      account: '3112268870',
      bankCode: '9101',
      id: 'txn-1',
      value: 125_000,
    })

    expect(response).toEqual({ success: true, transactionId: 'tx-001' })
    const sendCall = mockedAxios.post.mock.calls.find(call => String(call[0]).includes('/send'))
    expect(sendCall?.[1]).toMatchObject({
      creditor_account_number: '3112268870',
      creditor_document_number: '1098765',
      creditor_document_type: 'CC',
      creditor_entity_id: '0930',
      creditor_instructed_agent: 'ENT',
      creditor_key_id: 'key-123',
      creditor_merchant_id: 'm-001',
      creditor_party_identifier: '3112268870',
      creditor_party_system_identifier: 'MSISDN',
      creditor_party_type: 'PERSON',
      creditor_sub_type: 'PN',
      creditor_type_account: 'DBMO',
      transaction_total_amount: 125_000,
    })
  })

  it('returns failure when the transaction report is rejected', async () => {
    const logger = buildLogger()
    const service = new BrebPaymentService(buildSecretManager(), logger)

    mockedAxios.post
      .mockResolvedValueOnce({ data: { access_token: 'token-1', expires_in: 3600 } })
      .mockResolvedValueOnce({ data: { data: { moviiTxId: 'tx-002', rail: 'ENT' } } })

    mockedAxios.get
      .mockResolvedValueOnce({
        data: {
          data: {
            instructedAgent: 'ENT',
            keyId: 'key-456',
            keyState: 'ACTIVA',
            name: 'Test User',
            partyIdentifier: '3001234567',
            partySystemIdentifier: 'MSISDN',
            partyType: 'PERSON',
            subType: 'PN',
            typeAccount: 'DBMO',
          },
        },
      })
      .mockResolvedValueOnce({
        data: {
          data: {
            GlobalTransactionInfAndSts: { GlobalTxStatus: 'RJCT' },
          },
        },
      })

    const result = await service.sendPayment({
      account: '3001234567',
      bankCode: 'ENT',
      id: 'txn-3',
      value: 50_000,
    })

    expect(result).toEqual({ success: false })
    expect(logger.warn).not.toHaveBeenCalledWith(expect.stringContaining('pending'))
  })

  it('returns failure when the provider omits a transaction id', async () => {
    const logger = buildLogger()
    const service = new BrebPaymentService(buildSecretManager(), logger)

    mockedAxios.post.mockResolvedValueOnce({ data: { access_token: 'token-1', expires_in: 3600 } })
    mockedAxios.get.mockResolvedValueOnce({
      data: {
        data: {
          accountNumber: '3009876543',
          documentNumber: '9001',
          documentType: 'CE',
          instructedAgent: 'ENT',
          keyId: 'key-789',
          keyState: 'ACTIVA',
          name: 'Test User',
          partyIdentifier: '3009876543',
          partySystemIdentifier: 'MSISDN',
          partyType: 'PERSON',
          subType: 'PN',
          typeAccount: 'DBMO',
        },
      },
    })
    mockedAxios.post.mockResolvedValueOnce({ data: { data: { rail: 'ENT' } } })

    const outcome = await service.sendPayment({
      account: '3009876543',
      bankCode: 'ENT',
      id: 'txn-4',
      value: 10_000,
    })

    expect(outcome).toEqual({ success: false })
    expect(logger.error).toHaveBeenCalledWith('[BreB] Send response missing transaction id', { rail: 'ENT' })
  })

  it('handles dispatch failures gracefully', async () => {
    const logger = buildLogger()
    const service = new BrebPaymentService(buildSecretManager(), logger)
    mockedAxios.isAxiosError.mockReturnValue(true)

    mockedAxios.post
      .mockResolvedValueOnce({ data: { access_token: 'token-1', expires_in: 3600 } })
      .mockRejectedValueOnce({ isAxiosError: true, response: { data: 'network down' } })

    mockedAxios.get.mockResolvedValueOnce({
      data: {
        data: {
          accountNumber: '3001112222',
          documentNumber: '12345',
          documentType: 'CC',
          instructedAgent: 'ENT',
          keyId: 'key-900',
          keyState: 'ACTIVA',
          name: 'Test User',
          partyIdentifier: '3001112222',
          partySystemIdentifier: 'MSISDN',
          partyType: 'PERSON',
          subType: 'PN',
          typeAccount: 'DBMO',
        },
      },
    })

    const result = await service.sendPayment({
      account: '3001112222',
      bankCode: 'ENT',
      id: 'txn-5',
      value: 15_000,
    })

    expect(result).toEqual({ success: false })
    expect(logger.error).toHaveBeenCalledWith('[BreB] Failed to dispatch payment', 'network down')
  })

  it('logs pending outcomes when polling does not conclude', async () => {
    const logger = buildLogger()
    const service = new BrebPaymentService(buildSecretManager(), logger)
    const internals = getInternals(service)

    jest.spyOn(internals, 'pollTransactionReport').mockResolvedValueOnce({ report: null, result: 'pending' })

    mockedAxios.post
      .mockResolvedValueOnce({ data: { access_token: 'token-1', expires_in: 3600 } })
      .mockResolvedValueOnce({ data: { data: { moviiTxId: 'tx-005', rail: 'ENT' } } })

    mockedAxios.get.mockResolvedValueOnce({
      data: {
        data: {
          accountNumber: '3001112222',
          documentNumber: '12345',
          documentType: 'CC',
          instructedAgent: 'ENT',
          keyId: 'key-900',
          keyState: 'ACTIVA',
          name: 'Test User',
          partyIdentifier: '3001112222',
          partySystemIdentifier: 'MSISDN',
          partyType: 'PERSON',
          subType: 'PN',
          typeAccount: 'DBMO',
        },
      },
    })

    const result = await service.sendPayment({
      account: '3001112222',
      bankCode: 'ENT',
      id: 'txn-5',
      value: 15_000,
    })

    expect(result).toEqual({ success: false })
    expect(logger.warn).toHaveBeenCalledWith('[BreB] Payment pending after timeout', { transactionId: 'tx-005' })
  })

  it('rejects verification when the rail or key data is invalid', async () => {
    const logger = buildLogger()
    const service = new BrebPaymentService(buildSecretManager(), logger)

    const invalidRail = await service.verifyAccount({ account: '123', bankCode: '???' })
    expect(invalidRail).toBe(false)

    mockedAxios.post.mockResolvedValueOnce({ data: { access_token: 'token-1', expires_in: 3600 } })
    mockedAxios.get.mockResolvedValueOnce({ data: {} })

    const missingKey = await service.verifyAccount({ account: '123', bankCode: 'ENT' })
    expect(missingKey).toBe(false)
    expect(logger.warn).toHaveBeenCalledWith('[BreB] Failed to verify account', expect.objectContaining({ bankCode: '???' }))
  })

  it('handles transaction report errors and pending interpretations', async () => {
    const service = new BrebPaymentService(buildSecretManager(), buildLogger())
    const internals = getInternals(service)
    const config = await internals.getConfig()
    mockedAxios.isAxiosError.mockReturnValue(true)

    mockedAxios.get.mockRejectedValueOnce({ isAxiosError: true, response: { data: 'reporting down' } })
    const report = await internals.fetchTransactionReport('tx-err', 'ENT', config, 'token')
    expect(report).toBeNull()
    expect(internals.interpretReport({})).toBe('pending')
  })

  it('caches access tokens and propagates authentication failures', async () => {
    const service = new BrebPaymentService(buildSecretManager(), buildLogger())
    const internals = getInternals(service)
    const config = await internals.getConfig()
    mockedAxios.isAxiosError.mockReturnValue(true)

    mockedAxios.post.mockResolvedValueOnce({ data: { access_token: 'token-1', expires_in: 40 } })

    const first = await internals.getAccessToken(config)
    const second = await internals.getAccessToken(config)

    expect(first).toBe('token-1')
    expect(second).toBe('token-1')
    expect(mockedAxios.post).toHaveBeenCalledTimes(1)

    const failingService = new BrebPaymentService(buildSecretManager(), buildLogger())
    const failingInternals = getInternals(failingService)
    mockedAxios.post.mockRejectedValueOnce({ isAxiosError: true, response: { data: 'auth down' } })

    await expect(failingInternals.getAccessToken(await failingInternals.getConfig())).rejects.toThrow('BreB authentication failed')
  })

  it('propagates authentication failures without axios metadata', async () => {
    const internals = getInternals(new BrebPaymentService(buildSecretManager(), buildLogger()))
    mockedAxios.post.mockRejectedValueOnce(new Error('auth exploded'))

    await expect(internals.getAccessToken(await internals.getConfig())).rejects.toThrow('BreB authentication failed')
  })

  it('fails fast when the bank code is unsupported during sendPayment', async () => {
    const logger = buildLogger()
    const service = new BrebPaymentService(buildSecretManager(), logger)

    const result = await service.sendPayment({
      account: '123',
      bankCode: 'INVALID',
      id: 'txn-invalid',
      value: 1_000,
    })

    expect(result).toEqual({ success: false })
    expect(logger.error).toHaveBeenCalledWith(
      '[BreB] Payment submission failed',
      expect.objectContaining({ bankCode: 'INVALID', reason: expect.any(String) }),
    )
  })

  it('handles key lookup failures from the provider', async () => {
    const logger = buildLogger()
    const service = new BrebPaymentService(buildSecretManager(), logger)
    mockedAxios.isAxiosError.mockReturnValue(true)

    mockedAxios.post.mockResolvedValueOnce({ data: { access_token: 'token-1', expires_in: 3600 } })
    mockedAxios.get.mockRejectedValueOnce({ isAxiosError: true, response: { data: 'lookup failed' } })

    const verified = await service.verifyAccount({ account: '3112268870', bankCode: 'ENT' })
    expect(verified).toBe(false)
    expect(logger.error).toHaveBeenCalledWith('[BreB] Failed to fetch key', 'lookup failed')
  })

  it('captures non-axios key lookup errors', async () => {
    const logger = buildLogger()
    const service = new BrebPaymentService(buildSecretManager(), logger)

    mockedAxios.post.mockResolvedValueOnce({ data: { access_token: 'token-1', expires_in: 3600 } })
    mockedAxios.get.mockRejectedValueOnce(new Error('plain failure'))

    const verified = await service.verifyAccount({ account: '3112268870', bankCode: 'ENT' })
    expect(verified).toBe(false)
    expect(logger.error).toHaveBeenCalledWith('[BreB] Failed to fetch key', expect.any(Error))
  })

  it('reuses cached configuration and recognises failure reports', async () => {
    const secretManager = buildSecretManager()
    const service = new BrebPaymentService(secretManager, buildLogger())
    const internals = getInternals(service)

    const firstConfig = await internals.getConfig()
    const secondConfig = await internals.getConfig()

    expect(secondConfig).toBe(firstConfig)
    expect(secretManager.getSecrets).toHaveBeenCalledTimes(1)
    expect(internals.interpretReport({
      Debtor: { TransactionInfAndSts: { TransactionStatus: 'RJCT' } },
    })).toBe('failure')
  })

  it('builds payload defaults and rejects incomplete keys', () => {
    const service = new BrebPaymentService(buildSecretManager(), buildLogger())
    const internals = getInternals(service)
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
    const service = new BrebPaymentService(buildSecretManager(), buildLogger())
    const internals = getInternals(service)
    const config = await internals.getConfig()

    mockedAxios.post.mockResolvedValueOnce({ data: null })

    const result = await internals.dispatchPayment({ amount: 1 }, config, 'token')
    expect(result).toBeNull()
  })

  it('handles dispatch failures without axios metadata', async () => {
    const logger = buildLogger()
    const service = new BrebPaymentService(buildSecretManager(), logger)
    const internals = getInternals(service)
    const config = await internals.getConfig()

    mockedAxios.post.mockRejectedValueOnce(new Error('plain dispatch error'))

    const result = await internals.dispatchPayment({ amount: 1 }, config, 'token')
    expect(result).toBeNull()
    expect(logger.error).toHaveBeenCalledWith('[BreB] Failed to dispatch payment', expect.any(Error))
  })

  it('handles transaction report errors without axios context', async () => {
    const service = new BrebPaymentService(buildSecretManager(), buildLogger())
    const internals = getInternals(service)
    const config = await internals.getConfig()

    mockedAxios.get.mockRejectedValueOnce(new Error('plain report error'))

    const report = await internals.fetchTransactionReport('tx-plain', 'ENT', config, 'token')
    expect(report).toBeNull()
  })

  it('times out polling when no transaction report is available', async () => {
    const service = new BrebPaymentService(buildSecretManager(), buildLogger())
    const internals = getInternals(service)
    internals.pollConfig.delayMs = 0
    internals.pollConfig.timeoutMs = 1

    jest.spyOn(internals, 'fetchTransactionReport').mockResolvedValue(null)

    const result = await internals.pollTransactionReport('tx-timeout', 'ENT', await internals.getConfig(), 'token')
    expect(result).toBeNull()
  })
})

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

// BTB CO GET BALANCE PASSWORD SUBSCRIBER always answers HTTP 200 and puts the
// real outcome in the body. `code` comes back as a JSON number, not a string.
const balanceResponse = (
  data: unknown,
  code: number | string = 200,
  message: string = 'Transacción exitosa',
) => ({
  data: { code, correlationId: 'a1b2c3d4-0000-4000-8000-000000000000', data, message },
  status: 200,
})

// Verbatim shape captured from the live endpoint.
const liveBalanceData = (balance: number) => ({
  BALANCE: balance,
  FICBALANCE: 0,
  OTHERWALLETS: '',
  TRID: '3999999027202608120929F19687',
  TXNID: 'CB260812.0929.F06442',
  TXNSTATUS: 200,
  TYPE: 'ALLWCBLREQ',
})

// axios rejects with a real Error carrying `response`, which is what the
// service's `error instanceof Error` rethrow path depends on.
const httpError = (message: string, status: number, data?: unknown) =>
  Object.assign(new Error(message), { isAxiosError: true, response: { data, status } })

const getInternals = (service: BrebPaymentService): BrebInternals => service as unknown as BrebInternals

const buildSecretManager = (overrides: Partial<Record<Secret, string>> = {}): ISecretManager => {
  const secrets: Partial<Record<Secret, string>> = {
    BREB_API_BASE_URL: 'https://breb.example.com/api',
    BREB_AUTH_URL: 'https://breb-auth.example.com/token',
    BREB_CLIENT_ID: 'client-id',
    BREB_CLIENT_SECRET: 'client-secret',
    BREB_DAD_ACCOUNT: '1234567890',
    BREB_PRODUCT_CODE: 'SR11231',
    MOVII_BALANCE_API_BASE_URL: 'https://btb-balance.example.com',
    MOVII_BALANCE_AUTH_URL: 'https://btb-auth.example.com/oauth2/token',
    MOVII_BALANCE_AUTHORIZATION: 'Ga5vY2c7ySl4+Fg4CasaWg==:zlLVB39CT6AAV5gBDv/Cfg==',
    MOVII_BALANCE_CLIENT_ID: 'balance-client-id',
    MOVII_BALANCE_CLIENT_SECRET: 'balance-client-secret',
    ...overrides,
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

const setupService = (secretOverrides: Partial<Record<Secret, string>> = {}) => {
  const logger = buildLogger()
  const service = new BrebPaymentService(buildSecretManager(secretOverrides), logger)
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
      // A literal balance, not a limit constant: the two are unrelated, and
      // borrowing one as the other broke this test the moment the daily cap
      // stopped being a finite number.
      const balance = 25_000_000
      primeAccessToken()
      mockedAxios.get.mockResolvedValueOnce(balanceResponse(liveBalanceData(balance)))

      await expect(service.getLiquidity()).resolves.toBe(balance)
      await expect(service.onboardUser()).resolves.toEqual({
        message: 'BreB does not require explicit onboarding',
        success: true,
      })
    })

    it('calls the BTB get-balance route with both documented auth headers', async () => {
      const { service } = setupService()
      primeAccessToken('token-9')
      mockedAxios.get.mockResolvedValueOnce(balanceResponse({ balance: 1_500 }))

      await expect(service.getLiquidity()).resolves.toBe(1_500)

      // BTB is a separate Movii product: its bearer must come from its own
      // OAuth client, not the Bre-B payment one.
      expect(mockedAxios.post.mock.calls[0][0]).toBe('https://btb-auth.example.com/oauth2/token')

      const [url, options] = mockedAxios.get.mock.calls[0]
      expect(url).toBe(
        'https://btb-balance.example.com/core/co/btb-balance-password-subscriber/get-balance',
      )
      expect(options.headers).toMatchObject({
        'authorization': 'Ga5vY2c7ySl4+Fg4CasaWg==:zlLVB39CT6AAV5gBDv/Cfg==',
        'authorizationApi': 'Bearer token-9',
        'Content-Type': 'text/plain',
      })
      // Movii's example uses a 16-digit numeric correlation id.
      expect(options.headers.correlationid).toMatch(/^\d{16}$/)
    })

    it('uses a configured gateway URL verbatim instead of appending the spec path', async () => {
      // Movii's OCI API Gateway publishes its own deployment path; appending the
      // spec's in-cluster route on top of it produced a doubled path and a 404.
      const { service } = setupService({
        MOVII_BALANCE_API_BASE_URL:
          'https://apigw.example.com/api-manager/movii/btb-ns/api/get-balance',
      })
      primeAccessToken()
      mockedAxios.get.mockResolvedValueOnce(balanceResponse({ balance: 10 }))

      await expect(service.getLiquidity()).resolves.toBe(10)
      expect(mockedAxios.get.mock.calls[0][0]).toBe(
        'https://apigw.example.com/api-manager/movii/btb-ns/api/get-balance',
      )
    })

    it('reads BALANCE and never the unrelated FICBALANCE beside it', async () => {
      const { service } = setupService()
      primeAccessToken()
      // Live shape: BALANCE is the float, FICBALANCE is a different figure that
      // is 0 here — picking it would report no liquidity at all.
      mockedAxios.get.mockResolvedValueOnce(balanceResponse(liveBalanceData(3_156_118.38)))

      await expect(service.getLiquidity()).resolves.toBe(3_156_118.38)
    })

    it('accepts the success code as a number or a string', async () => {
      const { service } = setupService()
      primeAccessToken()
      mockedAxios.get.mockResolvedValueOnce(balanceResponse(liveBalanceData(100), 200))
      await expect(service.getLiquidity()).resolves.toBe(100)

      mockedAxios.get.mockResolvedValueOnce(balanceResponse(liveBalanceData(200), '00'))
      await expect(service.getLiquidity()).resolves.toBe(200)
    })

    it('rejects a numeric error code instead of letting it slip past the check', async () => {
      const { service } = setupService()
      primeAccessToken()
      // `code` arrives as a JSON number; reading it as a string skipped this
      // guard entirely and reported the failure as a missing balance.
      mockedAxios.get.mockResolvedValueOnce(
        balanceResponse({ TXNSTATUS: 404 }, 404, 'USER NOT FOUND, NOT VALID'),
      )

      await expect(service.getLiquidity()).rejects.toThrow(/code 404/)
    })

    it('rejects instead of reporting a zero float when Movii fails', async () => {
      const { logger, service } = setupService()
      primeAccessToken()
      mockedAxios.isAxiosError = jest.fn(() => true)
      mockedAxios.get.mockRejectedValueOnce(
        httpError('Request failed with status code 500', 500, { message: 'boom' }),
      )

      // Resolving 0 lets the liquidity cache store "no float", which rejects
      // every COP payout until Movii recovers.
      await expect(service.getLiquidity()).rejects.toThrow(/status code 500/)
      expect(logger.error).toHaveBeenCalledWith('[BreB] Error fetching liquidity', expect.objectContaining({ status: 500 }))
    })

    it('rejects when the balance is missing from an otherwise valid response', async () => {
      const { service } = setupService()
      primeAccessToken()
      mockedAxios.get.mockResolvedValueOnce(balanceResponse({ accountId: '123' }))

      await expect(service.getLiquidity()).rejects.toThrow(/usable balance/)
    })

    it('refuses a locale-grouped balance rather than under-reading it', async () => {
      const { service } = setupService()
      primeAccessToken()
      // parseFloat would turn this into 1.234 — a thousand-fold under-read.
      mockedAxios.get.mockResolvedValueOnce(balanceResponse({ balance: '1.234.567,89' }))

      await expect(service.getLiquidity()).rejects.toThrow(/usable balance/)
    })

    it('rejects a non-success body code and re-authenticates after a 401', async () => {
      const { service } = setupService()
      primeAccessToken('stale-token')
      mockedAxios.get.mockResolvedValueOnce(
        balanceResponse(null, '401', 'AUTHORZATION INVALID, HEADER AUTHORIZATION INVALID'),
      )

      // The endpoint answers HTTP 200 even when it refuses the request, so the
      // body code is the only signal that this is not a real balance.
      await expect(service.getLiquidity()).rejects.toThrow(/code 401/)

      primeAccessToken('fresh-token')
      mockedAxios.get.mockResolvedValueOnce(balanceResponse({ balance: 42 }))
      await expect(service.getLiquidity()).resolves.toBe(42)

      // The rejected bearer must not be replayed.
      expect(mockedAxios.get.mock.calls[1][1].headers.authorizationApi).toBe('Bearer fresh-token')
    })

    it('keeps the balance bearer separate from the payment bearer', async () => {
      const { service } = setupService()
      primeAccessToken('balance-token')
      mockedAxios.get.mockResolvedValueOnce(
        balanceResponse(null, '401', 'AUTHORZATION INVALID, HEADER AUTHORIZATION INVALID'),
      )
      await expect(service.getLiquidity()).rejects.toThrow(/code 401/)

      // Dropping the rejected balance bearer must not force the payment client
      // to re-authenticate: they are different Movii OAuth clients.
      primeAccessToken('payment-token')
      primeKeyLookup()
      primeSend('tx-100')
      primeReport('ACSC')
      await expect(service.sendPayment({ account: 'key', id: 'id-1', value: 10_000 }))
        .resolves.toEqual({ success: true, transactionId: 'tx-100' })

      const paymentTokenCalls = mockedAxios.post.mock.calls
        .filter(call => String(call[0]).includes('breb-auth.example.com'))
      expect(paymentTokenCalls).toHaveLength(1)
    })

    it('stops calling Movii for a cooldown once rate limited, then recovers', async () => {
      const { service } = setupService()
      primeAccessToken()
      mockedAxios.isAxiosError = jest.fn(() => true)
      mockedAxios.get.mockRejectedValueOnce(httpError('Request failed with status code 429', 429))

      await expect(service.getLiquidity()).rejects.toThrow(/status code 429/)
      expect(mockedAxios.get).toHaveBeenCalledTimes(1)

      // Inside the cooldown the request is skipped entirely — retrying a 429
      // only prolongs Movii's rate-limit window.
      await expect(service.getLiquidity()).rejects.toThrow(/rate limited/)
      expect(mockedAxios.get).toHaveBeenCalledTimes(1)

      jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 61_000)
      mockedAxios.get.mockResolvedValueOnce(balanceResponse({ balance: '900000' }))
      await expect(service.getLiquidity()).resolves.toBe(900000)
      jest.spyOn(Date, 'now').mockRestore()
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
      expect(logger.error).toHaveBeenCalledWith(
        '[BreB] Send response missing transaction id',
        expect.objectContaining({
          responseData: { rail: 'ENT' },
          responseRail: 'ENT',
        }),
      )
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
      expect(logger.warn).toHaveBeenCalledWith(
        '[BreB] Payment pending after timeout',
        expect.objectContaining({ transactionId: 'tx-005' }),
      )
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
      expect(logger.error).toHaveBeenCalledWith(
        '[BreB] Payment submission failed',
        expect.objectContaining({ account: '123', reason: 'boom' }),
      )
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

    it.each([
      ['U804', 'La llave y/o documento no existe o esta inactiva.'],
      ['SR08', 'Key format not supported'],
    ])('logs an unregistered key (%s) as a warning, not an error', async (code, message) => {
      const { logger, service } = setupService()
      mockedAxios.isAxiosError.mockReturnValue(true)

      primeAccessToken()
      mockedAxios.get.mockRejectedValueOnce(axiosFailure({ code, message }))

      const verified = await service.verifyAccount({ account: defaultKeyDetails.accountNumber })
      expect(verified).toBe(false)
      expect(logger.warn).toHaveBeenCalledWith(
        '[BreB] Failed to fetch key',
        expect.objectContaining({ responseCode: code }),
      )
      expect(logger.error).not.toHaveBeenCalled()
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

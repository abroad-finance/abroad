import 'reflect-metadata'
import axios, { AxiosRequestConfig } from 'axios'

import type { ISecretManager, Secret } from '../../../../platform/secrets/ISecretManager'

import { buildTransferoUltraSignedHeaders, TransferoUltraClient, TransferoUltraError } from '../../../../modules/transfero/infrastructure/TransferoUltraClient'
import { createMockLogger } from '../../../setup/mockFactories'

jest.mock('axios')

const mockedAxios = axios as jest.Mocked<typeof axios>

const createSecretManager = (
  overrides: Partial<Record<Secret, string>> = {},
): ISecretManager => {
  const secrets: Partial<Record<Secret, string>> = {
    TRANSFERO_ULTRA_API_SECRET: 'ultra-secret',
    TRANSFERO_ULTRA_BASE_URL: 'https://ultra.example',
    TRANSFERO_ULTRA_KEY_ID: 'key-123',
    ...overrides,
  }
  return {
    getSecret: jest.fn(async name => secrets[name] ?? ''),
    getSecrets: jest.fn(async names => Object.fromEntries(
      names.map(name => [name, secrets[name] ?? '']),
    ) as Record<(typeof names)[number], string>),
  }
}

const getRequestConfig = (): AxiosRequestConfig<string> => {
  const call = mockedAxios.request.mock.calls[0]
  if (!call) {
    throw new Error('Expected axios.request to have been called')
  }
  return call[0] as AxiosRequestConfig<string>
}

describe('buildTransferoUltraSignedHeaders', () => {
  it('matches the exact Ultra canonical message and hashed-secret HMAC contract', () => {
    const headers = buildTransferoUltraSignedHeaders({
      keyId: 'key-123',
      method: 'POST',
      nonce: '11111111-2222-4333-8444-555555555555',
      pathWithQuery: '/api/v1/pix/withdrawals?a=1&z=2',
      rawBody: '{"amount":10,"pixKey":"user@example.com"}',
      rawSecret: 'ultra-secret',
      timestamp: '2026-07-27T12:34:56.000Z',
    })

    expect(headers).toEqual({
      'Authorization': 'HMAC-SHA256 Credential=key-123, Signature=n44CqN906n9nEIxGTFfR+guuzt2L+0yKV7EpL1tbMU4=',
      'X-Nonce': '11111111-2222-4333-8444-555555555555',
      'X-Timestamp': '2026-07-27T12:34:56.000Z',
    })
  })
})

describe('TransferoUltraClient', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.useFakeTimers()
    jest.setSystemTime(new Date('2026-07-27T12:34:56.000Z'))
    mockedAxios.request.mockResolvedValue({ data: { ok: true } })
    mockedAxios.isAxiosError.mockReturnValue(false)
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('sorts GET query keys and signs the exact transmitted path', async () => {
    const client = new TransferoUltraClient(
      createSecretManager(),
      createMockLogger(),
    )

    await expect(client.get('/api/v1/otc/prices', {
      a: 1,
      omitted: undefined,
      side: 'SELL',
      z: 2,
    })).resolves.toEqual({ ok: true })

    const config = getRequestConfig()
    expect(config.url).toBe(
      'https://ultra.example/api/v1/otc/prices?a=1&side=SELL&z=2',
    )
    expect(config.method).toBe('GET')
    expect(config.data).toBeUndefined()
    expect(config.headers).not.toHaveProperty('Idempotency-Key')
    expect(config.headers).not.toHaveProperty('Content-Type')

    const headers = config.headers as Record<string, string>
    expect(headers['X-Timestamp']).toBe('2026-07-27T12:34:56.000Z')
    expect(headers['X-Nonce']).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    )
    expect(headers.Authorization).toBe(
      buildTransferoUltraSignedHeaders({
        keyId: 'key-123',
        method: 'GET',
        nonce: headers['X-Nonce'],
        pathWithQuery: '/api/v1/otc/prices?a=1&side=SELL&z=2',
        rawBody: '',
        rawSecret: 'ultra-secret',
        timestamp: headers['X-Timestamp'],
      }).Authorization,
    )
  })

  it('downloads only a bounded PDF receipt with the requested language', async () => {
    const client = new TransferoUltraClient(
      createSecretManager(),
      createMockLogger(),
    )
    const pdf = Buffer.from('%PDF-1.7 receipt')
    mockedAxios.request.mockResolvedValueOnce({
      data: pdf,
      headers: { 'content-type': 'application/pdf; charset=binary' },
    })

    await expect(client.getPdf(
      '/api/v1/pix/withdrawals/11111111-1111-4111-8111-111111111111/receipt',
      { lang: 'pt-BR' },
    )).resolves.toEqual({ contentType: 'application/pdf', data: pdf })

    expect(getRequestConfig()).toMatchObject({
      headers: { Accept: 'application/pdf' },
      maxBodyLength: 2 * 1024 * 1024,
      maxContentLength: 2 * 1024 * 1024,
      method: 'GET',
      responseType: 'arraybuffer',
      url: 'https://ultra.example/api/v1/pix/withdrawals/11111111-1111-4111-8111-111111111111/receipt?lang=pt-BR',
    })
  })

  it('rejects empty, oversized, non-binary, or non-PDF receipt responses', async () => {
    const client = new TransferoUltraClient(
      createSecretManager(),
      createMockLogger(),
    )

    mockedAxios.request.mockResolvedValueOnce({
      data: Buffer.from('not a pdf'),
      headers: { 'content-type': 'application/json' },
    })
    await expect(client.getPdf('/receipt')).rejects.toMatchObject({
      code: 'permanent',
      message: 'Transfero Ultra receipt response was not a PDF',
    })

    mockedAxios.request.mockResolvedValueOnce({
      data: Buffer.alloc(0),
      headers: { 'content-type': 'application/pdf' },
    })
    await expect(client.getPdf('/receipt')).rejects.toMatchObject({
      message: 'Transfero Ultra receipt response size is invalid',
    })

    mockedAxios.request.mockResolvedValueOnce({
      data: Buffer.alloc(2 * 1024 * 1024 + 1),
      headers: { 'content-type': 'application/pdf' },
    })
    await expect(client.getPdf('/receipt')).rejects.toMatchObject({
      message: 'Transfero Ultra receipt response size is invalid',
    })

    mockedAxios.request.mockResolvedValueOnce({
      data: 'not binary',
      headers: { 'content-type': 'application/pdf' },
    })
    await expect(client.getPdf('/receipt')).rejects.toMatchObject({
      message: 'Transfero Ultra receipt response was not binary',
    })
  })

  it('transmits the exact signed JSON body and requires idempotency for POST', async () => {
    const client = new TransferoUltraClient(
      createSecretManager(),
      createMockLogger(),
    )
    const body = {
      amount: 10,
      idempotencyKey: 'abroad:withdrawal:1',
      pixKey: 'user@example.com',
    }

    await client.post(
      '/api/v1/pix/withdrawals',
      body,
      'abroad:withdrawal:1',
    )

    const config = getRequestConfig()
    expect(config.data).toBe(JSON.stringify(body))
    expect(config.headers).toMatchObject({
      'Content-Type': 'application/json',
      'Idempotency-Key': 'abroad:withdrawal:1',
    })
    expect(config.transformRequest).toHaveLength(1)

    jest.clearAllMocks()
    await expect(client.post(
      '/api/v1/pix/withdrawals',
      body,
      '',
    )).rejects.toMatchObject({
      code: 'validation',
      message: 'A 1-255 character Idempotency-Key is required for Transfero Ultra POST requests',
    })
    await expect(client.post(
      '/api/v1/pix/withdrawals',
      body,
      'x'.repeat(256),
    )).rejects.toMatchObject({
      code: 'validation',
    })
    expect(mockedAxios.request).not.toHaveBeenCalled()
  })

  it('suppresses Axios form encoding for bodyless state-changing requests', async () => {
    const client = new TransferoUltraClient(
      createSecretManager(),
      createMockLogger(),
    )

    await client.post(
      '/api/v1/otc/trades/trade-123/settle-from-holdings',
      undefined,
      'abroad:otc:operation:settlement',
    )

    const config = getRequestConfig()
    expect(config.data).toBeUndefined()
    expect(config.headers).toMatchObject({
      'Content-Type': null,
      'Idempotency-Key': 'abroad:otc:operation:settlement',
    })
  })

  it('classifies rate limits and server failures as retriable without leaking credentials', async () => {
    const logger = createMockLogger()
    const client = new TransferoUltraClient(createSecretManager(), logger)
    mockedAxios.isAxiosError.mockReturnValue(true)
    mockedAxios.request.mockRejectedValue({
      response: {
        data: {
          error: {
            code: 'RATE_LIMIT',
            message: 'Slow down',
          },
        },
        status: 429,
      },
    })

    await expect(client.get('/api/v1/balance')).rejects.toEqual(
      new TransferoUltraError({
        code: 'retriable',
        message: 'Transfero Ultra request failed: RATE_LIMIT',
        providerCode: 'RATE_LIMIT',
        status: 429,
      }),
    )
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Transfero Ultra request failed'),
      {
        code: 'retriable',
        cooldownBucket: 'GET /api/v1/balance',
        cooldownMs: 60_000,
        interactive: false,
        method: 'GET',
        path: '/api/v1/balance',
        providerCode: 'RATE_LIMIT',
        status: 429,
      },
    )
  })

  it('rejects non-origin or non-HTTPS base URLs before issuing a request', async () => {
    const client = new TransferoUltraClient(
      createSecretManager({
        TRANSFERO_ULTRA_BASE_URL: 'http://ultra.example',
      }),
      createMockLogger(),
    )

    await expect(client.get('/api/v1/balance')).rejects.toMatchObject({
      code: 'validation',
      message: expect.stringContaining('must be an HTTPS origin'),
    })
    expect(mockedAxios.request).not.toHaveBeenCalled()

    const pathClient = new TransferoUltraClient(
      createSecretManager({
        TRANSFERO_ULTRA_BASE_URL: 'https://ultra.example/api',
      }),
      createMockLogger(),
    )
    await expect(pathClient.get('/api/v1/balance')).rejects.toMatchObject({
      code: 'validation',
      message: expect.stringContaining('HTTPS origin'),
    })
    expect(mockedAxios.request).not.toHaveBeenCalled()
  })

  it('suppresses repeat calls to a rate-limited endpoint without blocking other endpoints', async () => {
    const client = new TransferoUltraClient(
      createSecretManager(),
      createMockLogger(),
    )
    const rateLimited = Object.assign(new Error('rate limited'), {
      isAxiosError: true,
      response: { data: { code: 'RATE_LIMIT_EXCEEDED' }, status: 429 },
    })
    mockedAxios.isAxiosError.mockReturnValue(true)
    mockedAxios.request.mockRejectedValueOnce(rateLimited)

    await expect(client.get('/api/v1/otc/trades/bcb1de20-febb-43e8-9958-fb1b5edff65a/detail'))
      .rejects.toMatchObject({ providerCode: 'RATE_LIMIT_EXCEEDED', status: 429 })
    expect(mockedAxios.request).toHaveBeenCalledTimes(1)

    // A different trade id shares the bucket, so the other doomed polls in the
    // same sweep never reach the wire.
    await expect(client.get('/api/v1/otc/trades/80d350a3-55f6-4957-9aa3-24bc0a8ce8d2/detail'))
      .rejects.toMatchObject({ providerCode: 'RATE_LIMIT_COOLDOWN' })
    expect(mockedAxios.request).toHaveBeenCalledTimes(1)

    // A customer payout is a different bucket and must still go out — the whole
    // point of scoping the cooldown per endpoint.
    mockedAxios.request.mockResolvedValueOnce({ data: { id: 'w-1' } })
    await expect(client.post('/api/v1/pix/withdrawals', { amount: 10 }, 'idem-1')).resolves.toEqual({ id: 'w-1' })
    expect(mockedAxios.request).toHaveBeenCalledTimes(2)

    // Cooldown expires and polling resumes.
    jest.setSystemTime(new Date('2026-07-27T12:36:56.000Z'))
    mockedAxios.request.mockResolvedValueOnce({ data: { settled: true } })
    await expect(client.get('/api/v1/otc/trades/bcb1de20-febb-43e8-9958-fb1b5edff65a/detail'))
      .resolves.toEqual({ settled: true })
    expect(mockedAxios.request).toHaveBeenCalledTimes(3)
  })

  it('lets an interactive request through a cooldown a background loop tripped', async () => {
    const client = new TransferoUltraClient(
      createSecretManager(),
      createMockLogger(),
    )
    mockedAxios.isAxiosError.mockReturnValue(true)
    mockedAxios.request.mockRejectedValueOnce(Object.assign(new Error('rate limited'), {
      isAxiosError: true,
      response: { data: { code: 'RATE_LIMIT_EXCEEDED' }, status: 429 },
    }))

    await expect(client.post('/api/v1/pix/brcode-previews', { brcode: 'a' }, 'idem-a'))
      .rejects.toMatchObject({ providerCode: 'RATE_LIMIT_EXCEEDED' })

    // Background work waits its turn.
    await expect(client.post('/api/v1/pix/brcode-previews', { brcode: 'b' }, 'idem-b'))
      .rejects.toMatchObject({ providerCode: 'RATE_LIMIT_COOLDOWN' })
    expect(mockedAxios.request).toHaveBeenCalledTimes(1)

    // A customer scanning a QR code does not: Ultra's account-wide quota
    // refills in seconds, so refusing locally would fail a scan that works.
    mockedAxios.request.mockResolvedValueOnce({ data: { pixKey: 'k' } })
    await expect(client.post(
      '/api/v1/pix/brcode-previews',
      { brcode: 'c' },
      'idem-c',
      { interactive: true },
    )).resolves.toEqual({ pixKey: 'k' })
    expect(mockedAxios.request).toHaveBeenCalledTimes(2)
  })

  it('honours Retry-After instead of parking the bucket for a fixed minute', async () => {
    const logger = createMockLogger()
    const client = new TransferoUltraClient(createSecretManager(), logger)
    mockedAxios.isAxiosError.mockReturnValue(true)
    mockedAxios.request.mockRejectedValueOnce(Object.assign(new Error('rate limited'), {
      isAxiosError: true,
      response: {
        data: { code: 'RATE_LIMIT_EXCEEDED' },
        headers: { 'retry-after': '2' },
        status: 429,
      },
    }))

    await expect(client.get('/api/v1/balance')).rejects.toMatchObject({
      retryAfterSeconds: 2,
      status: 429,
    })
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Transfero Ultra request failed'),
      expect.objectContaining({ cooldownMs: 2_000 }),
    )

    // Still gated inside the provider's own window...
    await expect(client.get('/api/v1/balance')).rejects.toMatchObject({
      providerCode: 'RATE_LIMIT_COOLDOWN',
    })
    expect(mockedAxios.request).toHaveBeenCalledTimes(1)

    // ...and free again 3s later, where the old fixed cooldown still had 57s
    // of blanket failures to serve.
    jest.setSystemTime(new Date('2026-07-27T12:34:59.000Z'))
    mockedAxios.request.mockResolvedValueOnce({ data: { balance: 1 } })
    await expect(client.get('/api/v1/balance')).resolves.toEqual({ balance: 1 })
    expect(mockedAxios.request).toHaveBeenCalledTimes(2)
  })

  it('rejects non-serializable bodies and empty credentials before transport', async () => {
    const client = new TransferoUltraClient(
      createSecretManager(),
      createMockLogger(),
    )
    const circular: Record<string, unknown> = {}
    circular.self = circular

    await expect(client.post('/api/v1/pix/withdrawals', circular, 'key')).rejects
      .toMatchObject({
        code: 'validation',
        message: 'Transfero Ultra request body is not JSON serializable',
      })

    const unconfigured = new TransferoUltraClient(
      createSecretManager({ TRANSFERO_ULTRA_KEY_ID: '' }),
      createMockLogger(),
    )
    await expect(unconfigured.get('/api/v1/balance')).rejects.toMatchObject({
      code: 'validation',
      message: 'Transfero Ultra API credentials are not configured',
    })
    expect(mockedAxios.request).not.toHaveBeenCalled()
  })
})

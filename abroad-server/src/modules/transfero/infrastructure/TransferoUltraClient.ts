import axios, { AxiosRequestConfig, AxiosResponse } from 'axios'
import { inject, injectable } from 'inversify'
import { createHash, createHmac, randomUUID } from 'node:crypto'

import { TYPES } from '../../../app/container/types'
import { createScopedLogger, ScopedLogger } from '../../../core/logging/scopedLogger'
import { ILogger } from '../../../core/logging/types'
import { ISecretManager, Secrets } from '../../../platform/secrets/ISecretManager'

type TransferoUltraErrorPayload = {
  code?: string
}
type TransferoUltraFailureCode = 'permanent' | 'retriable' | 'validation'
type TransferoUltraHttpMethod = 'GET' | 'PATCH' | 'POST'

const MAX_TRANSFERO_ULTRA_PDF_BYTES = 2 * 1024 * 1024

export type TransferoUltraPdfResponse = {
  contentType: 'application/pdf'
  data: Buffer
}

type TransferoUltraQuery = Readonly<Record<string, boolean | number | string | undefined>>

type TransferoUltraSignatureInput = {
  keyId: string
  method: TransferoUltraHttpMethod
  nonce: string
  pathWithQuery: string
  rawBody: string
  rawSecret: string
  timestamp: string
}

type TransferoUltraSignedHeaders = {
  'Authorization': string
  'X-Nonce': string
  'X-Timestamp': string
}

export class TransferoUltraError extends Error {
  public readonly code: TransferoUltraFailureCode
  public readonly providerCode?: string
  public readonly status?: number

  public constructor(params: {
    code: TransferoUltraFailureCode
    message: string
    providerCode?: string
    status?: number
  }) {
    super(params.message)
    this.name = 'TransferoUltraError'
    this.code = params.code
    this.providerCode = params.providerCode
    this.status = params.status
  }
}

export function buildTransferoUltraSignedHeaders(
  input: TransferoUltraSignatureInput,
): TransferoUltraSignedHeaders {
  const bodyHash = createHash('sha256').update(input.rawBody).digest('hex')
  const signingKey = createHash('sha256').update(input.rawSecret).digest('hex')
  const canonicalMessage = [
    input.method,
    input.pathWithQuery,
    input.timestamp,
    input.nonce,
    bodyHash,
  ].join('\n')
  const signature = createHmac('sha256', signingKey)
    .update(canonicalMessage)
    .digest('base64')

  return {
    'Authorization': `HMAC-SHA256 Credential=${input.keyId}, Signature=${signature}`,
    'X-Nonce': input.nonce,
    'X-Timestamp': input.timestamp,
  }
}

@injectable()
export class TransferoUltraClient {
  private readonly logger: ScopedLogger
  private readonly requestTimeoutMs: number

  public constructor(
    @inject(TYPES.ISecretManager) private readonly secretManager: ISecretManager,
    @inject(TYPES.ILogger) baseLogger: ILogger,
  ) {
    this.logger = createScopedLogger(baseLogger, { scope: 'TransferoUltraClient' })
    this.requestTimeoutMs = this.readPositiveInteger(
      'TRANSFERO_ULTRA_REQUEST_TIMEOUT_MS',
      8_000,
    )
  }

  public async get(path: string, query: TransferoUltraQuery = {}): Promise<unknown> {
    return (await this.request<unknown>({ method: 'GET', path, query })).data
  }

  public async getPdf(
    path: string,
    query: TransferoUltraQuery = {},
  ): Promise<TransferoUltraPdfResponse> {
    const response = await this.request<ArrayBuffer | Buffer>(
      { method: 'GET', path, query },
      {
        accept: 'application/pdf',
        maxContentLength: MAX_TRANSFERO_ULTRA_PDF_BYTES,
        responseType: 'arraybuffer',
      },
    )
    const contentType = this.normalizeContentType(response.headers['content-type'])
    if (contentType !== 'application/pdf') {
      throw new TransferoUltraError({
        code: 'permanent',
        message: 'Transfero Ultra receipt response was not a PDF',
      })
    }
    const data = this.toBuffer(response.data)
    if (data.length === 0 || data.length > MAX_TRANSFERO_ULTRA_PDF_BYTES) {
      throw new TransferoUltraError({
        code: 'permanent',
        message: 'Transfero Ultra receipt response size is invalid',
      })
    }
    return { contentType, data }
  }

  public async patch(
    path: string,
    body: unknown,
    idempotencyKey: string,
  ): Promise<unknown> {
    return (await this.request<unknown>({ body, idempotencyKey, method: 'PATCH', path })).data
  }

  public async post(
    path: string,
    body: unknown,
    idempotencyKey: string,
  ): Promise<unknown> {
    return (await this.request<unknown>({ body, idempotencyKey, method: 'POST', path })).data
  }

  private buildPathWithQuery(path: string, query: TransferoUltraQuery): string {
    if (!path.startsWith('/') || path.includes('?') || path.includes('#')) {
      throw new TransferoUltraError({
        code: 'validation',
        message: 'Transfero Ultra request path must be an absolute path without a query or fragment',
      })
    }

    const search = new URLSearchParams()
    Object.entries(query)
      .sort(([left], [right]) => left.localeCompare(right))
      .forEach(([key, value]) => {
        if (value !== undefined) {
          search.append(key, String(value))
        }
      })
    const queryString = search.toString()
    return queryString ? `${path}?${queryString}` : path
  }

  private classifyStatus(status: number | undefined): TransferoUltraFailureCode {
    if (status === undefined || status === 408 || status === 425 || status === 429 || status >= 500) {
      return 'retriable'
    }
    if (status === 400 || status === 404 || status === 409 || status === 422) {
      return 'validation'
    }
    return 'permanent'
  }

  private describeAxiosError(error: unknown): TransferoUltraError {
    if (!axios.isAxiosError(error)) {
      const message = error instanceof Error ? error.message : 'Unknown Transfero Ultra client error'
      return new TransferoUltraError({ code: 'retriable', message })
    }

    const status = error.response?.status
    const payload = this.readErrorPayload(error.response?.data)
    const providerCode = payload.code
    const descriptor = providerCode ?? (status ? `HTTP_${status}` : 'NETWORK_ERROR')

    return new TransferoUltraError({
      code: this.classifyStatus(status),
      message: `Transfero Ultra request failed: ${descriptor}`,
      providerCode,
      status,
    })
  }

  private normalizeBaseUrl(rawBaseUrl: string): string {
    let parsed: URL
    try {
      parsed = new URL(rawBaseUrl)
    }
    catch {
      throw new TransferoUltraError({
        code: 'validation',
        message: 'TRANSFERO_ULTRA_BASE_URL is not a valid URL',
      })
    }

    if (
      parsed.protocol !== 'https:'
      || parsed.username
      || parsed.password
      || parsed.pathname !== '/'
      || parsed.search
      || parsed.hash
    ) {
      throw new TransferoUltraError({
        code: 'validation',
        message: 'TRANSFERO_ULTRA_BASE_URL must be an HTTPS origin without credentials, path, query, or fragment',
      })
    }

    return parsed.origin
  }

  private normalizeContentType(value: unknown): string {
    if (typeof value !== 'string') {
      return ''
    }
    return value.split(';', 1)[0]?.trim().toLowerCase() ?? ''
  }

  private readErrorPayload(value: unknown): TransferoUltraErrorPayload {
    if (!value || typeof value !== 'object') {
      return {}
    }

    const record = value as Record<string, unknown>
    const nested = record.error && typeof record.error === 'object'
      ? record.error as Record<string, unknown>
      : record

    return { code: typeof nested.code === 'string' ? nested.code : undefined }
  }

  private readPositiveInteger(envKey: string, fallback: number): number {
    const parsed = Number(process.env[envKey])
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback
  }

  private async request<T>(params: {
    body?: unknown
    idempotencyKey?: string
    method: TransferoUltraHttpMethod
    path: string
    query?: TransferoUltraQuery
  }, responseOptions: {
    accept?: string
    maxContentLength?: number
    responseType?: AxiosRequestConfig['responseType']
  } = {}): Promise<AxiosResponse<T>> {
    const isStateChanging = params.method !== 'GET'
    if (
      isStateChanging
      && (
        !params.idempotencyKey
        || params.idempotencyKey.length > 255
      )
    ) {
      throw new TransferoUltraError({
        code: 'validation',
        message: `A 1-255 character Idempotency-Key is required for Transfero Ultra ${params.method} requests`,
      })
    }

    const pathWithQuery = this.buildPathWithQuery(params.path, params.query ?? {})
    const rawBody = this.serializeBody(params.body)

    const {
      TRANSFERO_ULTRA_API_SECRET: rawSecret,
      TRANSFERO_ULTRA_BASE_URL: rawBaseUrl,
      TRANSFERO_ULTRA_KEY_ID: keyId,
    } = await this.secretManager.getSecrets([
      Secrets.TRANSFERO_ULTRA_API_SECRET,
      Secrets.TRANSFERO_ULTRA_BASE_URL,
      Secrets.TRANSFERO_ULTRA_KEY_ID,
    ])
    if (!keyId.trim() || rawSecret.length === 0) {
      throw new TransferoUltraError({
        code: 'validation',
        message: 'Transfero Ultra API credentials are not configured',
      })
    }
    const baseUrl = this.normalizeBaseUrl(rawBaseUrl)
    const timestamp = new Date().toISOString()
    const nonce = randomUUID()
    const signedHeaders = buildTransferoUltraSignedHeaders({
      keyId,
      method: params.method,
      nonce,
      pathWithQuery,
      rawBody,
      rawSecret,
      timestamp,
    })

    const requestConfig: AxiosRequestConfig<string> = {
      data: rawBody || undefined,
      headers: {
        ...signedHeaders,
        Accept: responseOptions.accept ?? 'application/json',
        ...(isStateChanging ? { 'Idempotency-Key': params.idempotencyKey } : {}),
        // Axios otherwise injects application/x-www-form-urlencoded for
        // bodyless POST/PATCH requests. Ultra's bodyless endpoints reject that
        // media type; null keeps the header out of the transmitted request.
        ...(params.body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(isStateChanging && params.body === undefined
          ? { 'Content-Type': null }
          : {}),
      },
      maxBodyLength: responseOptions.maxContentLength,
      maxContentLength: responseOptions.maxContentLength,
      method: params.method,
      responseType: responseOptions.responseType,
      timeout: this.requestTimeoutMs,
      transformRequest: [value => value],
      url: `${baseUrl}${pathWithQuery}`,
    }

    try {
      return await axios.request<T>(requestConfig)
    }
    catch (error) {
      const normalized = this.describeAxiosError(error)
      this.logger.warn('Transfero Ultra request failed', {
        code: normalized.code,
        method: params.method,
        path: params.path,
        providerCode: normalized.providerCode,
        status: normalized.status,
      })
      throw normalized
    }
  }

  private serializeBody(body: unknown): string {
    if (body === undefined) {
      return ''
    }

    try {
      const serialized = JSON.stringify(body)
      if (serialized === undefined) {
        throw new Error('JSON.stringify returned undefined')
      }
      return serialized
    }
    catch {
      throw new TransferoUltraError({
        code: 'validation',
        message: 'Transfero Ultra request body is not JSON serializable',
      })
    }
  }

  private toBuffer(value: unknown): Buffer {
    if (Buffer.isBuffer(value)) {
      return Buffer.from(value)
    }
    if (value instanceof ArrayBuffer) {
      return Buffer.from(value)
    }
    if (ArrayBuffer.isView(value)) {
      return Buffer.from(value.buffer, value.byteOffset, value.byteLength)
    }
    throw new TransferoUltraError({
      code: 'permanent',
      message: 'Transfero Ultra receipt response was not binary',
    })
  }
}

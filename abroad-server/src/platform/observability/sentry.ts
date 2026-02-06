import type { Express } from 'express'

import { getCorrelationId } from '../../core/requestContext'

const REDACTED = '[REDACTED]' as const

type RedactionOptions = {
  maxDepth: number
  maxStringLength: number
}

type SentryInitParams = {
  serviceName: string
}

type SentryInitResult = {
  enabled: boolean
}

const DEFAULT_REDACTION: RedactionOptions = {
  maxDepth: 6,
  maxStringLength: 4_096,
}

// Normalize keys like "account_number" -> "accountnumber" for matching.
const normalizeKey = (key: string): string => key.toLowerCase().replace(/[^a-z0-9]/g, '')

const SENSITIVE_KEYS = new Set<string>([
  'authorization',
  'cookie',
  'setcookie',
  'xapikey',
  'xopsapikey',
  'token',
  'jwttoken',
  'signature',
  'signedxdr',
  'privatekey',
  'secret',
  'clientsecret',
  'password',
  'taxid',
  'documentnumber',
  'accountnumber',
  'qrCode',
].map(normalizeKey))

const truncateString = (value: string, max: number): string => {
  if (value.length <= max) return value
  return `${value.slice(0, Math.max(0, max - 12))}...[truncated]`
}

const isPlainObject = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
)

const redactValue = (value: unknown, options: RedactionOptions, depth = 0): unknown => {
  if (depth >= options.maxDepth) {
    return '[MaxDepth]'
  }

  if (typeof value === 'string') {
    return truncateString(value, options.maxStringLength)
  }

  if (Array.isArray(value)) {
    return value.map(item => redactValue(item, options, depth + 1))
  }

  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {}
    Object.entries(value).forEach(([k, v]) => {
      const normalized = normalizeKey(k)
      if (SENSITIVE_KEYS.has(normalized)) {
        out[k] = REDACTED
        return
      }
      out[k] = redactValue(v, options, depth + 1)
    })
    return out
  }

  return value
}

const sanitizeHeaders = (headers: unknown): unknown => {
  if (!isPlainObject(headers)) return headers
  return redactValue(headers, { ...DEFAULT_REDACTION, maxDepth: 2 })
}

const sanitizeRequest = (request: unknown): unknown => {
  if (!isPlainObject(request)) return request
  const result: Record<string, unknown> = { ...request }
  if ('headers' in result) {
    result.headers = sanitizeHeaders(result.headers)
  }
  if ('cookies' in result) {
    result.cookies = REDACTED
  }
  if ('data' in result) {
    result.data = redactValue(result.data, DEFAULT_REDACTION)
  }
  return result
}

let cachedInit: null | SentryInitResult = null
type SentryModule = typeof import('@sentry/node')

let cachedSentryModule: null | SentryModule | undefined

const loadSentry = (): null | SentryModule => {
  if (process.env.NODE_ENV === 'test') {
    return null
  }

  if (cachedSentryModule !== undefined) {
    return cachedSentryModule
  }

  try {
    // Lazy-load to avoid Jest runtime incompatibilities when Sentry is not enabled.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('@sentry/node') as unknown
    cachedSentryModule = mod as SentryModule
    return cachedSentryModule
  }
  catch {
    cachedSentryModule = null
    return null
  }
}

const readEnv = (key: string): string | undefined => {
  const raw = process.env[key]
  const trimmed = raw?.trim()
  return trimmed ? trimmed : undefined
}

export function captureException(error: unknown, context?: { extra?: Record<string, unknown>, tags?: Record<string, string> }): void {
  const Sentry = loadSentry()
  if (!Sentry?.isEnabled()) return
  if (!context) {
    Sentry.captureException(error)
    return
  }

  Sentry.withScope((scope) => {
    if (context.tags) {
      scope.setTags(context.tags)
    }
    if (context.extra) {
      scope.setExtras(context.extra)
    }
    Sentry.captureException(error)
  })
}

export function initSentry(params: SentryInitParams): SentryInitResult {
  if (cachedInit) {
    return cachedInit
  }

  if (process.env.NODE_ENV === 'test') {
    cachedInit = { enabled: false }
    return cachedInit
  }

  const dsn = readEnv('SENTRY_DSN')
  if (!dsn) {
    cachedInit = { enabled: false }
    return cachedInit
  }

  const Sentry = loadSentry()
  if (!Sentry) {
    cachedInit = { enabled: false }
    return cachedInit
  }

  const environment = readEnv('SENTRY_ENVIRONMENT') ?? readEnv('NODE_ENV') ?? 'development'
  const release = readEnv('SENTRY_RELEASE')

  Sentry.init({
    beforeSend: (event) => {
      const correlationId = getCorrelationId()
      if (correlationId) {
        event.tags = { ...(event.tags ?? {}), correlationId }
      }

      if (event.request) {
        event.request = sanitizeRequest(event.request) as typeof event.request
      }

      if (event.extra) {
        event.extra = redactValue(event.extra, DEFAULT_REDACTION) as typeof event.extra
      }

      return event
    },
    dsn,
    environment,
    initialScope: {
      tags: {
        service: params.serviceName,
      },
    },
    release,
    sendDefaultPii: false,
  })

  cachedInit = { enabled: true }
  return cachedInit
}

export function setupSentryExpressErrorHandler(app: Express): void {
  const Sentry = loadSentry()
  if (!Sentry?.isEnabled()) return
  Sentry.setupExpressErrorHandler(app)
}

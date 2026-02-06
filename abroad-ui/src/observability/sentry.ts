import * as Sentry from '@sentry/react'

const REDACTED = '[REDACTED]' as const

type RedactionOptions = {
  maxDepth: number
  maxStringLength: number
}

const DEFAULT_REDACTION: RedactionOptions = {
  maxDepth: 6,
  maxStringLength: 4_096,
}

const normalizeKey = (key: string): string => key.toLowerCase().replace(/[^a-z0-9]/g, '')

const SENSITIVE_KEYS = new Set<string>([
  'authorization',
  'cookie',
  'setcookie',
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
  'qrcode',
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

const readEnv = (key: string): string | undefined => {
  const value = (import.meta.env[key] as string | undefined) ?? undefined
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

const dsn = readEnv('VITE_SENTRY_DSN')
const environment = readEnv('VITE_SENTRY_ENVIRONMENT') ?? import.meta.env.MODE ?? 'development'
const release = readEnv('VITE_SENTRY_RELEASE')

export const sentryEnabled = Boolean(dsn) && import.meta.env.MODE !== 'test'

if (sentryEnabled && dsn) {
  Sentry.init({
    beforeSend: (event) => {
      if (event.request) {
        event.request = redactValue(event.request, { ...DEFAULT_REDACTION, maxDepth: 3 }) as typeof event.request
      }

      if (event.extra) {
        event.extra = redactValue(event.extra, DEFAULT_REDACTION) as typeof event.extra
      }

      return event
    },
    dsn,
    environment,
    release,
    sendDefaultPii: false,
  })
}

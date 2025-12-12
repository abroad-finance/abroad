import { ILogger } from '../interfaces'

export interface ScopedLogger extends ILogger {
  child: (additional: Partial<LoggingContext>) => ScopedLogger
}

type LoggingContext = {
  correlationId?: string
  scope: string
  // Additional metadata that should ride along with every log entry
  staticPayload?: Record<string, unknown>
}

export function createScopedLogger(base: ILogger, context: LoggingContext): ScopedLogger {
  const normalizedScope = context.scope.trim()
  const scopePrefix = normalizedScope.length > 0 ? `[${normalizedScope}]` : ''

  const withContext = (message: string, params: unknown[]): [string, ...unknown[]] => {
    const scopedMessage = scopePrefix ? `${scopePrefix} ${message}` : message
    const payload = buildContextPayload(context)
    return payload ? [scopedMessage, payload, ...params] : [scopedMessage, ...params]
  }

  const scoped: ScopedLogger = {
    child: (additional: Partial<LoggingContext>) =>
      createScopedLogger(base, {
        correlationId: additional.correlationId ?? context.correlationId,
        scope: additional.scope ?? context.scope,
        staticPayload: { ...context.staticPayload, ...additional.staticPayload },
      }),
    error: (message: string, ...optionalParams: unknown[]) =>
      base.error(...withContext(message, optionalParams)),
    info: (message: string, ...optionalParams: unknown[]) =>
      base.info(...withContext(message, optionalParams)),
    warn: (message: string, ...optionalParams: unknown[]) =>
      base.warn(...withContext(message, optionalParams)),
  }

  return scoped
}

function buildContextPayload(
  context: LoggingContext,
): Record<string, unknown> | undefined {
  const payload: Record<string, unknown> = {}
  if (context.correlationId) {
    payload.correlationId = context.correlationId
  }
  if (context.staticPayload && Object.keys(context.staticPayload).length > 0) {
    payload.context = context.staticPayload
  }

  return Object.keys(payload).length > 0 ? payload : undefined
}

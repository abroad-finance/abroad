// src/services/consoleLogger.ts
import { injectable } from 'inversify'

import { ILogger } from '../interfaces'
import { getCorrelationId } from '../shared/requestContext'

// Tiny helper to safely stringify (handles Errors & circular refs)
const safeStringify = (obj: unknown) => {
  const seen = new WeakSet()
  return JSON.stringify(
    obj,
    (key, value) => {
      if (value instanceof Error) {
        return {
          message: value.message,
          name: value.name,
          // keep stack but as literal "\n" so the log is still one line
          stack: value.stack,
        }
      }
      if (typeof value === 'object' && value !== null) {
        if (seen.has(value)) return '[Circular]'
        seen.add(value)
      }
      return value
    },
  )
}

type LogEntry = {
  correlationId?: string
  message: unknown
  params?: unknown[]
  severity: Sev
  timestamp: string
}

type Sev = 'CRITICAL' | 'DEBUG' | 'ERROR' | 'INFO' | 'WARNING'

@injectable()
export class ConsoleLogger implements ILogger {
  error(message: string, ...optionalParams: unknown[]): void {
    log('ERROR', message, optionalParams)
  }

  info(message: string, ...optionalParams: unknown[]): void {
    log('INFO', message, optionalParams)
  }

  warn(message: string, ...optionalParams: unknown[]): void {
    log('WARNING', message, optionalParams)
  }
}

function log(severity: Sev, message: unknown, params: unknown[]) {
  // Build a structured log entry. One JSON object == one log line.
  const entry: LogEntry = {
    correlationId: getCorrelationId(),
    message, // Cloud Logging shows this as the main text
    params: params.length ? params : undefined,
    severity, // Cloud Logging reads this
    timestamp: new Date().toISOString(),
  }

  const line = safeStringify(entry) // serializes newlines as "\n"
  if (severity === 'ERROR' || severity === 'CRITICAL') {
    console.error(line) // stderr also marks high severity
  }
  else if (severity === 'WARNING') {
    console.warn(line)
  }
  else {
    console.log(line)
  }
}

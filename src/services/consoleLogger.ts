// src/services/consoleLogger.ts
import { ILogger } from '../interfaces'

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

type Sev = 'CRITICAL' | 'DEBUG' | 'ERROR' | 'INFO' | 'WARNING'

export class ConsoleLogger implements ILogger {
  error(...message: unknown[]): void {
    log('ERROR', message)
  }

  info(...message: unknown[]): void {
    log('INFO', message)
  }

  warn(...message: unknown[]): void {
    log('WARNING', message)
  }
}

function log(severity: Sev, message: unknown) {
  // Build a structured log entry. One JSON object == one log line.
  const entry = {
    message, // Cloud Logging shows this as the main text
    severity, // Cloud Logging reads this
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

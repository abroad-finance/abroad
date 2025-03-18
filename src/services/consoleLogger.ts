// src/services/consoleLogger.ts
import { ILogger } from '../interfaces'

export class ConsoleLogger implements ILogger {
  error(message: string, ...optionalParams: unknown[]): void {
    console.log('ERROR:', message, ...optionalParams)
  }

  info(message: string, ...optionalParams: unknown[]): void {
    console.log('INFO:', message, ...optionalParams)
  }

  warn(message: string, ...optionalParams: unknown[]): void {
    console.log('WARN:', message, ...optionalParams)
  }
}

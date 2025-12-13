export interface ILogger {
  error(message: string, ...optionalParams: unknown[]): void
  info(message: string, ...optionalParams: unknown[]): void
  warn(message: string, ...optionalParams: unknown[]): void
}

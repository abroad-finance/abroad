import { AsyncLocalStorage } from 'async_hooks'
import crypto from 'crypto'
import { NextFunction, Request, Response } from 'express'

type ContextState = {
  correlationId: string
}

const store = new AsyncLocalStorage<ContextState>()

export const getCorrelationId = (): string | undefined => store.getStore()?.correlationId

export const generateCorrelationId = (seed?: string): string => {
  if (seed && seed.trim().length > 0) return seed.trim()
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  const random = Math.random().toString(16).slice(2, 10)
  return `corr-${Date.now()}-${random}`
}

export function runWithCorrelationId<T>(
  correlationId: string,
  fn: () => Promise<T>,
): Promise<T>
export function runWithCorrelationId<T>(
  correlationId: string,
  fn: () => T,
): T
export function runWithCorrelationId<T>(
  correlationId: string,
  fn: () => Promise<T> | T,
): Promise<T> | T {
  return store.run({ correlationId }, fn)
}

export const requestContextMiddleware = (
  req: Request,
  _res: Response,
  next: NextFunction,
): void => {
  const headerValue = typeof req.header === 'function' ? req.header('x-correlation-id') : undefined
  const correlationId = generateCorrelationId(
    Array.isArray(headerValue) ? headerValue[0] : headerValue,
  )

  runWithCorrelationId(correlationId, () => next())
}

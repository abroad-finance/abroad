import { getCorrelationId } from '../requestContext'

export class ApplicationError extends Error {
  public readonly code: string
  public readonly details?: unknown
  public readonly statusCode: number

  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message)
    this.name = 'ApplicationError'
    this.statusCode = statusCode
    this.code = code
    this.details = details
  }
}

export class InfrastructureError extends ApplicationError {
  constructor(message: string, details?: unknown, statusCode = 502) {
    super(statusCode, 'infrastructure_error', message, details)
    this.name = 'InfrastructureError'
  }
}

export class NotFoundError extends ApplicationError {
  constructor(message: string, details?: unknown) {
    super(404, 'not_found', message, details)
    this.name = 'NotFoundError'
  }
}

export class RetriableError extends ApplicationError {
  constructor(message: string, details?: unknown, statusCode = 503) {
    super(statusCode, 'retriable_error', message, details)
    this.name = 'RetriableError'
  }
}

export class UserError extends ApplicationError {
  constructor(message: string, details?: unknown, statusCode = 400) {
    super(statusCode, 'user_error', message, details)
    this.name = 'UserError'
  }
}

export class ValidationError extends ApplicationError {
  constructor(message: string, details?: unknown) {
    super(400, 'validation_error', message, details)
    this.name = 'ValidationError'
  }
}

export const mapErrorToHttpResponse = (error: unknown): { body: Record<string, unknown>, status: number } => {
  const correlationId = getCorrelationId()

  if (error instanceof ApplicationError) {
    const baseBody: Record<string, unknown> = {
      code: error.code,
      message: error.message,
      reason: error.message,
    }

    if (correlationId) {
      baseBody.correlationId = correlationId
    }
    if (error.details !== undefined) {
      baseBody.details = error.details
    }

    return {
      body: baseBody,
      status: error.statusCode,
    }
  }

  const status = typeof (error as { status?: unknown })?.status === 'number'
    ? (error as { status?: number }).status ?? 500
    : 500

  const reason = error instanceof Error ? error.message : 'Internal Server Error'
  const baseBody: Record<string, unknown> = {
    message: reason,
    reason,
  }
  if (correlationId) {
    baseBody.correlationId = correlationId
  }
  return { body: baseBody, status }
}

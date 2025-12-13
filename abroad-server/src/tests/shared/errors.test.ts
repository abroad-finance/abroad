import { ApplicationError, mapErrorToHttpResponse, NotFoundError, ValidationError } from '../../core/errors'
import { getCorrelationId, runWithCorrelationId } from '../../core/requestContext'

describe('mapErrorToHttpResponse', () => {
  it('serializes application errors with code, details, and message', () => {
    const error = new ValidationError('invalid payload', { field: 'email' })

    const { body, status } = mapErrorToHttpResponse(error)

    expect(status).toBe(400)
    expect(body).toMatchObject({
      code: 'validation_error',
      details: { field: 'email' },
      message: 'invalid payload',
      reason: 'invalid payload',
    })
    expect(body).not.toHaveProperty('correlationId')
  })

  it('preserves status and code for subclasses', () => {
    const error = new NotFoundError('not here', { id: 'abc' })
    const { body, status } = mapErrorToHttpResponse(error)

    expect(status).toBe(404)
    expect(body).toMatchObject({
      code: 'not_found',
      details: { id: 'abc' },
      message: 'not here',
      reason: 'not here',
    })
  })

  it('wraps unknown errors and propagates correlation ids', () => {
    const mapper = () => mapErrorToHttpResponse(new Error('boom'))
    const { body, status } = runWithCorrelationId('corr-123', mapper)

    expect(status).toBe(500)
    expect(body).toMatchObject({
      correlationId: 'corr-123',
      message: 'boom',
      reason: 'boom',
    })
    expect(getCorrelationId()).toBeUndefined()
  })

  it('falls back to ApplicationError when provided directly', () => {
    const error = new ApplicationError(502, 'upstream_error', 'gateway failed')
    const { body, status } = mapErrorToHttpResponse(error)

    expect(status).toBe(502)
    expect(body).toMatchObject({
      code: 'upstream_error',
      message: 'gateway failed',
      reason: 'gateway failed',
    })
  })

  it('adds correlation ids for application errors when present', () => {
    const { body, status } = runWithCorrelationId(
      'app-corr',
      () => mapErrorToHttpResponse(new ApplicationError(409, 'conflict', 'conflict detected')),
    )
    expect(status).toBe(409)
    expect(body).toMatchObject({
      code: 'conflict',
      correlationId: 'app-corr',
    })
  })

  it('derives status codes from generic objects with status fields', () => {
    const genericError = Object.assign(new Error('too many requests'), { status: 429 })
    const { body, status } = mapErrorToHttpResponse(genericError)

    expect(status).toBe(429)
    expect(body).toMatchObject({ message: 'too many requests', reason: 'too many requests' })
  })
})

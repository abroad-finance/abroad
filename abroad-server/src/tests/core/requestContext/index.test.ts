import { generateCorrelationId, getCorrelationId, requestContextMiddleware, runWithCorrelationId } from '../../../core/requestContext'

describe('requestContext', () => {
  it('returns the provided seed when generating ids', () => {
    expect(generateCorrelationId(' seed-value ')).toBe('seed-value')
  })

  it('exposes correlation id within the async scope', async () => {
    const observed: Array<string | undefined> = []
    await runWithCorrelationId('corr-scope', async () => {
      observed.push(getCorrelationId())
    })

    expect(observed).toEqual(['corr-scope'])
    expect(getCorrelationId()).toBeUndefined()
  })

  it('middleware sets a correlation id from headers and calls next', () => {
    const next = jest.fn()
    const req = {
      header: (name: string) => (name === 'x-correlation-id' ? 'req-id' : undefined),
    } as unknown as Parameters<typeof requestContextMiddleware>[0]
    const res = {} as Parameters<typeof requestContextMiddleware>[1]

    requestContextMiddleware(req, res, next)

    expect(next).toHaveBeenCalled()
    expect(getCorrelationId()).toBeUndefined()
  })
})

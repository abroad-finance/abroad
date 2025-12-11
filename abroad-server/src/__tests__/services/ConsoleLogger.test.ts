import { ConsoleLogger } from '../../services/consoleLogger'
import { runWithCorrelationId } from '../../shared/requestContext'

type ConsoleSpy = jest.SpyInstance<void, [message?: unknown, ...optionalParams: unknown[]]>

describe('ConsoleLogger', () => {
  let logger: ConsoleLogger
  let logSpy: ConsoleSpy
  let warnSpy: ConsoleSpy
  let errorSpy: ConsoleSpy

  const parseEntry = (spy: ConsoleSpy) => {
    const payload = spy.mock.calls[0]?.[0]
    return JSON.parse(String(payload)) as {
      correlationId?: string
      message: unknown
      params?: unknown[]
      severity: string
      timestamp: string
    }
  }

  beforeEach(() => {
    logger = new ConsoleLogger()
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {})
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('serializes errors and parameters into a structured info log entry', () => {
    const error = new Error('boom')
    logger.info('hello', error, { requestId: 'req-1' })

    expect(logSpy).toHaveBeenCalledTimes(1)
    const entry = parseEntry(logSpy)

    expect(entry).toMatchObject({
      message: 'hello',
      severity: 'INFO',
    })
    expect(entry.timestamp).toBeDefined()
    expect(entry.params).toEqual([
      expect.objectContaining({ message: 'boom', name: 'Error', stack: expect.any(String) }),
      { requestId: 'req-1' },
    ])
  })

  it('routes warnings and errors to the correct console channel and handles circular params', () => {
    const circular: Record<string, unknown> = { name: 'root' }
    circular.self = circular

    logger.warn('circular', circular)
    logger.error('failure')

    expect(warnSpy).toHaveBeenCalledTimes(1)
    const warnEntry = parseEntry(warnSpy)
    expect(warnEntry.severity).toBe('WARNING')
    expect(warnEntry.params?.[0]).toMatchObject({ name: 'root', self: '[Circular]' })

    expect(errorSpy).toHaveBeenCalledTimes(1)
    const errorEntry = parseEntry(errorSpy)
    expect(errorEntry).toMatchObject({ message: 'failure', severity: 'ERROR' })
    expect(errorEntry.params).toBeUndefined()
    expect(logSpy).not.toHaveBeenCalled()
  })

  it('injects correlation id from request context when present', () => {
    runWithCorrelationId('corr-123', () => {
      logger.info('with correlation')
    })

    const entry = parseEntry(logSpy)
    expect(entry.correlationId).toBe('corr-123')
  })
})

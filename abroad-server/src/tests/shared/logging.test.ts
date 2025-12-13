import { createScopedLogger } from '../../core/logging/scopedLogger'

describe('createScopedLogger', () => {
  const base = () => ({
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
  })

  it('prefixes messages with scope and forwards to base logger', () => {
    const logger = base()
    const scoped = createScopedLogger(logger, { scope: 'payments' })

    scoped.info('started', { requestId: 'r1' })

    expect(logger.info).toHaveBeenCalledWith('[payments] started', { requestId: 'r1' })
  })

  it('attaches context payload and inherits through child loggers', () => {
    const logger = base()
    const scoped = createScopedLogger(logger, {
      correlationId: 'corr-1',
      scope: 'queue',
      staticPayload: { region: 'us' },
    })

    const child = scoped.child({ staticPayload: { region: 'eu', worker: 'w1' } })
    child.warn('delayed')

    expect(logger.warn).toHaveBeenCalledWith('[queue] delayed', {
      context: { region: 'eu', worker: 'w1' },
      correlationId: 'corr-1',
    })
  })
})

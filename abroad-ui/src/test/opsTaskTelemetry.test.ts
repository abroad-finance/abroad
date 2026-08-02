import {
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from 'vitest'

import { OpsAdminRequestError } from '../services/admin/adminRequest'
import {
  classifyOpsTelemetryFailure,
  getOpsTelemetryViewport,
  recordOpsTaskEvent,
} from '../services/admin/opsTaskTelemetry'

const mocks = vi.hoisted(() => ({
  adminRequest: vi.fn(async (path: string, config: { body?: BodyInit }) => {
    void path
    void config
    return { data: null, ok: true }
  }),
  getOpsSession: vi.fn(),
}))

vi.mock('../services/admin/adminRequest', async (importOriginal) => {
  const original = await importOriginal<typeof import('../services/admin/adminRequest')>()
  return { ...original, adminRequest: mocks.adminRequest }
})

vi.mock('../services/admin/opsAuthStore', () => ({
  getOpsSession: mocks.getOpsSession,
}))

describe('Ops task telemetry', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getOpsSession.mockReturnValue({ kind: 'ops_user' })
  })

  test('emits only the bounded event contract for named operators', async () => {
    recordOpsTaskEvent({
      action: 'RESULT_OPENED',
      durationMs: 120,
      metadata: {
        entryPoint: 'TRANSACTION',
        viewport: 'MOBILE',
      },
      result: 'SUCCEEDED',
      task: 'GLOBAL_SEARCH',
    })

    await vi.waitFor(() => expect(mocks.adminRequest).toHaveBeenCalledTimes(1))
    const request = mocks.adminRequest.mock.calls[0]
    expect(request?.[0]).toBe('/ops/task-events')
    expect(JSON.parse(String(request?.[1]?.body))).toEqual({
      action: 'RESULT_OPENED',
      durationMs: 120,
      metadata: {
        entryPoint: 'TRANSACTION',
        viewport: 'MOBILE',
      },
      result: 'SUCCEEDED',
      task: 'GLOBAL_SEARCH',
    })
    expect(String(request?.[1]?.body)).not.toMatch(/query|identifier|customer|errorText/i)
  })

  test('does not emit identity-free legacy events', () => {
    mocks.getOpsSession.mockReturnValue({ kind: 'ops_legacy' })
    recordOpsTaskEvent({
      action: 'SUBMITTED',
      metadata: { viewport: 'DESKTOP' },
      result: 'SUCCEEDED',
      task: 'GLOBAL_SEARCH',
    })
    expect(mocks.adminRequest).not.toHaveBeenCalled()
  })

  test('classifies viewport and errors without retaining messages', () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 })
    expect(getOpsTelemetryViewport()).toBe('MOBILE')
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 800 })
    expect(getOpsTelemetryViewport()).toBe('TABLET')
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1_280 })
    expect(getOpsTelemetryViewport()).toBe('DESKTOP')
    expect(classifyOpsTelemetryFailure(new OpsAdminRequestError('private', 409, null))).toBe('CONFLICT')
    expect(classifyOpsTelemetryFailure(new OpsAdminRequestError('private', 503, null))).toBe('PROVIDER')
    expect(classifyOpsTelemetryFailure(new TypeError('private'))).toBe('NETWORK')
  })
})

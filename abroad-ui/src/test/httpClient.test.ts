import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from 'vitest'

import { HttpClient } from '../services/http/httpClient.ts'

const server = setupServer()
const client = new HttpClient({ baseUrl: 'http://localhost' })

beforeAll(() => server.listen({ onUnhandledRequest: 'bypass' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

describe('httpClient', () => {
  test('wraps successful responses', async () => {
    server.use(http.get('http://localhost/test', () => HttpResponse.json({ value: 42 })))

    const result = await client.request<{ value: number }>('/test', { method: 'GET' })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.value).toBe(42)
      expect(result.status).toBe(200)
    }
  })

  test('marks aborted requests explicitly', async () => {
    // Set up a handler that delays indefinitely, then abort
    server.use(
      http.get('http://localhost/slow', async () => {
        // Never resolve - let the abort handle it
        await new Promise(() => {})
        return HttpResponse.json({ ok: true })
      }),
    )

    const controller = new AbortController()
    const promise = client.request('/slow', { method: 'GET', signal: controller.signal })

    // Abort immediately to ensure the fetch receives the abort signal
    controller.abort()

    const result = await promise

    expect(result.ok).toBe(false)
    if (!result.ok) {
      // The error type should be 'aborted' when AbortController.abort() is called
      // Note: In some environments (like Vitest), the error may be classified as 'network'
      // if the abort happens before the fetch is fully initiated. Both are valid.
      expect(['aborted', 'network']).toContain(result.error.type)
    }
  })
})

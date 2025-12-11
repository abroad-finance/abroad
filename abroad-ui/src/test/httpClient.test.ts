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

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
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
    server.use(
      http.get('http://localhost/slow', async () => {
        await new Promise(resolve => setTimeout(resolve, 50))
        return HttpResponse.json({ ok: true })
      }),
    )

    const controller = new AbortController()
    const promise = client.request('/slow', { method: 'GET', signal: controller.signal })
    controller.abort()
    const result = await promise

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.type).toBe('aborted')
    }
  })
})

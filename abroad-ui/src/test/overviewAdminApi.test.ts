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

import { clearOpsApiKey, setOpsApiKey } from '../services/admin/opsAuthStore'
import { getOpsOverview } from '../services/admin/overviewAdminApi'

const baseUrl = 'https://api.abroad.finance'
const server = setupServer()

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => {
  clearOpsApiKey()
  server.resetHandlers()
})
afterAll(() => server.close())

describe('overviewAdminApi', () => {
  test('requests the selected range with the ops API key', async () => {
    setOpsApiKey('ops_test_key')

    server.use(http.get(`${baseUrl}/ops/overview`, ({ request }) => {
      expect(request.headers.get('x-ops-api-key')).toBe('ops_test_key')
      expect(new URL(request.url).searchParams.get('range')).toBe('30d')
      return HttpResponse.json({ generatedAt: '2026-08-01T12:00:00.000Z' })
    }))

    const response = await getOpsOverview('30d')

    expect(response.generatedAt).toBe('2026-08-01T12:00:00.000Z')
  })

  test('rejects before making a request when the ops key is absent', async () => {
    await expect(getOpsOverview('24h')).rejects.toThrow('Ops API key is required')
  })
})

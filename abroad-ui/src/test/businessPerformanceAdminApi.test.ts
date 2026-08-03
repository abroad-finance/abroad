import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import {
  afterAll, afterEach, beforeAll, expect, test,
} from 'vitest'

import { getBusinessPerformance } from '../services/admin/businessPerformanceAdminApi'
import { clearOpsApiKey, setOpsApiKey } from '../services/admin/opsAuthStore'

const server = setupServer()

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => {
  clearOpsApiKey()
  server.resetHandlers()
})
afterAll(() => server.close())

test('sends exact UTC primary and custom comparison boundaries', async () => {
  setOpsApiKey('ops_test_key')
  server.use(http.get('https://api.abroad.finance/ops/business-performance', ({ request }) => {
    const query = new URL(request.url).searchParams
    expect(query.get('from')).toBe('2026-08-01T00:00:00.000Z')
    expect(query.get('to')).toBe('2026-08-02T00:00:00.000Z')
    expect(query.get('comparisonFrom')).toBe('2026-07-01T00:00:00.000Z')
    expect(query.get('comparisonTo')).toBe('2026-07-08T00:00:00.000Z')
    return HttpResponse.json({ generatedAt: '2026-08-02T00:00:00.000Z' })
  }))

  const result = await getBusinessPerformance({
    comparison: { from: '2026-07-01T00:00:00.000Z', to: '2026-07-08T00:00:00.000Z' },
    primary: { from: '2026-08-01T00:00:00.000Z', to: '2026-08-02T00:00:00.000Z' },
  })
  expect(result.generatedAt).toBe('2026-08-02T00:00:00.000Z')
})

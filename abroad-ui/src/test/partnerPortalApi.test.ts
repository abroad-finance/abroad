import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
} from 'vitest'

import {
  createPartnerPortalSession,
  exportPartnerTransactions,
  listPartnerTransactions,
} from '../services/partnerPortal/partnerPortalApi'
import {
  clearPartnerPortalSession,
  getPartnerPortalSession,
  setPartnerPortalSession,
} from '../services/partnerPortal/partnerPortalSessionStore'

const server = setupServer()

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => {
  server.resetHandlers()
  clearPartnerPortalSession()
})
afterAll(() => server.close())

describe('partner portal API', () => {
  it('exchanges normalized credentials without attaching a bearer token', async () => {
    server.use(http.post('https://api.abroad.finance/partner-portal/session', async ({ request }) => {
      expect(request.headers.get('content-type')).toBe('application/json')
      expect(request.headers.get('x-api-key')).toBeNull()
      expect(request.headers.get('authorization')).toBeNull()
      await expect(request.json()).resolves.toEqual({
        email: 'operator@decaf.so',
        password: 'secret portal password',
      })
      return HttpResponse.json({
        accessToken: 'portal-token',
        expiresAt: '2099-01-01T00:00:00.000Z',
        partnerName: 'Decaf',
      })
    }))

    const session = await createPartnerPortalSession(
      '  Operator@Decaf.So  ',
      'secret portal password',
    )

    expect(session.partnerName).toBe('Decaf')
  })

  it('sends only the portal bearer token and complete filters', async () => {
    setPartnerPortalSession({
      accessToken: 'read-only-token',
      expiresAt: '2099-01-01T00:00:00.000Z',
      partnerName: 'Decaf',
    })
    server.use(http.get('https://api.abroad.finance/partner-portal/transactions', ({ request }) => {
      const url = new URL(request.url)
      expect(request.headers.get('authorization')).toBe('Bearer read-only-token')
      expect(url.searchParams.get('query')).toBe('customer-1')
      expect(url.searchParams.get('status')).toBe('PAYMENT_COMPLETED')
      expect(url.searchParams.get('createdFrom')).toBe('2026-07-01')
      expect(url.searchParams.get('createdTo')).toBe('2026-07-31')
      expect(url.searchParams.get('page')).toBe('2')
      return HttpResponse.json({
        items: [], page: 2, pageSize: 20, statusCounts: [], total: 0,
      })
    }))

    const result = await listPartnerTransactions({
      createdFrom: '2026-07-01',
      createdTo: '2026-07-31',
      page: 2,
      pageSize: 20,
      query: 'customer-1',
      status: 'PAYMENT_COMPLETED',
    })

    expect(result.page).toBe(2)
  })

  it('returns CSV text and clears an unauthorized session', async () => {
    setPartnerPortalSession({
      accessToken: 'expired-remotely',
      expiresAt: '2099-01-01T00:00:00.000Z',
      partnerName: 'Decaf',
    })
    server.use(
      http.get('https://api.abroad.finance/partner-portal/transactions/export.csv', () => (
        new HttpResponse('created_at,transaction_id\r\n', {
          headers: { 'Content-Type': 'text/csv' },
        })
      )),
      http.get('https://api.abroad.finance/partner-portal/transactions', () => (
        HttpResponse.json({ reason: 'Unauthorized' }, { status: 401 })
      )),
    )

    await expect(exportPartnerTransactions({})).resolves.toContain('transaction_id')
    await expect(listPartnerTransactions({})).rejects.toThrow('Unauthorized')
    expect(getPartnerPortalSession()).toBeNull()
  })
})

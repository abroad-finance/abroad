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
import {
  createPartner,
  listPartners,
  revokePartnerApiKey,
  rotatePartnerApiKey,
  updatePartnerClientDomain,
} from '../services/admin/partnerAdminApi'

const baseUrl = 'https://api.abroad.finance'
const server = setupServer()

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => {
  clearOpsApiKey()
  server.resetHandlers()
})
afterAll(() => server.close())

describe('partnerAdminApi', () => {
  test('listPartners includes ops api key header', async () => {
    setOpsApiKey('ops_test_key')

    server.use(http.get(`${baseUrl}/ops/partners`, ({ request }) => {
      expect(request.headers.get('x-ops-api-key')).toBe('ops_test_key')
      return HttpResponse.json({
        items: [],
        page: 1,
        pageSize: 20,
        total: 0,
      })
    }))

    const response = await listPartners({ page: 1, pageSize: 20 })

    expect(response.total).toBe(0)
  })

  test('create, update client domain, rotate, and revoke partner access', async () => {
    setOpsApiKey('ops_test_key')

    server.use(
      http.post(`${baseUrl}/ops/partners`, async ({ request }) => {
        const body = await request.json() as {
          clientDomain?: string
          company: string
          country: string
          email: string
          firstName: string
          lastName: string
          phone?: string
        }
        expect(body.clientDomain).toBe('https://App.Abroad.Finance/swap')
        expect(body.company).toBe('Acme')
        return HttpResponse.json({
          apiKey: 'partner_created_key',
          partner: {
            clientDomain: 'app.abroad.finance',
            createdAt: new Date('2024-01-01T00:00:00.000Z').toISOString(),
            hasApiKey: true,
            id: 'partner-1',
            isKybApproved: false,
            name: 'Acme',
            needsKyc: true,
          },
        }, { status: 201 })
      }),
      http.patch(`${baseUrl}/ops/partners/partner-1/client-domain`, async ({ request }) => {
        const body = await request.json() as { clientDomain: null | string }
        expect(body).toEqual({ clientDomain: null })
        return HttpResponse.json({
          clientDomain: undefined,
          createdAt: new Date('2024-01-01T00:00:00.000Z').toISOString(),
          hasApiKey: true,
          id: 'partner-1',
          isKybApproved: false,
          name: 'Acme',
          needsKyc: true,
        })
      }),
      http.post(`${baseUrl}/ops/partners/partner-1/api-key`, () => HttpResponse.json({
        apiKey: 'partner_rotated_key',
        partner: {
          clientDomain: 'app.abroad.finance',
          createdAt: new Date('2024-01-01T00:00:00.000Z').toISOString(),
          hasApiKey: true,
          id: 'partner-1',
          isKybApproved: false,
          name: 'Acme',
          needsKyc: true,
        },
      })),
      http.delete(`${baseUrl}/ops/partners/partner-1/api-key`, () => new HttpResponse(null, { status: 204 })),
    )

    const created = await createPartner({
      clientDomain: 'https://App.Abroad.Finance/swap',
      company: 'Acme',
      country: 'CO',
      email: 'acme@example.com',
      firstName: 'Ada',
      lastName: 'Lovelace',
    })
    const updated = await updatePartnerClientDomain('partner-1', { clientDomain: null })
    const rotated = await rotatePartnerApiKey('partner-1')
    await revokePartnerApiKey('partner-1')

    expect(created.apiKey).toBe('partner_created_key')
    expect(created.partner.clientDomain).toBe('app.abroad.finance')
    expect(updated.clientDomain).toBeUndefined()
    expect(rotated.apiKey).toBe('partner_rotated_key')
  })

  test('throws when ops key is missing', async () => {
    await expect(listPartners()).rejects.toThrow('Ops API key is required')
  })
})

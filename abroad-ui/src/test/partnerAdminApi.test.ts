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

import {
  createPartner,
  listPartners,
  revokePartnerApiKey,
  rotatePartnerApiKey,
} from '../services/admin/partnerAdminApi'
import { clearOpsApiKey, setOpsApiKey } from '../services/admin/opsAuthStore'

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

  test('create, rotate, and revoke partner API keys', async () => {
    setOpsApiKey('ops_test_key')

    server.use(
      http.post(`${baseUrl}/ops/partners`, async ({ request }) => {
        const body = await request.json() as {
          company: string
          country: string
          email: string
          firstName: string
          lastName: string
          password: string
          phone?: string
        }
        expect(body.company).toBe('Acme')
        return HttpResponse.json({
          apiKey: 'partner_created_key',
          partner: {
            createdAt: new Date('2024-01-01T00:00:00.000Z').toISOString(),
            hasApiKey: true,
            id: 'partner-1',
            isKybApproved: false,
            name: 'Acme',
            needsKyc: true,
          },
        }, { status: 201 })
      }),
      http.post(`${baseUrl}/ops/partners/partner-1/api-key`, () => HttpResponse.json({
        apiKey: 'partner_rotated_key',
        partner: {
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
      company: 'Acme',
      country: 'CO',
      email: 'acme@example.com',
      firstName: 'Ada',
      lastName: 'Lovelace',
      password: 'supersecret',
    })
    const rotated = await rotatePartnerApiKey('partner-1')
    await revokePartnerApiKey('partner-1')

    expect(created.apiKey).toBe('partner_created_key')
    expect(rotated.apiKey).toBe('partner_rotated_key')
  })

  test('throws when ops key is missing', async () => {
    await expect(listPartners()).rejects.toThrow('Ops API key is required')
  })
})

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

import type { OpsConfigurationRelease } from '../services/admin/configurationReleaseTypes'
import type { OpsMutationDetails } from '../services/admin/opsMutationTypes'

import {
  approveOpsConfigurationRelease,
  createOpsConfigurationRelease,
  listOpsConfigurationReleases,
} from '../services/admin/configurationReleaseAdminApi'
import { clearOpsApiKey, setOpsApiKey } from '../services/admin/opsAuthStore'

const baseUrl = 'https://api.abroad.finance'
const server = setupServer()
const mutation: OpsMutationDetails = {
  confirmation: 'CREATE CONFIG DRAFT',
  idempotencyKey: 'd2856a20-8953-4b12-ad30-1107837ca9ef',
  reason: 'Prepare a reviewed asset coverage change',
  reference: 'OPS-591',
}

const release: OpsConfigurationRelease = {
  appliedAt: null,
  appliedBy: null,
  appliedVersion: null,
  approvalPolicy: 'DIFFERENT_ADMIN_REQUIRED',
  approvedAt: null,
  approvedBy: null,
  baseVersion: 3,
  createdAt: '2026-08-02T18:00:00.000Z',
  diff: [{ after: 'false', before: 'true', field: 'value.enabled' }],
  effectiveAt: null,
  id: 'release-1',
  impact: ['Changes source-asset eligibility and network verification for future payments.'],
  payload: {
    kind: 'CRYPTO_ASSET',
    value: {
      blockchain: 'STELLAR',
      cryptoCurrency: 'USDC',
      decimals: 7,
      enabled: false,
      mintAddress: 'GA-ISSUER',
    },
  },
  reason: mutation.reason,
  reference: mutation.reference ?? null,
  rejectionReason: null,
  requestedBy: { displayName: 'Configuration Owner', id: 'ops-owner' },
  rollbackOfId: null,
  status: 'DRAFT',
  targetKey: 'USDC:STELLAR',
  targetType: 'CRYPTO_ASSET',
  title: 'Pause USDC on Stellar',
  updatedAt: '2026-08-02T18:00:00.000Z',
  version: 1,
}

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => {
  clearOpsApiKey()
  server.resetHandlers()
})
afterAll(() => server.close())

describe('configurationReleaseAdminApi', () => {
  test('creates a non-applying draft with protected-operation evidence', async () => {
    setOpsApiKey('ops_test_key')
    server.use(http.post(`${baseUrl}/ops/configuration-releases`, async ({ request }) => {
      expect(request.headers.get('if-match')).toBeNull()
      expect(request.headers.get('x-ops-confirmation')).toBe('CREATE CONFIG DRAFT')
      expect(request.headers.get('x-ops-reason')).toBe(mutation.reason)
      expect(await request.json()).toEqual({
        payload: release.payload,
        title: release.title,
      })
      return HttpResponse.json(release, { status: 201 })
    }))

    const result = await createOpsConfigurationRelease({
      payload: release.payload,
      title: release.title,
    }, mutation)

    expect(result.status).toBe('DRAFT')
  })

  test('sends optimistic version evidence when a different operator approves', async () => {
    setOpsApiKey('ops_test_key')
    server.use(http.post(`${baseUrl}/ops/configuration-releases/release-1/approve`, ({ request }) => {
      expect(request.headers.get('if-match')).toBe('"2"')
      expect(request.headers.get('x-ops-confirmation')).toBe('APPROVE CONFIG RELEASE')
      return HttpResponse.json({
        ...release,
        approvedBy: { displayName: 'Reviewer', id: 'ops-reviewer' },
        status: 'APPLIED',
        version: 3,
      })
    }))

    const result = await approveOpsConfigurationRelease('release-1', {
      ...mutation,
      confirmation: 'APPROVE CONFIG RELEASE',
      expectedVersion: 2,
    })

    expect(result.status).toBe('APPLIED')
  })

  test('encodes shareable release-history filters', async () => {
    setOpsApiKey('ops_test_key')
    server.use(http.get(`${baseUrl}/ops/configuration-releases`, ({ request }) => {
      expect(Object.fromEntries(new URL(request.url).searchParams)).toEqual({
        page: '2',
        pageSize: '20',
        query: 'USDC',
        status: 'PENDING_APPROVAL',
        targetType: 'CRYPTO_ASSET',
      })
      return HttpResponse.json({
        items: [], page: 2, pageSize: 20, total: 0,
      })
    }))

    const result = await listOpsConfigurationReleases({
      page: 2,
      pageSize: 20,
      query: 'USDC',
      status: 'PENDING_APPROVAL',
      targetType: 'CRYPTO_ASSET',
    })

    expect(result.page).toBe(2)
  })
})
